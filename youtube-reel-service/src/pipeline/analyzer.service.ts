import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import { AppConfig, CONFIG } from '../config/config';
import { run } from '../common/exec';
import { FatalJobError } from '../common/errors';
import { AiService, WhisperResult } from '../ai/ai.service';
import { ReelSource, ReelSourceDocument } from '../db/schemas/reel-source.schema';
import { ReelCampaign, ReelCampaignDocument } from '../db/schemas/reel-campaign.schema';
import { ReelTranscript, ReelTranscriptDocument, TLine } from '../db/schemas/reel-transcript.schema';
import { ReelMoment, ReelMomentDocument } from '../db/schemas/reel-moment.schema';
import { SourceVideo, SourceVideoDocument } from '../db/schemas/shared.readonly';
import { buildMiningUser, MINING_SYSTEM, MINING_VERSION, MiningSchema } from '../prompts/mining.prompt';
import { BUCKETS, StorageService } from '../storage/storage.service';
import { OrchestratorService } from '../queue/orchestrator.service';
import { QueueService } from '../queue/queue.service';
import { overlapSec, parseIsoDuration } from '../common/text';
import { EntityService } from './entity.service';
import { jobDir, probeMedia, removeDir } from './media';
import { assertChunkDurations, assertTranscriptExtent, buildTranscript, chunkOffsets, formatLines } from './transcript';

const LOCK_STALE_MS = 3 * 60 * 60_000;
const CHUNK_SEC = 1200; // 20 min per speech-to-text request (well under the 25 MB API limit at 32 kbps)
const MINING_PART_LINES = 900;
const MINING_PART_OVERLAP = 40;

/** Per-video analysis: precise speech-to-text, then mining every reel-worthy moment into the moment bank. */
@Injectable()
export class AnalyzerService {
  private readonly logger = new Logger(AnalyzerService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @InjectModel(ReelSource.name) private readonly sources: Model<ReelSourceDocument>,
    @InjectModel(ReelTranscript.name) private readonly transcripts: Model<ReelTranscriptDocument>,
    @InjectModel(ReelMoment.name) private readonly moments: Model<ReelMomentDocument>,
    @InjectModel(SourceVideo.name) private readonly videos: Model<SourceVideoDocument>,
    @InjectModel(ReelCampaign.name) private readonly campaigns: Model<ReelCampaignDocument>,
    private readonly ai: AiService,
    private readonly storage: StorageService,
    private readonly entities: EntityService,
    private readonly orchestrator: OrchestratorService,
    private readonly queues: QueueService,
  ) {}

  async analyze(youtubeId: string): Promise<'done' | 'skipped'> {
    const now = new Date();
    const src = await this.sources.findOneAndUpdate(
      { youtubeId, $or: [{ analyzeLockAt: null }, { analyzeLockAt: { $lt: new Date(now.getTime() - LOCK_STALE_MS) } }] },
      { $set: { analyzeLockAt: now } },
      { new: true },
    );
    if (!src) return 'skipped';
    try {
      if (!src.audioKey) {
        // Audio never extracted (e.g. evicted) → go back through the downloader.
        await this.queues.download(youtubeId);
        return 'skipped';
      }
      const video =
        (await this.videos.findOne({ youtubeId }).select('title publishedAt viewCount duration durationSeconds channelId').lean()) ??
        (src.kind === 'upload' ? ({ _id: src.videoId, title: src.title, viewCount: 0, durationSeconds: src.durationSec, channelId: src.channelId } as any) : null);
      const usage = await this.usageForSource(youtubeId);

      if (!src.transcriptReady || !(await this.transcripts.exists({ youtubeId }))) {
        await this.sources.updateOne({ youtubeId }, { $set: { stage: 'transcribing', error: null } });
        await this.transcribe(youtubeId, video?.title ?? '', usage);
        await this.sources.updateOne({ youtubeId }, { $set: { transcriptReady: true } });
      }

      if (src.minedVersion !== MINING_VERSION) {
        await this.sources.updateOne({ youtubeId }, { $set: { stage: 'mining' } });
        const count = await this.mine(youtubeId, src.channelId ?? video?.channelId, video, usage);
        await this.sources.updateOne({ youtubeId }, { $set: { minedVersion: MINING_VERSION, momentCount: count } });
      }

      await this.sources.updateOne({ youtubeId }, { $set: { stage: 'ready', lastUsedAt: new Date(), error: null } });
      await this.orchestrator.onSourceSettled(youtubeId);
      return 'done';
    } finally {
      await this.sources.updateOne({ youtubeId }, { $set: { analyzeLockAt: null } });
    }
  }

  /** Attribute analysis spend to the first active campaign that is waiting on this video. */
  private async usageForSource(youtubeId: string) {
    const c = await this.campaigns.findOne({ status: 'preparing', 'sources.youtubeId': youtubeId }).select('_id').lean();
    return c ? this.orchestrator.usageSink(c._id) : undefined;
  }

  /**
   * One-off repair for transcripts stored with the old (buggy) chunk offsets.
   * Re-derives the wrong offsets that were applied and the true ones from the stored audio, shifts every word
   * accordingly (line/word indices — and therefore all mined moments — stay valid), then proves the result
   * against YouTube's own transcript. No speech-to-text or AI calls, no cost.
   */
  async repairTranscript(youtubeId: string, apply: boolean): Promise<Record<string, unknown>> {
    const t = await this.transcripts.findOne({ youtubeId });
    const src = await this.sources.findOne({ youtubeId }).lean();
    if (!t || !src?.audioKey) return { youtubeId, status: 'skipped', reason: 'no transcript or stored audio' };
    const audioDur = src.durationSec ?? 0;
    const lastEnd = t.lines[t.lines.length - 1]?.e ?? 0;
    if (lastEnd <= audioDur + 8) return { youtubeId, status: 'ok-already', lastEnd: Math.round(lastEnd), audioDur: Math.round(audioDur) };

    const dir = jobDir(this.cfg.REEL_WORK_DIR, 'repair', youtubeId);
    try {
      const audio = path.join(dir, 'audio.ogg');
      await this.storage.getFile(BUCKETS.sources, src.audioKey, audio);
      const probeAll = async (sub: string, reset: boolean) => {
        const d = path.join(dir, sub);
        fs.mkdirSync(d, { recursive: true });
        await run(
          this.cfg.FFMPEG_BIN,
          ['-hide_banner', '-y', '-i', audio, '-f', 'segment', '-segment_time', String(CHUNK_SEC), ...(reset ? ['-reset_timestamps', '1'] : []), '-c', 'copy', path.join(d, 'c_%03d.ogg')],
          { timeoutMs: 10 * 60_000 },
        );
        const files = fs.readdirSync(d).sort();
        const out: number[] = [];
        for (const f of files) out.push((await probeMedia(this.cfg.FFPROBE_BIN, path.join(d, f))).duration);
        return out;
      };
      const oldDur = await probeAll('old', false); // what the buggy code measured
      const trueDur = await probeAll('new', true); // real chunk lengths
      assertChunkDurations(trueDur, CHUNK_SEC);
      const wrongOffsets = chunkOffsets(oldDur);
      const trueOffsets = chunkOffsets(trueDur);

      const shiftFor = (time: number) => {
        let k = 0;
        for (let i = 0; i < wrongOffsets.length; i++) if (wrongOffsets[i] <= time + 0.001) k = i;
        return trueOffsets[k] - wrongOffsets[k];
      };
      const words = t.words.map((w) => {
        const d = shiftFor(w.s);
        return { w: w.w, s: Math.round((w.s + d) * 1000) / 1000, e: Math.round((w.e + d) * 1000) / 1000 };
      });
      const lines = t.lines.map((l) => ({ ...l, s: words[l.w0].s, e: words[l.w1].e }));
      assertTranscriptExtent(lines, audioDur);

      // Independent proof: do the repaired lines match what YouTube's captions say at those times?
      const yt = await this.videos.findOne({ youtubeId }).select('transcriptSegments').lean();
      const before = this.captionAgreement(t.lines, yt?.transcriptSegments ?? []);
      const after = this.captionAgreement(lines, yt?.transcriptSegments ?? []);
      const report = {
        youtubeId,
        chunks: oldDur.length,
        wrongOffsets: wrongOffsets.map(Math.round),
        trueOffsets: trueOffsets.map(Math.round),
        lastEndBefore: Math.round(lastEnd),
        lastEndAfter: Math.round(lines[lines.length - 1].e),
        audioDur: Math.round(audioDur),
        captionAgreementBefore: before,
        captionAgreementAfter: after,
      };
      if (after !== null && after < 0.45) return { ...report, status: 'rejected', reason: 'repaired times do not match YouTube captions well enough' };
      if (!apply) return { ...report, status: 'dry-run-ok' };

      await this.transcripts.updateOne({ youtubeId }, { $set: { lines, words, durationSec: audioDur } });
      const moments = await this.moments.find({ youtubeId }).select('startLine endLine').lean();
      let fixed = 0;
      for (const m of moments) {
        if (!lines[m.startLine] || !lines[m.endLine]) continue;
        await this.moments.updateOne({ _id: m._id }, { $set: { start: lines[m.startLine].s, end: lines[m.endLine].e } });
        fixed++;
      }
      return { ...report, status: 'repaired', momentsUpdated: fixed };
    } finally {
      removeDir(dir);
    }
  }

  /** Fraction of sampled lines whose words also appear in YouTube's captions around the same time (0–1), or null if no captions. */
  private captionAgreement(lines: TLine[], yt: Array<{ text: string; startSeconds: number }>): number | null {
    if (!yt.length || !lines.length) return null;
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 4);
    const samples = 24;
    let total = 0;
    let n = 0;
    for (let i = 0; i < samples; i++) {
      const line = lines[Math.floor(((i + 0.5) / samples) * lines.length)];
      const words = norm(line.t);
      if (words.length < 4) continue;
      const windowText = new Set(norm(yt.filter((s) => Math.abs(s.startSeconds - line.s) <= 25).map((s) => s.text).join(' ')));
      if (!windowText.size) {
        n++;
        continue;
      }
      total += words.filter((w) => windowText.has(w)).length / words.length;
      n++;
    }
    return n ? Math.round((total / n) * 100) / 100 : null;
  }

  private async transcribe(youtubeId: string, title: string, usage?: ReturnType<OrchestratorService['usageSink']>) {
    const dir = jobDir(this.cfg.REEL_WORK_DIR, 'stt', youtubeId);
    try {
      const audio = path.join(dir, 'audio.ogg');
      await this.storage.getFile(BUCKETS.sources, `${youtubeId}/audio.ogg`, audio);
      const meta = await probeMedia(this.cfg.FFPROBE_BIN, audio);

      let parts: string[] = [audio];
      let durations: number[] = [meta.duration];
      if (meta.duration > CHUNK_SEC + 60 || meta.size > 24 * 1024 * 1024) {
        // -reset_timestamps makes every chunk start at 0, so its measured length is its real length.
        await run(
          this.cfg.FFMPEG_BIN,
          ['-hide_banner', '-y', '-i', audio, '-f', 'segment', '-segment_time', String(CHUNK_SEC), '-reset_timestamps', '1', '-c', 'copy', path.join(dir, 'chunk_%03d.ogg')],
          { timeoutMs: 10 * 60_000 },
        );
        parts = fs.readdirSync(dir).filter((f) => f.startsWith('chunk_')).sort().map((f) => path.join(dir, f));
        durations = [];
        for (const part of parts) durations.push((await probeMedia(this.cfg.FFPROBE_BIN, part)).duration);
        assertChunkDurations(durations, CHUNK_SEC);
        const total = durations.reduce((a, b) => a + b, 0);
        if (Math.abs(total - meta.duration) > 15) throw new Error(`chunks add up to ${total.toFixed(0)}s but the audio is ${meta.duration.toFixed(0)}s`);
      }
      const offsets = chunkOffsets(durations);

      const prompt = `Unique Mecca Audio. ${title}.`;
      const chunks: Array<{ offset: number; result: WhisperResult }> = [];
      for (let i = 0; i < parts.length; i++) {
        const result = await this.ai.transcribe(parts[i], prompt, usage);
        chunks.push({ offset: offsets[i], result });
      }

      const { lines, words } = buildTranscript(chunks);
      if (lines.length < 10) throw new FatalJobError(`Speech-to-text returned too little speech (${lines.length} lines)`);
      try {
        assertTranscriptExtent(lines, meta.duration);
      } catch (err) {
        throw new FatalJobError(`Refusing to store transcript: ${(err as Error).message}`);
      }
      await this.transcripts.updateOne(
        { youtubeId },
        { $set: { model: this.cfg.OPENAI_STT_MODEL, language: chunks[0]?.result.language, durationSec: meta.duration, lines, words } },
        { upsert: true },
      );
      this.logger.log(`Transcribed ${youtubeId}: ${lines.length} lines, ${words.length} words, ${Math.round(meta.duration)}s`);
    } finally {
      removeDir(dir);
    }
  }

  private async mine(
    youtubeId: string,
    channelId: Types.ObjectId | undefined,
    video: { title?: string; publishedAt?: Date; viewCount?: number; duration?: string; durationSeconds?: number; _id?: unknown } | null,
    usage?: ReturnType<OrchestratorService['usageSink']>,
  ): Promise<number> {
    if (!channelId) throw new Error(`No channel for ${youtubeId}`);
    const t = await this.transcripts.findOne({ youtubeId }).lean();
    if (!t) throw new Error('Transcript missing');
    const lines: TLine[] = t.lines;
    const known = await this.entities.knownNames(channelId);

    const parts: Array<[number, number]> = [];
    for (let s = 0; s < lines.length; s += MINING_PART_LINES - MINING_PART_OVERLAP) {
      parts.push([s, Math.min(lines.length - 1, s + MINING_PART_LINES - 1)]);
      if (s + MINING_PART_LINES >= lines.length) break;
    }

    type Mined = ReturnType<typeof MiningSchema.parse>['moments'][number];
    const all: Mined[] = [];
    for (let p = 0; p < parts.length; p++) {
      const [from, to] = parts[p];
      const res = await this.ai.generateJson({
        task: `mining:${youtubeId}:${p + 1}/${parts.length}`,
        system: MINING_SYSTEM,
        user: buildMiningUser({
          title: video?.title ?? youtubeId,
          publishedAt: video?.publishedAt ? new Date(video.publishedAt).toISOString().slice(0, 10) : undefined,
          viewCount: video?.viewCount ?? 0,
          durationMin: Math.round((video?.durationSeconds || parseIsoDuration(video?.duration) || t.durationSec) / 60),
          knownEntities: known,
          part: parts.length > 1 ? { index: p + 1, total: parts.length } : undefined,
          transcript: formatLines(lines, from, to),
        }),
        schema: MiningSchema,
        schemaName: 'mined_moments',
        usage,
      });
      for (const m of res.moments) {
        const startLine = Math.max(from, Math.min(to, Math.round(m.startLine)));
        const endLine = Math.max(startLine, Math.min(to, Math.round(m.endLine)));
        if (endLine - startLine < 0) continue;
        const dur = lines[endLine].e - lines[startLine].s;
        if (dur < 8 || dur > 240) continue;
        all.push({
          ...m,
          startLine,
          endLine,
          hookLines: m.hookLines.filter((h) => h >= 0 && h < lines.length),
          payoffLine: m.payoffLine >= 0 && m.payoffLine < lines.length ? m.payoffLine : endLine,
          standalone: clamp10(m.standalone),
          intensity: clamp10(m.intensity),
        });
      }
    }

    // Overlapping parts can yield the same moment twice: keep the stronger one.
    all.sort((a, b) => b.standalone + b.intensity - (a.standalone + a.intensity));
    const kept: Mined[] = [];
    for (const m of all) {
      const ms = lines[m.startLine].s;
      const me = lines[m.endLine].e;
      const dup = kept.some((k) => {
        const ov = overlapSec(ms, me, lines[k.startLine].s, lines[k.endLine].e);
        return ov / Math.min(me - ms, lines[k.endLine].e - lines[k.startLine].s) > 0.6 && k.type === m.type;
      });
      if (!dup) kept.push(m);
    }
    kept.sort((a, b) => a.startLine - b.startLine);

    const embedTexts = kept.map((m) =>
      [m.title, m.summary, m.themes.join(', '), m.entities.join(', '), lines.slice(m.startLine, m.endLine + 1).map((l) => l.t).join(' ').slice(0, 1500)].join('\n'),
    );
    let vectors: number[][] = [];
    try {
      vectors = await this.ai.embed(embedTexts, usage);
    } catch (err: any) {
      this.logger.warn(`Embedding failed for ${youtubeId} (semantic search degraded): ${err.message}`);
    }

    const docs = [];
    for (let i = 0; i < kept.length; i++) {
      const m = kept[i];
      const ents = await this.entities.resolve(channelId, m.entities);
      docs.push({
        channelId,
        youtubeId,
        videoId: video?._id,
        promptVersion: MINING_VERSION,
        startLine: m.startLine,
        endLine: m.endLine,
        start: lines[m.startLine].s,
        end: lines[m.endLine].e,
        title: m.title,
        type: m.type,
        summary: m.summary,
        whyItWorks: m.whyItWorks,
        hookLines: m.hookLines,
        payoffLine: m.payoffLine,
        standalone: m.standalone,
        intensity: m.intensity,
        contextNeeded: m.contextNeeded ?? undefined,
        entityNames: ents.map((e) => e.name),
        entitySlugs: ents.map((e) => e.slug),
        themes: m.themes.map((x) => x.toLowerCase().trim()).filter(Boolean).slice(0, 3),
        status: 'unused',
        embedding: vectors[i],
      });
    }
    await this.moments.deleteMany({ youtubeId, promptVersion: MINING_VERSION, status: 'unused' });
    if (docs.length) await this.moments.insertMany(docs);
    this.logger.log(`Mined ${docs.length} moments from ${youtubeId}`);
    return docs.length;
  }
}

function clamp10(n: number) {
  return Math.max(1, Math.min(10, Math.round(n)));
}
