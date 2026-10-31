import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import { AppConfig, CONFIG } from '../config/config';
import { run } from '../common/exec';
import { ReelCampaign, ReelCampaignDocument } from '../db/schemas/reel-campaign.schema';
import { Reel, ReelDocument, ReelWord } from '../db/schemas/reel.schema';
import { ReelSource, ReelSourceDocument } from '../db/schemas/reel-source.schema';
import { BUCKETS, StorageService } from '../storage/storage.service';
import { OrchestratorService } from '../queue/orchestrator.service';
import { QueueService } from '../queue/queue.service';
import { buildAss, buildSrt } from './captions';
import { clipInputArgs, LOUDNESS, loudnessMeasureGraph, parseLoudnorm, parseQa, plannedAudioGraph, RenderClipInput, RenderFx, renderGraph } from './filtergraph';
import { buildTimeline, mapWords, NO_PACE, PaceOptions, Timeline } from './timeline';
import { ensureDir, freeDiskGb, jobDir, probeMedia, removeDir } from './media';
import { ReelTemplate } from './template';
import { TemplateStoreService } from './template-store.service';
import { ThumbnailService } from './thumbnail.service';
import { buildFullscreenAss } from './fullscreen';
import { LayoutAudit, LayoutService } from './layout.service';
import { AiService } from '../ai/ai.service';
import { EndSfx, resolveSfxFile, tailFor } from './sfx';
import { captionsInSilence, ClipSpan, parseSilences, realignWords } from './word-align';

export interface RenderResult {
  file: string;
  cover: string;
  srt: string;
  duration: number;
  width: number;
  height: number;
  lufs: number | null;
  warnings: string[];
  timeline: Timeline;
  fx: RenderFx | null;
  realign: { ok: boolean; coverage?: number; maxShiftSec?: number; reason?: string } | null;
  sfx: EndSfx | null;
}

@Injectable()
export class RendererService {
  private readonly logger = new Logger(RendererService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @InjectModel(Reel.name) private readonly reels: Model<ReelDocument>,
    @InjectModel(ReelSource.name) private readonly sources: Model<ReelSourceDocument>,
    @InjectModel(ReelCampaign.name) private readonly campaigns: Model<ReelCampaignDocument>,
    private readonly storage: StorageService,
    private readonly templates: TemplateStoreService,
    private readonly orchestrator: OrchestratorService,
    private readonly queues: QueueService,
    private readonly thumbnails: ThumbnailService,
    private readonly layouts: LayoutService,
    @Inject(AiService) private readonly ai: AiService | null = null,
  ) {}

  async render(reelId: string): Promise<'done' | 'deferred' | 'skipped'> {
    const reel = await this.reels
      .findOneAndUpdate(
        { _id: reelId, status: { $in: ['queued', 'rendering', 'failed'] } },
        { $set: { status: 'rendering', error: null }, $inc: { renderAttempts: 1 } },
        { new: true },
      )
      .select('+words');
    if (!reel) return 'skipped';

    const campaign = await this.campaigns.findById(reel.campaignId).select('status cancelRequested settings').lean();
    if (!campaign || campaign.cancelRequested || campaign.status === 'cancelled') {
      await this.reels.updateOne({ _id: reel._id }, { $set: { status: 'failed', error: 'Campaign cancelled' } });
      return 'skipped';
    }

    // Every source video must be in the cache; evicted ones are re-fetched first.
    const ids = [...new Set(reel.clips.map((c) => c.youtubeId))];
    const srcs = await this.sources.find({ youtubeId: { $in: ids } }).lean();
    const missing = ids.filter((id) => {
      const s = srcs.find((x) => x.youtubeId === id);
      return !s?.videoPresent || !s.videoKey;
    });
    if (missing.length) {
      for (const id of missing) await this.queues.download(id);
      await this.reels.updateOne({ _id: reel._id }, { $set: { status: 'queued' }, $inc: { renderAttempts: -1 } });
      await this.queues.render(reelId, 3 * 60_000);
      return 'deferred';
    }
    if (freeDiskGb(this.cfg.REEL_WORK_DIR) < Math.max(2, this.cfg.REEL_MIN_FREE_DISK_GB / 2)) {
      await this.reels.updateOne({ _id: reel._id }, { $set: { status: 'queued' }, $inc: { renderAttempts: -1 } });
      await this.queues.render(reelId, 10 * 60_000);
      return 'deferred';
    }

    const keyById = new Map(srcs.map((s) => [s.youtubeId, s.videoKey!]));
    const clips: RenderClipInput[] = [];
    for (const c of reel.clips) {
      clips.push({ src: await this.storage.presignedGet(BUCKETS.sources, keyById.get(c.youtubeId)!), start: c.start, duration: c.end - c.start });
    }
    const tpl = await this.templates.get(reel.templateName || campaign.settings.templateName || 'default');

    const dir = jobDir(this.cfg.REEL_WORK_DIR, 'render', reelId);
    try {
      // Look: full-screen needs the studio layout of every shot in the reel; if any shot cannot be read the reel is made in the classic look.
      let look: 'classic' | 'fullscreen' = 'classic';
      let lookNote: string | undefined;
      let renderClips = clips;
      let layoutShots: LayoutAudit[] | undefined;
      if (this.cfg.REEL_LOOK === 'fullscreen') {
        const found = await this.layouts.resolve({
          clips: reel.clips.map((c, i) => ({ youtubeId: c.youtubeId, src: clips[i].src, start: c.start, duration: c.end - c.start })),
          dir,
          usage: this.orchestrator.usageSink(reel.campaignId),
        });
        if (found.ok) {
          look = 'fullscreen';
          renderClips = found.clips;
          layoutShots = found.shots;
        } else {
          lookNote = found.reason;
          this.logger.warn(`Reel ${reelId}: classic look (${found.reason})`);
        }
      }
      const sfx = await this.endSfx();
      const make = (l: 'classic' | 'fullscreen', c: RenderClipInput[]) =>
        this.renderToDir({
          dir,
          clips: c,
          words: reel.words,
          headline: reel.packaging?.headline ?? null,
          template: tpl.template,
          canvasPath: tpl.canvasPath,
          expectedDuration: reel.durationSec,
          pace: this.pace(),
          look: l,
          fx: l === 'fullscreen' ? undefined : this.fx(),
          sfx,
        });
      let result: RenderResult;
      try {
        result = await make(look, renderClips);
      } catch (err: any) {
        if (look !== 'fullscreen') throw err;
        // the new look must never cost a reel: make it in the classic look instead
        look = 'classic';
        layoutShots = undefined;
        lookNote = `full-screen render failed: ${String(err?.message ?? err).slice(0, 200)}`;
        this.logger.warn(`Reel ${reelId}: classic look (${lookNote})`);
        result = await make('classic', clips);
      }

      const lowRes = srcs.filter((s) => s.height && s.height < 720).map((s) => `${s.youtubeId} is ${s.height}p`);
      const prefix = `${reel.channelId}/${reel.campaignId}/${reel._id}`;
      await this.storage.putFile(BUCKETS.reels, `${prefix}/reel.mp4`, result.file, 'video/mp4');
      await this.storage.putFile(BUCKETS.reels, `${prefix}/cover.jpg`, result.cover, 'image/jpeg');
      await this.storage.putFile(BUCKETS.reels, `${prefix}/captions.srt`, result.srt, 'application/x-subrip');
      const size = fs.statSync(result.file).size;

      await this.reels.updateOne(
        { _id: reel._id },
        {
          $set: {
            status: 'todo',
            error: null,
            look,
            lookNote: lookNote ?? null,
            layoutShots: layoutShots ?? [],
            templateEtag: tpl.etag,
            durationSec: Math.round(result.duration * 100) / 100,
            timing: {
              speed: result.timeline.speed,
              voice: result.timeline.voice,
              semitones: result.timeline.semitones,
              cuts: result.timeline.cuts,
              plannedSec: result.timeline.reelDuration,
              fx: result.fx,
              realign: result.realign,
              sfx: result.sfx ? { name: result.sfx.name, tail: result.sfx.tail } : null,
            },
            assets: { videoKey: `${prefix}/reel.mp4`, coverKey: `${prefix}/cover.jpg`, srtKey: `${prefix}/captions.srt`, sizeBytes: size },
            qa: {
              loudnessLufs: result.lufs ?? undefined,
              width: result.width,
              height: result.height,
              warnings: [...result.warnings, ...lowRes.map((l) => `low-resolution source: ${l}`)],
            },
          },
        },
      );
      await this.sources.updateMany({ youtubeId: { $in: ids } }, { $set: { lastUsedAt: new Date() } });
      this.logger.log(`Rendered reel ${reelId}: ${result.duration.toFixed(1)}s, ${(size / 1e6).toFixed(1)}MB, ${result.lufs ?? '?'} LUFS`);
      // Thumbnails once per reel (kept across re-renders); never fails the render.
      await this.thumbnails.ensure(reel, result.cover).catch((err) => this.logger.warn(`Reel ${reelId}: no thumbnails (${err.message})`));
      await this.orchestrator.onReelSettled(String(reel.campaignId));
      return 'done';
    } finally {
      removeDir(dir);
    }
  }

  /** A readable URL of a cached source video (operator tools). */
  async sourceUrl(youtubeId: string): Promise<string> {
    const s = await this.sources.findOne({ youtubeId }).select('videoKey videoPresent').lean();
    if (!s?.videoPresent || !s.videoKey) throw new Error(`Source ${youtubeId} is not in the cache`);
    return this.storage.presignedGet(BUCKETS.sources, s.videoKey);
  }

  /** The pace applied to every reel (env-controlled). */
  pace(): PaceOptions {
    return {
      speed: this.cfg.REEL_SPEED,
      voice: this.cfg.REEL_VOICE,
      semitones: this.cfg.REEL_PITCH_SEMITONES,
      minGap: this.cfg.REEL_TRIM_PAUSES ? this.cfg.REEL_PAUSE_MIN_GAP_MS / 1000 : 0,
      keep: 0.12,
      maxSegments: 30,
    };
  }

  /** The ending sound (one recorded file for every reel); null when switched off or the file is missing. */
  async endSfx(): Promise<EndSfx | null> {
    if (!this.cfg.REEL_END_SFX) return null;
    const file = resolveSfxFile(this.cfg.assetsDir, this.cfg.REEL_END_SFX_FILE);
    if (!file) {
      this.logger.warn(`Ending sound "${this.cfg.REEL_END_SFX_FILE}" not found; rendering without it`);
      return null;
    }
    try {
      const meta = await probeMedia(this.cfg.FFPROBE_BIN, file);
      return { name: path.basename(file), file, duration: meta.duration, tail: tailFor(meta.duration) };
    } catch (err: any) {
      this.logger.warn(`Ending sound unreadable (${err.message}); rendering without it`);
      return null;
    }
  }

  /** The visual rhythm applied to every reel (env-controlled; whoosh needs the topic-change flash). */
  fx(): RenderFx {
    return { punch: this.cfg.REEL_FX_PUNCH, join: this.cfg.REEL_FX_JOIN, whoosh: this.cfg.REEL_FX_JOIN && this.cfg.REEL_FX_WHOOSH, bar: this.cfg.REEL_FX_BAR };
  }

  /** Pure render step (no DB): used by jobs, the CLI preview and local tests. */
  async renderToDir(input: {
    dir: string;
    clips: RenderClipInput[];
    /** Words on the planned reel timeline (`reel.words`). */
    words: ReelWord[];
    headline: string | null;
    template: ReelTemplate;
    canvasPath: string;
    expectedDuration: number;
    pace?: PaceOptions;
    /** 'fullscreen' needs a `layout` on every clip; default 'classic'. */
    look?: 'classic' | 'fullscreen';
    fx?: RenderFx;
    /** Ending sound (adds a short tail after the last word). */
    sfx?: EndSfx | null;
  }): Promise<RenderResult> {
    const { dir, template } = input;

    // Word times measured on this reel's own audio. If anything goes wrong the stored times are used, as before.
    let plannedWords = input.words;
    let realign: RenderResult['realign'] = null;
    let basePace = input.pace ?? NO_PACE;
    if (this.ai && this.cfg.REEL_STT_REALIGN && input.words.length) {
      try {
        const spans: ClipSpan[] = [];
        let at = 0;
        for (const c of input.clips) {
          spans.push({ from: at, to: at + c.duration });
          at += c.duration;
        }
        const audio = path.join(dir, 'planned.m4a');
        await run(
          this.cfg.FFMPEG_BIN,
          ['-hide_banner', '-nostats', '-y', ...clipInputArgs(input.clips), '-filter_complex', plannedAudioGraph(input.clips), '-map', '[aout]', '-c:a', 'aac', '-b:a', '48k', audio],
          { cwd: dir, timeoutMs: 10 * 60_000, lowPriority: true },
        );
        const heard = await this.ai.transcribe(audio, ''); // no hint: with the expected text as a hint Whisper drops words (measured: 37% matched vs ~98%)
        const res = realignWords(input.words, (heard.words ?? []).map((w: any) => ({ word: w.word, start: w.start, end: w.end })), spans);
        if (res.ok) {
          plannedWords = res.words;
          basePace = { ...basePace, edgeCuts: true };
          realign = { ok: true, coverage: Math.round(res.coverage * 100) / 100, maxShiftSec: res.maxShift };
          this.logger.log(`Realigned ${plannedWords.length} words on the reel audio (matched ${Math.round(res.coverage * 100)}%, largest move ${res.maxShift}s)`);
        } else {
          realign = { ok: false, reason: res.reason };
          this.logger.warn(`Word times kept as stored: ${res.reason}`);
        }
      } catch (err: any) {
        realign = { ok: false, reason: String(err?.message || err).slice(0, 160) };
        this.logger.warn(`Word times kept as stored: ${realign.reason}`);
      }
    }

    const tl = buildTimeline(input.clips, plannedWords, basePace);
    const clips = tl.segments;
    const total = tl.duration;
    const words = mapWords(plannedWords, tl);

    // Fonts + ASS live inside the job dir so filter paths stay relative (no escaping issues on any OS).
    const fonts = ensureDir(path.join(dir, 'fonts'));
    for (const f of fs.readdirSync(this.cfg.fontsDir).filter((x) => /\.(ttf|otf)$/i.test(x))) {
      fs.copyFileSync(path.join(this.cfg.fontsDir, f), path.join(fonts, f));
    }
    const fullscreen = input.look === 'fullscreen';
    fs.writeFileSync(
      path.join(dir, 'reel.ass'),
      fullscreen ? buildFullscreenAss({ words, headline: input.headline, duration: total + (input.sfx ? input.sfx.tail : 0) }) : buildAss({ words, headline: input.headline, template, duration: total }),
    );
    fs.copyFileSync(input.canvasPath, path.join(dir, 'canvas.png'));

    // Pass 1: loudness measurement.
    let measured = null;
    try {
      const m = await run(
        this.cfg.FFMPEG_BIN,
        ['-hide_banner', '-nostats', ...clipInputArgs(clips), '-filter_complex', loudnessMeasureGraph(clips, { speed: tl.speed, voice: tl.voice, semitones: tl.semitones }), '-map', '[aout]', '-f', 'null', '-'],
        { cwd: dir, timeoutMs: 15 * 60_000, lowPriority: true },
      );
      measured = parseLoudnorm(m.stderr);
    } catch (err: any) {
      this.logger.warn(`Loudness measurement failed, using single-pass normalisation: ${err.message}`);
    }

    // Pass 2: full render.
    const out = path.join(dir, 'reel.mp4');
    await run(
      this.cfg.FFMPEG_BIN,
      [
        '-hide_banner',
        '-nostats',
        '-y',
        ...clipInputArgs(clips),
        '-i',
        'canvas.png',
        ...(input.sfx ? ['-i', input.sfx.file] : []),
        '-filter_complex',
        renderGraph({ clips, template, canvasInputIndex: clips.length, assFile: 'reel.ass', fontsDir: 'fonts', measured, totalDuration: total, speed: tl.speed, voice: tl.voice, semitones: tl.semitones, look: input.look, fx: input.fx, sfx: input.sfx ? { inputIndex: clips.length + 1, duration: input.sfx.duration, tail: input.sfx.tail, volume: this.cfg.REEL_END_SFX_VOLUME } : null }),
        '-map',
        '[vout]',
        '-map',
        '[aout]',
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-crf',
        '20',
        '-profile:v',
        'high',
        '-level:v',
        '4.2',
        '-pix_fmt',
        'yuv420p',
        '-r',
        '30',
        '-g',
        '60',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-ar',
        '48000',
        '-movflags',
        '+faststart',
        '-threads',
        String(this.cfg.REEL_FFMPEG_THREADS),
        '-shortest',
        out,
      ],
      { cwd: dir, timeoutMs: 40 * 60_000, lowPriority: true },
    );

    // Automatic QA.
    const meta = await probeMedia(this.cfg.FFPROBE_BIN, out);
    const qaRun = await run(
      this.cfg.FFMPEG_BIN,
      ['-hide_banner', '-nostats', '-i', out, '-vf', 'blackdetect=d=0.5:pix_th=0.08', '-af', 'ebur128,silencedetect=n=-35dB:d=0.3', '-f', 'null', '-'],
      { cwd: dir, timeoutMs: 10 * 60_000, lowPriority: true },
    );
    const qa = parseQa(qaRun.stderr);
    const problems: string[] = [];
    if (meta.width !== template.width || meta.height !== template.height) problems.push(`wrong size ${meta.width}x${meta.height}`);
    if (!meta.hasAudio) problems.push('no audio track');
    const expectedTotal = total + (input.sfx ? input.sfx.tail : 0);
    if (Math.abs(meta.duration - expectedTotal) > 1.0) problems.push(`duration ${meta.duration.toFixed(1)}s, expected ${expectedTotal.toFixed(1)}s`);
    if (problems.length) throw new Error(`Render QA failed: ${problems.join('; ')}`);

    const warnings: string[] = [];
    if (qa.lufs !== null && Math.abs(qa.lufs - LOUDNESS.I) > 2) warnings.push(`loudness ${qa.lufs} LUFS (target ${LOUDNESS.I})`);
    if (qa.blackSegments > 0) warnings.push(`${qa.blackSegments} black segment(s) detected`);
    // Timing check on the finished file: captions must not start inside real silence, and no long dead air may remain.
    const silences = parseSilences(qaRun.stderr);
    const drift = captionsInSilence(words, silences);
    if (drift.count > 0) warnings.push(`captions start in silence for ${drift.count} word(s), up to ${drift.worst}s early`);
    const deadAir = silences.filter(([a, b]) => b - a > 0.6 && a > 0.2 && b < total - 0.2);
    if (deadAir.length) warnings.push(`${deadAir.length} pause(s) over 0.6s remain (longest ${Math.max(...deadAir.map(([a, b]) => b - a)).toFixed(1)}s)`);

    const cover = path.join(dir, 'cover.jpg');
    await run(this.cfg.FFMPEG_BIN, ['-hide_banner', '-y', '-ss', Math.min(1.2, total / 2).toFixed(2), '-i', out, '-frames:v', '1', '-q:v', '3', cover], {
      cwd: dir,
      timeoutMs: 60_000,
    });
    const srt = path.join(dir, 'captions.srt');
    fs.writeFileSync(srt, buildSrt(words));

    return { file: out, cover, srt, duration: meta.duration, width: meta.width, height: meta.height, lufs: qa.lufs, warnings, timeline: tl, fx: input.fx ?? null, realign, sfx: input.sfx ?? null };
  }
}
