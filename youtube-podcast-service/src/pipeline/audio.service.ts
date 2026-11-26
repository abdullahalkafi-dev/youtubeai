import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AppConfig, CONFIG } from '../config';
import { decryptText } from '../common/crypto';
import { ExecError, run } from '../common/exec';
import { ReelSettingView, ReelSettingViewDocument, ReelSourceView, ReelSourceViewDocument } from '../db/schemas';
import { PODCAST_BUCKET, REEL_SOURCES_BUCKET, StorageService } from '../storage/storage.service';
import { buildTrimFilter, planCuts, parseSilences, removedSeconds, Range } from './silence';
import { classifyYtdlpError, VideoUnavailableError, YTDLP_AUDIO_FORMAT, ytdlpErrorLine } from './ytdlp';

export interface PreparedAudio {
  mp3Path: string;
  source: 'cache' | 'download';
  originalSec: number;
  durationSec: number;
  cuts: Range[];
  removedSec: number;
  trimSkipped?: string;
}

export class YouTubeAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YouTubeAuthError';
  }
}

/** Cached video (or audio-only download) -> trimmed podcast MP3. Never writes to the reel service's cache. */
@Injectable()
export class AudioService {
  private readonly logger = new Logger(AudioService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @InjectModel(ReelSourceView.name) private readonly sources: Model<ReelSourceViewDocument>,
    @InjectModel(ReelSettingView.name) private readonly reelSettings: Model<ReelSettingViewDocument>,
    private readonly storage: StorageService,
  ) {}

  /** Where the finished MP3 is kept (MinIO bucket podcast-audio). */
  audioKey(youtubeId: string) {
    return `${youtubeId}/episode.mp3`;
  }

  async prepare(youtubeId: string, dir: string): Promise<PreparedAudio> {
    const { file, source } = await this.acquire(youtubeId, dir);
    const originalSec = await this.duration(file);
    if (!(originalSec > 60)) throw new Error(`Source audio is only ${originalSec}s long; refusing to publish it`);

    const detect = await run(
      this.cfg.FFMPEG_BIN,
      ['-hide_banner', '-nostats', '-i', file, '-map', '0:a:0', '-af', `silencedetect=n=${this.cfg.PODCAST_SILENCE_DB}dB:d=${this.cfg.PODCAST_SILENCE_MIN_SEC}`, '-f', 'null', '-'],
      { timeoutMs: 30 * 60_000, lowPriority: true },
    );
    const silences = parseSilences(detect.stderr, originalSec);
    let cuts = planCuts(silences, originalSec, { minSilence: this.cfg.PODCAST_SILENCE_MIN_SEC, keep: this.cfg.PODCAST_SILENCE_KEEP_SEC });
    let trimSkipped: string | undefined;
    if (removedSeconds(cuts) > originalSec * this.cfg.PODCAST_SILENCE_MAX_REMOVED) {
      trimSkipped = `would remove ${Math.round(removedSeconds(cuts))}s of ${Math.round(originalSec)}s (more than ${Math.round(this.cfg.PODCAST_SILENCE_MAX_REMOVED * 100)}%), so nothing was cut`;
      this.logger.warn(`${youtubeId}: ${trimSkipped}`);
      cuts = [];
    }

    const mp3Path = path.join(dir, 'episode.mp3');
    const encode = ['-c:a', 'libmp3lame', '-b:a', `${this.cfg.PODCAST_MP3_KBPS}k`, '-ar', '44100', '-ac', '2', '-id3v2_version', '3', '-write_xing', '1', '-threads', String(this.cfg.PODCAST_FFMPEG_THREADS)];
    if (cuts.length) {
      const script = path.join(dir, 'trim.txt');
      fs.writeFileSync(script, buildTrimFilter(cuts));
      await run(this.cfg.FFMPEG_BIN, ['-hide_banner', '-nostats', '-y', '-i', file, '-map', '0:a:0', '-filter_script:a', script, ...encode, mp3Path], { timeoutMs: 45 * 60_000, lowPriority: true });
    } else {
      await run(this.cfg.FFMPEG_BIN, ['-hide_banner', '-nostats', '-y', '-i', file, '-map', '0:a:0', ...encode, mp3Path], { timeoutMs: 45 * 60_000, lowPriority: true });
    }

    const removedSec = removedSeconds(cuts);
    const durationSec = await this.duration(mp3Path);
    const expected = originalSec - removedSec;
    if (Math.abs(durationSec - expected) > Math.max(5, expected * 0.01)) {
      throw new Error(`Trimmed audio is ${Math.round(durationSec)}s but ${Math.round(expected)}s was expected; not publishing it`);
    }
    this.logger.log(`${youtubeId}: ${source} audio ${Math.round(originalSec)}s -> ${Math.round(durationSec)}s (${cuts.length} pauses shortened, ${Math.round(removedSec)}s removed)`);
    return { mp3Path, source, originalSec, durationSec, cuts, removedSec, trimSkipped };
  }

  /** The reel service's cached video if it is there (audio copied straight out of MinIO), otherwise an audio-only yt-dlp download. */
  private async acquire(youtubeId: string, dir: string): Promise<{ file: string; source: 'cache' | 'download' }> {
    const cached = await this.sources.findOne({ youtubeId, videoPresent: true }).select('videoKey').lean();
    if (cached?.videoKey && (await this.storage.stat(REEL_SOURCES_BUCKET, cached.videoKey))) {
      try {
        const url = await this.storage.presignedGet(REEL_SOURCES_BUCKET, cached.videoKey);
        const out = path.join(dir, 'source.mka');
        await run(this.cfg.FFMPEG_BIN, ['-hide_banner', '-nostats', '-y', '-i', url, '-vn', '-map', '0:a:0', '-c:a', 'copy', out], { timeoutMs: 30 * 60_000, lowPriority: true });
        return { file: out, source: 'cache' };
      } catch (err) {
        this.logger.warn(`${youtubeId}: reading the cached video failed (${(err as Error).message.slice(0, 200)}); downloading the audio instead`);
      }
    }
    return { file: await this.download(youtubeId, dir), source: 'download' };
  }

  private async download(youtubeId: string, dir: string): Promise<string> {
    const free = this.freeGb(dir);
    if (free < this.cfg.PODCAST_MIN_FREE_DISK_GB) throw new Error(`Low disk space (${free.toFixed(1)} GB free); will retry later`);
    const env = { ...process.env, XDG_CACHE_HOME: path.join(this.cfg.PODCAST_WORK_DIR, '.cache') };
    const cookieText = await this.cookies();
    const cookieDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytc-'));
    const cookieFile = path.join(cookieDir, 'cookies.txt');
    if (cookieText) fs.writeFileSync(cookieFile, cookieText, { mode: 0o600 });
    try {
      const args = ['--no-playlist', '--no-progress', '--no-warnings', '--newline', '-f', YTDLP_AUDIO_FORMAT, '--retries', '5', '--fragment-retries', '10', '--socket-timeout', '30', '-o', path.join(dir, 'source.%(ext)s'), ...(cookieText ? ['--cookies', cookieFile] : []), '--', youtubeId];
      try {
        await run(this.cfg.YTDLP_BIN, args, { timeoutMs: 45 * 60_000, env, lowPriority: true });
      } catch (err) {
        const stderr = err instanceof ExecError ? err.result.stderr : String(err);
        const kind = classifyYtdlpError(stderr);
        const line = ytdlpErrorLine(stderr);
        if (kind === 'auth') throw new YouTubeAuthError(line);
        if (kind === 'unavailable') throw new VideoUnavailableError(line);
        throw new Error(`yt-dlp failed: ${line}`);
      }
    } finally {
      fs.rmSync(cookieDir, { recursive: true, force: true });
    }
    const file = fs.readdirSync(dir).find((f) => f.startsWith('source.'));
    if (!file) throw new Error('yt-dlp finished but produced no file');
    return path.join(dir, file);
  }

  /** The reel service's stored YouTube session (read only; the reel service keeps it fresh). */
  private async cookies(): Promise<string | null> {
    const doc = await this.reelSettings.findOne({ key: 'youtube-session' }).lean();
    const enc = (doc?.value as { cookiesEnc?: string } | undefined)?.cookiesEnc;
    if (!enc) return null;
    try {
      return decryptText(enc, this.cfg.secretKey);
    } catch {
      this.logger.warn('Could not decrypt the stored YouTube cookies; downloading without them');
      return null;
    }
  }

  async duration(file: string): Promise<number> {
    const { stdout } = await run(this.cfg.FFPROBE_BIN, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file], { timeoutMs: 60_000 });
    return Number(JSON.parse(stdout || '{}').format?.duration ?? 0);
  }

  private freeGb(dir: string) {
    try {
      const st = fs.statfsSync(dir);
      return (st.bavail * st.bsize) / 1024 ** 3;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }

  /** Keep the finished MP3 (about 45 MB per 48 minutes) so a re-upload never needs the video again. */
  async keep(youtubeId: string, mp3Path: string): Promise<{ key: string; bytes: number }> {
    const key = this.audioKey(youtubeId);
    await this.storage.putFile(key, mp3Path, 'audio/mpeg');
    return { key, bytes: fs.statSync(mp3Path).size };
  }

  async fetchKept(youtubeId: string, dir: string): Promise<string | null> {
    const key = this.audioKey(youtubeId);
    if (!(await this.storage.stat(PODCAST_BUCKET, key))) return null;
    const out = path.join(dir, 'episode.mp3');
    await this.storage.getFile(key, out);
    return out;
  }
}
