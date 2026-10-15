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
import { clipInputArgs, LOUDNESS, loudnessMeasureGraph, parseLoudnorm, parseQa, RenderClipInput, renderGraph } from './filtergraph';
import { ensureDir, freeDiskGb, jobDir, probeMedia, removeDir } from './media';
import { ReelTemplate } from './template';
import { TemplateStoreService } from './template-store.service';

export interface RenderResult {
  file: string;
  cover: string;
  srt: string;
  duration: number;
  width: number;
  height: number;
  lufs: number | null;
  warnings: string[];
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
      const result = await this.renderToDir({
        dir,
        clips,
        words: reel.words,
        headline: reel.packaging?.headline ?? null,
        template: tpl.template,
        canvasPath: tpl.canvasPath,
        expectedDuration: reel.durationSec,
      });

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
            templateEtag: tpl.etag,
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
      await this.orchestrator.onReelSettled(String(reel.campaignId));
      return 'done';
    } finally {
      removeDir(dir);
    }
  }

  /** Pure render step (no DB): used by jobs, the CLI preview and local tests. */
  async renderToDir(input: {
    dir: string;
    clips: RenderClipInput[];
    words: ReelWord[];
    headline: string | null;
    template: ReelTemplate;
    canvasPath: string;
    expectedDuration: number;
  }): Promise<RenderResult> {
    const { dir, clips, template } = input;
    const total = clips.reduce((n, c) => n + c.duration, 0);

    // Fonts + ASS live inside the job dir so filter paths stay relative (no escaping issues on any OS).
    const fonts = ensureDir(path.join(dir, 'fonts'));
    for (const f of fs.readdirSync(this.cfg.fontsDir).filter((x) => /\.(ttf|otf)$/i.test(x))) {
      fs.copyFileSync(path.join(this.cfg.fontsDir, f), path.join(fonts, f));
    }
    fs.writeFileSync(path.join(dir, 'reel.ass'), buildAss({ words: input.words, headline: input.headline, template, duration: total }));
    fs.copyFileSync(input.canvasPath, path.join(dir, 'canvas.png'));

    // Pass 1: loudness measurement.
    let measured = null;
    try {
      const m = await run(
        this.cfg.FFMPEG_BIN,
        ['-hide_banner', '-nostats', ...clipInputArgs(clips), '-filter_complex', loudnessMeasureGraph(clips), '-map', '[aout]', '-f', 'null', '-'],
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
        '-filter_complex',
        renderGraph({ clips, template, canvasInputIndex: clips.length, assFile: 'reel.ass', fontsDir: 'fonts', measured, totalDuration: total }),
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
      ['-hide_banner', '-nostats', '-i', out, '-vf', 'blackdetect=d=0.5:pix_th=0.08', '-af', 'ebur128', '-f', 'null', '-'],
      { cwd: dir, timeoutMs: 10 * 60_000, lowPriority: true },
    );
    const qa = parseQa(qaRun.stderr);
    const problems: string[] = [];
    if (meta.width !== template.width || meta.height !== template.height) problems.push(`wrong size ${meta.width}x${meta.height}`);
    if (!meta.hasAudio) problems.push('no audio track');
    if (Math.abs(meta.duration - total) > 1.0) problems.push(`duration ${meta.duration.toFixed(1)}s, expected ${total.toFixed(1)}s`);
    if (problems.length) throw new Error(`Render QA failed: ${problems.join('; ')}`);

    const warnings: string[] = [];
    if (qa.lufs !== null && Math.abs(qa.lufs - LOUDNESS.I) > 2) warnings.push(`loudness ${qa.lufs} LUFS (target ${LOUDNESS.I})`);
    if (qa.blackSegments > 0) warnings.push(`${qa.blackSegments} black segment(s) detected`);

    const cover = path.join(dir, 'cover.jpg');
    await run(this.cfg.FFMPEG_BIN, ['-hide_banner', '-y', '-ss', Math.min(1.2, total / 2).toFixed(2), '-i', out, '-frames:v', '1', '-q:v', '3', cover], {
      cwd: dir,
      timeoutMs: 60_000,
    });
    const srt = path.join(dir, 'captions.srt');
    fs.writeFileSync(srt, buildSrt(input.words));

    return { file: out, cover, srt, duration: meta.duration, width: meta.width, height: meta.height, lufs: qa.lufs, warnings };
  }
}
