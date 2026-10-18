import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import { AppConfig, CONFIG } from '../config/config';
import { ExecError, run } from '../common/exec';
import { errMsg, VideoUnavailableError, YouTubeAuthError } from '../common/errors';
import { ReelSource, ReelSourceDocument } from '../db/schemas/reel-source.schema';
import { ReelSetting, ReelSettingDocument } from '../db/schemas/reel-misc.schema';
import { SourceVideo, SourceVideoDocument } from '../db/schemas/shared.readonly';
import { MINING_VERSION } from '../prompts/mining.prompt';
import { BUCKETS, StorageService } from '../storage/storage.service';
import { QueueService } from '../queue/queue.service';
import { OrchestratorService } from '../queue/orchestrator.service';
import { freeDiskGb, jobDir, probeMedia, removeDir } from './media';
import { YouTubeSessionService } from './youtube-session.service';
import { classifyYtdlpError, YTDLP_FORMAT, ytdlpErrorLine } from './ytdlp';

const LOCK_STALE_MS = 90 * 60_000;

export type DownloadOutcome = 'done' | 'skipped' | 'blocked' | 'deferred';

@Injectable()
export class DownloaderService {
  private readonly logger = new Logger(DownloaderService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @InjectModel(ReelSource.name) private readonly sources: Model<ReelSourceDocument>,
    @InjectModel(ReelSetting.name) private readonly settings: Model<ReelSettingDocument>,
    @InjectModel(SourceVideo.name) private readonly videos: Model<SourceVideoDocument>,
    private readonly storage: StorageService,
    private readonly session: YouTubeSessionService,
    private readonly queues: QueueService,
    private readonly orchestrator: OrchestratorService,
  ) {}

  /**
   * Download one source video in full (≤1080p), cache it in MinIO with a 16 kHz mono audio track for STT.
   * Auth failures pause the whole download queue; unavailable videos fail fast; other errors retry.
   */
  async download(youtubeId: string): Promise<DownloadOutcome> {
    const now = new Date();
    const src = await this.sources.findOneAndUpdate(
      { youtubeId, $or: [{ downloadLockAt: null }, { downloadLockAt: { $lt: new Date(now.getTime() - LOCK_STALE_MS) } }] },
      { $set: { downloadLockAt: now } },
      { new: true },
    );
    if (!src) return 'skipped'; // another worker holds the lock

    try {
      if (src.videoPresent && src.videoKey && (await this.storage.stat(BUCKETS.sources, src.videoKey))) {
        await this.afterVideoPresent(src);
        return 'skipped';
      }
      if (src.kind === 'upload') return await this.prepareUpload(src);

      const session = await this.session.state();
      if (session.status === 'needs_login') {
        await this.sources.updateOne({ youtubeId }, { $set: { stage: 'blocked', error: 'Waiting for YouTube reconnect' } });
        await this.orchestrator.onSourceSettled(youtubeId);
        return 'blocked';
      }

      if (freeDiskGb(this.cfg.REEL_WORK_DIR) < this.cfg.REEL_MIN_FREE_DISK_GB) {
        this.logger.warn(`Low disk space; deferring download of ${youtubeId}`);
        await this.queues.download(youtubeId, 10 * 60_000);
        return 'deferred';
      }
      if (!(await this.underDailyCap())) {
        this.logger.warn(`Daily download cap reached; deferring ${youtubeId} by 1h`);
        await this.queues.download(youtubeId, 60 * 60_000);
        return 'deferred';
      }

      const analysisDone = src.transcriptReady && src.minedVersion === MINING_VERSION;
      if (!analysisDone) await this.sources.updateOne({ youtubeId }, { $set: { stage: 'downloading', error: null }, $inc: { attempts: 1 } });

      const dir = jobDir(this.cfg.REEL_WORK_DIR, 'dl', youtubeId);
      try {
        const videoFile = await this.fetch(youtubeId, dir);
        await this.ingest(youtubeId, videoFile, dir, analysisDone);
        return 'done';
      } finally {
        removeDir(dir);
      }
    } catch (err) {
      if (err instanceof YouTubeAuthError) {
        await this.session.markNeedsLogin(err.message);
        await this.sources.updateOne({ youtubeId }, { $set: { stage: 'blocked', error: 'Waiting for YouTube reconnect' } });
        await this.queues.download(youtubeId, 60_000); // waits in the paused queue until re-login
        await this.orchestrator.onSourceSettled(youtubeId);
        return 'blocked';
      }
      if (err instanceof VideoUnavailableError) {
        await this.markFailed(youtubeId, `unavailable: ${err.message}`);
        return 'done';
      }
      throw err; // transient: Bull retries, final failure handled by the processor
    } finally {
      await this.sources.updateOne({ youtubeId }, { $set: { downloadLockAt: null } });
    }
  }

  /**
   * Manual fallback: ingest an original file (uploaded by the operator/client, or fetched elsewhere)
   * exactly as if it had been downloaded — same probe, audio extraction, storage and analysis.
   */
  async importFile(youtubeId: string, filePath: string): Promise<void> {
    const video = await this.videos.findOne({ youtubeId }).select('_id channelId title').lean();
    if (!video) throw new Error(`Video ${youtubeId} is not in this channel's catalog`);
    await this.sources.updateOne(
      { youtubeId },
      { $setOnInsert: { youtubeId, videoId: video._id, channelId: video.channelId, title: video.title, stage: 'queued' } },
      { upsert: true },
    );
    const src = await this.sources.findOneAndUpdate({ youtubeId }, { $set: { downloadLockAt: new Date() } }, { new: true });
    const analysisDone = !!src?.transcriptReady && src.minedVersion === MINING_VERSION;
    const dir = jobDir(this.cfg.REEL_WORK_DIR, 'import', youtubeId);
    try {
      await this.ingest(youtubeId, filePath, dir, analysisDone);
    } finally {
      removeDir(dir);
      await this.sources.updateOne({ youtubeId }, { $set: { downloadLockAt: null } });
    }
  }

  /** Probe → 16 kHz mono speech track → MinIO → mark present → continue to analysis. */
  private async ingest(youtubeId: string, videoFile: string, dir: string, analysisDone: boolean) {
    const meta = await probeMedia(this.cfg.FFPROBE_BIN, videoFile);
    if (!meta.hasVideo || !meta.hasAudio) throw new VideoUnavailableError('File has no video or no audio track');

    const audioFile = path.join(dir, 'audio.ogg');
    await run(
      this.cfg.FFMPEG_BIN,
      ['-hide_banner', '-y', '-i', videoFile, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-b:a', '32k', audioFile],
      { timeoutMs: 20 * 60_000, lowPriority: true },
    );

    const videoKey = `${youtubeId}/source.mp4`;
    const audioKey = `${youtubeId}/audio.ogg`;
    await this.storage.putFile(BUCKETS.sources, videoKey, videoFile, 'video/mp4');
    await this.storage.putFile(BUCKETS.sources, audioKey, audioFile, 'audio/ogg');

    const updated = await this.sources.findOneAndUpdate(
      { youtubeId },
      {
        $set: {
          videoKey,
          audioKey,
          videoPresent: true,
          durationSec: meta.duration,
          width: meta.width,
          height: meta.height,
          fps: meta.fps,
          sizeBytes: meta.size,
          hasAudio: meta.hasAudio,
          downloadedAt: new Date(),
          lastUsedAt: new Date(),
          error: meta.height && meta.height < 720 ? `low resolution source (${meta.height}p)` : null,
          ...(analysisDone ? {} : { stage: 'downloaded' }),
        },
      },
      { new: true },
    );
    this.logger.log(`Ingested ${youtubeId}: ${meta.width}x${meta.height}, ${Math.round(meta.duration)}s, ${(meta.size / 1e6).toFixed(0)}MB`);
    if (updated) await this.afterVideoPresent(updated);
  }

  /**
   * Raw upload → 1080p H.264 working copy (niced) → the normal ingest (audio for STT, MinIO, analysis).
   * The raw file stays until the hourly cleanup removes it (24 h after the working copy exists).
   */
  private async prepareUpload(src: ReelSourceDocument): Promise<DownloadOutcome> {
    const youtubeId = src.youtubeId;
    if (!src.rawPath || !fs.existsSync(src.rawPath)) {
      await this.markFailed(youtubeId, 'unavailable: the uploaded file is no longer on the server — please upload the video again');
      return 'done';
    }
    const analysisDone = src.transcriptReady && src.minedVersion === MINING_VERSION;
    if (!analysisDone) await this.sources.updateOne({ youtubeId }, { $set: { stage: 'downloading', error: null }, $inc: { attempts: 1 } });
    const meta = await probeMedia(this.cfg.FFPROBE_BIN, src.rawPath).catch(() => null);
    if (!meta?.hasVideo || !meta.hasAudio) {
      await this.markFailed(youtubeId, 'unavailable: the uploaded file has no playable video or no sound');
      return 'done';
    }
    const dir = jobDir(this.cfg.REEL_WORK_DIR, 'ingest', youtubeId);
    try {
      const proxy = path.join(dir, 'proxy.mp4');
      const scale = meta.height > 1080 ? ['-vf', 'scale=-2:1080:flags=lanczos'] : [];
      await run(
        this.cfg.FFMPEG_BIN,
        ['-hide_banner', '-nostats', '-y', '-i', src.rawPath, ...scale, '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', '-threads', String(Math.max(2, this.cfg.REEL_FFMPEG_THREADS)), proxy],
        { timeoutMs: 8 * 3600_000, lowPriority: true },
      );
      await this.ingest(youtubeId, proxy, dir, analysisDone);
      return 'done';
    } finally {
      removeDir(dir);
    }
  }

  async markFailed(youtubeId: string, error: string) {
    await this.sources.updateOne({ youtubeId }, { $set: { stage: 'failed', error: error.slice(0, 500) } });
    await this.orchestrator.onSourceSettled(youtubeId);
  }

  private async afterVideoPresent(src: ReelSourceDocument | (ReelSource & { _id: unknown })) {
    const analysisDone = src.transcriptReady && src.minedVersion === MINING_VERSION;
    if (analysisDone) {
      if (src.stage !== 'ready') await this.sources.updateOne({ youtubeId: src.youtubeId }, { $set: { stage: 'ready' } });
      await this.orchestrator.onSourceSettled(src.youtubeId);
    } else {
      await this.queues.analyze(src.youtubeId);
    }
  }

  private async fetch(youtubeId: string, dir: string): Promise<string> {
    const output = path.join(dir, 'source.%(ext)s');
    const env = { ...process.env, XDG_CACHE_HOME: path.join(this.cfg.REEL_WORK_DIR, '.cache') };
    await this.session.withCookieFile(async (cookieFile) => {
      const args = [
        '--no-playlist',
        '--no-progress',
        '--no-warnings',
        '--newline',
        '-f',
        YTDLP_FORMAT,
        '--merge-output-format',
        'mp4',
        '--retries',
        '5',
        '--fragment-retries',
        '10',
        '--socket-timeout',
        '30',
        '-o',
        output,
        ...(cookieFile ? ['--cookies', cookieFile] : []),
        '--',
        youtubeId,
      ];
      try {
        await run(this.cfg.YTDLP_BIN, args, { timeoutMs: 45 * 60_000, env, lowPriority: true });
      } catch (err) {
        const stderr = err instanceof ExecError ? err.result.stderr : errMsg(err);
        const kind = classifyYtdlpError(stderr);
        const line = ytdlpErrorLine(stderr);
        if (kind === 'auth') throw new YouTubeAuthError(line);
        if (kind === 'unavailable') throw new VideoUnavailableError(line);
        throw new Error(`yt-dlp failed: ${line}`);
      }
    });
    const file = fs.readdirSync(dir).find((f) => f.startsWith('source.') && f.endsWith('.mp4'));
    if (!file) throw new Error('yt-dlp finished but produced no mp4');
    await this.bumpDailyCounter();
    return path.join(dir, file);
  }

  private dayKey() {
    return `downloads:${new Date().toISOString().slice(0, 10)}`;
  }

  private async underDailyCap() {
    const doc = await this.settings.findOne({ key: this.dayKey() }).lean();
    return ((doc?.value as number) ?? 0) < this.cfg.REEL_DOWNLOAD_DAILY_CAP;
  }

  private async bumpDailyCounter() {
    await this.settings.updateOne({ key: this.dayKey() }, { $inc: { value: 1 } }, { upsert: true });
  }
}
