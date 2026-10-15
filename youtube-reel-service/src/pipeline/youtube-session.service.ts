import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AppConfig, CONFIG } from '../config/config';
import { decryptText, encryptText } from '../common/crypto';
import { ExecError, run } from '../common/exec';
import { errMsg } from '../common/errors';
import { ReelSetting, ReelSettingDocument } from '../db/schemas/reel-misc.schema';
import { SourceVideo, SourceVideoDocument } from '../db/schemas/shared.readonly';
import { ReelSource, ReelSourceDocument } from '../db/schemas/reel-source.schema';
import { QueueService } from '../queue/queue.service';
import { classifyYtdlpError, normaliseCookies, ytdlpErrorLine } from './ytdlp';

const KEY = 'youtube-session';

export type SessionStatus = 'ok' | 'needs_login' | 'missing';

export interface SessionState {
  status: SessionStatus;
  cookiesEnc?: string;
  updatedAt?: Date;
  lastCheckAt?: Date;
  lastOkAt?: Date;
  lastError?: string;
  refreshedAt?: Date;
}

/**
 * Owns the YouTube session (burner-account cookies) used by yt-dlp.
 * - stored encrypted in Mongo, never in git or plain files
 * - yt-dlp's refreshed cookies are written back after every run (keeps the session alive)
 * - a rejected session pauses the download queue and asks the user to reconnect
 */
@Injectable()
export class YouTubeSessionService {
  private readonly logger = new Logger(YouTubeSessionService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @InjectModel(ReelSetting.name) private readonly settings: Model<ReelSettingDocument>,
    @InjectModel(SourceVideo.name) private readonly videos: Model<SourceVideoDocument>,
    @InjectModel(ReelSource.name) private readonly sources: Model<ReelSourceDocument>,
    private readonly queues: QueueService,
  ) {}

  async state(): Promise<SessionState> {
    const doc = await this.settings.findOne({ key: KEY }).lean();
    return (doc?.value as SessionState) ?? { status: 'missing' };
  }

  async publicState() {
    const s = await this.state();
    return {
      status: s.status,
      updatedAt: s.updatedAt ?? null,
      lastCheckAt: s.lastCheckAt ?? null,
      lastOkAt: s.lastOkAt ?? null,
      lastError: s.lastError ?? null,
      downloadsPaused: await this.queues.q.download.isPaused(),
    };
  }

  private async patch(patch: Partial<SessionState>) {
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) set[`value.${k}`] = v;
    await this.settings.updateOne({ key: KEY }, { $set: set }, { upsert: true });
  }

  /**
   * Run `fn` with a temporary cookies file (0600). Afterwards, persist the cookies yt-dlp refreshed.
   * `fn` receives null when no session is stored.
   */
  async withCookieFile<T>(fn: (cookiePath: string | null) => Promise<T>): Promise<T> {
    const s = await this.state();
    if (!s.cookiesEnc) return fn(null);
    const original = decryptText(s.cookiesEnc, this.cfg.secretKey);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ytc-')), 'cookies.txt');
    fs.writeFileSync(file, original, { mode: 0o600 });
    try {
      return await fn(file);
    } finally {
      try {
        const after = fs.readFileSync(file, 'utf8');
        if (after !== original && normaliseCookies(after).ok) {
          await this.patch({ cookiesEnc: encryptText(after, this.cfg.secretKey), refreshedAt: new Date() });
        }
      } catch (err) {
        this.logger.warn(`Cookie write-back skipped: ${errMsg(err)}`);
      }
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  }

  /** Save a cookies.txt uploaded by the user, after proving it actually works against YouTube. */
  async saveCookies(raw: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const norm = normaliseCookies(raw);
    if (!norm.ok) return norm;

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytc-'));
    const file = path.join(dir, 'cookies.txt');
    fs.writeFileSync(file, norm.text, { mode: 0o600 });
    try {
      const probe = await this.probe(file);
      if (!probe.ok) {
        return {
          ok: false,
          reason:
            probe.kind === 'auth'
              ? 'YouTube still rejects this session. Make sure you exported from a PRIVATE/INCOGNITO window while logged in, then closed that window.'
              : `Could not verify the session: ${probe.error}`,
        };
      }
      const finalText = fs.readFileSync(file, 'utf8');
      await this.patch({
        status: 'ok',
        cookiesEnc: encryptText(normaliseCookies(finalText).ok ? finalText : norm.text, this.cfg.secretKey),
        updatedAt: new Date(),
        lastCheckAt: new Date(),
        lastOkAt: new Date(),
        lastError: undefined,
      });
      await this.queues.resumeDownloads();
      await this.releaseBlockedSources();
      this.logger.log('YouTube session updated and verified; downloads resumed');
      return { ok: true };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  /** Periodic / on-demand health check of the stored session. */
  async check(): Promise<SessionState> {
    const s = await this.state();
    if (!s.cookiesEnc) {
      await this.patch({ status: 'missing', lastCheckAt: new Date() });
      return this.state();
    }
    const result = await this.withCookieFile((file) => this.probe(file!));
    if (result.ok) {
      await this.patch({ status: 'ok', lastCheckAt: new Date(), lastOkAt: new Date(), lastError: undefined });
      if (await this.queues.q.download.isPaused()) {
        await this.queues.resumeDownloads();
        await this.releaseBlockedSources();
      }
    } else if (result.kind === 'auth') {
      await this.markNeedsLogin(result.error);
    } else {
      await this.patch({ lastCheckAt: new Date(), lastError: result.error });
    }
    return this.state();
  }

  /** Videos that were waiting for a valid session go straight back into the download queue. */
  private async releaseBlockedSources() {
    const blocked = await this.sources.find({ stage: 'blocked' }).select('youtubeId').lean();
    for (const b of blocked) {
      await this.sources.updateOne({ youtubeId: b.youtubeId, stage: 'blocked' }, { $set: { stage: 'queued', error: null } });
      await this.queues.download(b.youtubeId);
    }
  }

  async markNeedsLogin(reason: string) {
    this.logger.warn(`YouTube session rejected: ${reason}`);
    await this.patch({ status: 'needs_login', lastCheckAt: new Date(), lastError: reason });
    await this.queues.pauseDownloads();
  }

  /** Ask yt-dlp for metadata of a known public video (no download). */
  private async probe(cookieFile: string): Promise<{ ok: true } | { ok: false; kind: string; error: string }> {
    const candidates = await this.videos
      .find({ privacyStatus: 'public', durationSeconds: { $gt: 240 } })
      .sort({ viewCount: -1 })
      .limit(3)
      .select('youtubeId')
      .lean();
    const ids = candidates.map((c) => c.youtubeId).filter(Boolean);
    if (!ids.length) ids.push('jNQXAC9IVRw');

    let last: { ok: false; kind: string; error: string } = { ok: false, kind: 'transient', error: 'no probe ran' };
    for (const id of ids) {
      try {
        await run(
          this.cfg.YTDLP_BIN,
          ['--cookies', cookieFile, '--skip-download', '--no-warnings', '--no-playlist', '--print', 'id', '--', id],
          { timeoutMs: 90_000, env: { ...process.env, XDG_CACHE_HOME: path.join(this.cfg.REEL_WORK_DIR, '.cache') } },
        );
        return { ok: true };
      } catch (err) {
        const stderr = err instanceof ExecError ? err.result.stderr : errMsg(err);
        const kind = classifyYtdlpError(stderr);
        last = { ok: false, kind, error: ytdlpErrorLine(stderr) };
        if (kind === 'auth') return last;
        // unavailable/transient on this video: try the next probe video
      }
    }
    return last;
  }
}
