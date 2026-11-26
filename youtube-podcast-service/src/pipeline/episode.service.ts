import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import { AppConfig, CONFIG } from '../config';
import { BuzzsproutClient, BuzzsproutEpisode } from '../buzzsprout/buzzsprout.client';
import { PodcastEpisode, PodcastEpisodeDocument, PodcastSetting, PodcastSettingDocument, SourceVideo, SourceVideoDocument } from '../db/schemas';
import { AudioService, YouTubeAuthError } from './audio.service';
import { buildEpisodeMeta } from './metadata';
import { mapTime } from './silence';
import { VideoUnavailableError } from './ytdlp';

export const BUZZSPROUT = Symbol('BUZZSPROUT_CLIENT');

const TICK_MS = 60_000;
const DISCOVER_EVERY_MS = 5 * 60_000;
const STALE_LOCK_MS = 3 * 3_600_000;
const BACKOFF_MIN = [10, 30, 120, 360];
const normTitle = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();

@Injectable()
export class EpisodeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EpisodeService.name);
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private lastDiscover = 0;

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(BUZZSPROUT) private readonly bs: BuzzsproutClient,
    @InjectModel(PodcastEpisode.name) private readonly episodes: Model<PodcastEpisodeDocument>,
    @InjectModel(PodcastSetting.name) private readonly settings: Model<PodcastSettingDocument>,
    @InjectModel(SourceVideo.name) private readonly videos: Model<SourceVideoDocument>,
    private readonly audio: AudioService,
  ) {}

  onModuleInit() {
    if (!this.cfg.PODCAST_ENABLED) {
      this.logger.warn('PODCAST_ENABLED=false: the scheduler is off (the API still answers)');
      return;
    }
    this.logger.log(`Scheduler on (auto discovery: ${this.cfg.PODCAST_AUTO})`);
    setTimeout(() => void this.tick(), 20_000);
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------- scheduling ----------

  /** One scheduler round: free stale locks, (maybe) look for new videos, work on at most one episode. */
  async tick() {
    if (this.busy || !this.cfg.PODCAST_ENABLED) return;
    this.busy = true;
    try {
      await this.episodes.updateMany({ status: 'processing', lockedAt: { $lt: new Date(Date.now() - STALE_LOCK_MS) } }, { $set: { status: 'queued', error: 'worker stopped while processing; retrying' } });
      if (this.cfg.PODCAST_AUTO === 'on' && Date.now() - this.lastDiscover > DISCOVER_EVERY_MS) {
        this.lastDiscover = Date.now();
        await this.discover().catch((e) => this.logger.error(`discover failed: ${e.message}`));
      }
      const ep = await this.claim();
      if (ep) await this.process(ep);
    } catch (err) {
      this.logger.error(`tick failed: ${(err as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  private async autoSince(): Promise<Date> {
    if (this.cfg.PODCAST_AUTO_SINCE) return new Date(this.cfg.PODCAST_AUTO_SINCE);
    const doc = await this.settings.findOne({ key: 'auto-since' }).lean();
    if (doc?.value) return new Date(doc.value);
    const now = new Date();
    await this.settings.updateOne({ key: 'auto-since' }, { $setOnInsert: { value: now.toISOString() } }, { upsert: true });
    this.logger.log(`Auto discovery starts now: only videos published after ${now.toISOString()} are uploaded`);
    return now;
  }

  /** Queue the channel's new long public videos (never older than the auto-since moment, never twice). */
  async discover(): Promise<number> {
    const since = await this.autoSince();
    // No live-flag condition: the main app leaves finished livestream replays marked "upcoming", and a stream still running has no duration yet.
    const filter: Record<string, unknown> = {
      publishedAt: { $gte: since },
      durationSeconds: { $gte: this.cfg.PODCAST_MIN_DURATION_SEC },
      privacyStatus: 'public',
      deletedAt: null,
    };
    if (this.cfg.PODCAST_CHANNEL_ID) filter.channelId = new Types.ObjectId(this.cfg.PODCAST_CHANNEL_ID);
    const found = await this.videos.find(filter).sort({ publishedAt: 1 }).limit(30).select('youtubeId channelId title publishedAt viewCount').lean();
    let added = 0;
    for (const v of found) {
      const r = await this.episodes.updateOne(
        { youtubeId: v.youtubeId },
        { $setOnInsert: { youtubeId: v.youtubeId, channelId: v.channelId, title: v.title, videoPublishedAt: v.publishedAt, videoViews: v.viewCount, origin: 'auto', status: 'queued', attempts: 0 } },
        { upsert: true },
      );
      if (r.upsertedCount) added++;
    }
    if (added) this.logger.log(`Queued ${added} new video(s) for the podcast`);
    return added;
  }

  /** Add one specific video by hand (the Podcast page / API). Returns the episode record; an uploaded one is never queued again. */
  async enqueue(youtubeId: string, channelId?: string) {
    const v = await this.videos.findOne({ youtubeId, deletedAt: null }).select('youtubeId channelId title publishedAt viewCount privacyStatus durationSeconds').lean();
    if (!v) throw new Error('That video is not in the channel catalog');
    if (channelId && String(v.channelId) !== channelId) throw new Error('That video belongs to another channel');
    if (v.privacyStatus !== 'public') throw new Error('Only public videos can become podcast episodes');
    if ((v.durationSeconds ?? 0) < 120) throw new Error('That video is too short for a podcast episode');
    const existing = await this.episodes.findOne({ youtubeId });
    if (existing && (existing.status === 'uploaded' || existing.status === 'processing')) return existing;
    if (existing) {
      existing.status = 'queued';
      existing.attempts = 0;
      existing.error = undefined;
      existing.nextAttemptAt = undefined;
      await existing.save();
      return existing;
    }
    return this.episodes.create({ youtubeId, channelId: v.channelId, title: v.title, videoPublishedAt: v.publishedAt, videoViews: v.viewCount, origin: 'manual', status: 'queued', attempts: 0 });
  }

  async retry(youtubeId: string) {
    return this.episodes.findOneAndUpdate({ youtubeId, status: { $in: ['failed', 'skipped'] } }, { $set: { status: 'queued', attempts: 0, error: null, nextAttemptAt: null } }, { new: true });
  }

  private claim() {
    const now = new Date();
    return this.episodes.findOneAndUpdate(
      { status: 'queued', $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $exists: false } }, { nextAttemptAt: { $lte: now } }] },
      { $set: { status: 'processing', lockedAt: now, error: null } },
      { sort: { origin: -1, videoPublishedAt: 1 }, new: true },
    );
  }

  // ---------- one episode ----------

  private async save(id: Types.ObjectId, set: Record<string, unknown>) {
    await this.episodes.updateOne({ _id: id }, { $set: set });
  }

  async process(ep: PodcastEpisodeDocument): Promise<void> {
    const id = ep._id as Types.ObjectId;
    const youtubeId = ep.youtubeId;
    const dir = fs.mkdtempSync(path.join(this.cfg.PODCAST_WORK_DIR, `ep-${youtubeId}-`));
    const stage = async (name: string) => {
      ep.stage = name;
      await this.save(id, { stage: name, lockedAt: new Date(), startedAt: ep.startedAt ?? new Date() });
    };
    try {
      this.logger.log(`Episode ${youtubeId}: start (attempt ${ep.attempts + 1})`);
      const video = await this.videos.findOne({ youtubeId, deletedAt: null }).lean();
      if (!video) throw new VideoUnavailableError('The video is no longer in the catalog');

      // 1. audio (trimmed MP3, kept in MinIO)
      let mp3: string | null = null;
      if (!ep.audio) {
        await stage('audio');
        const prepared = await this.audio.prepare(youtubeId, dir);
        const kept = await this.audio.keep(youtubeId, prepared.mp3Path);
        ep.audio = { source: prepared.source, key: kept.key, bytes: kept.bytes, originalSec: prepared.originalSec, durationSec: prepared.durationSec, removedSec: prepared.removedSec, cuts: prepared.cuts, trimSkipped: prepared.trimSkipped };
        await this.save(id, { audio: ep.audio });
        mp3 = prepared.mp3Path;
      }

      // 2. text (title, description, tags, chapters) from the YouTube video, timestamps mapped through the cuts
      if (!ep.meta) {
        await stage('meta');
        const audio = ep.audio!;
        ep.meta = buildEpisodeMeta(
          { youtubeId, title: video.title, description: video.description, tags: video.tags },
          { mapTime: (t) => mapTime(t, audio.cuts), durationSec: audio.durationSec, maxTags: this.cfg.PODCAST_MAX_TAGS, youtubeLink: this.cfg.PODCAST_YT_LINK },
        );
        await this.save(id, { meta: ep.meta });
      }
      const meta = ep.meta!;
      if (this.cfg.PODCAST_DRY_RUN) {
        await this.save(id, { status: 'skipped', stage: 'meta', error: 'dry run: audio and text prepared, nothing sent to Buzzsprout', finishedAt: new Date(), lockedAt: null });
        this.logger.log(`Episode ${youtubeId}: dry run finished (audio ${Math.round(ep.audio!.durationSec)}s, ${meta.chapters.length} chapters); nothing was sent`);
        return;
      }
      const bz = (ep.buzzsprout ?? {}) as NonNullable<PodcastEpisode['buzzsprout']>;
      ep.buzzsprout = bz;
      const saveBz = () => this.save(id, { buzzsprout: bz });

      // 3. the Buzzsprout episode (private until the very end). Never a second one for the same title.
      if (!bz.episodeId) {
        await stage('create');
        const existing = await this.findByTitle(meta.title);
        if (existing && (existing.duration > 0 || existing.audio_url)) {
          await this.save(id, { status: 'skipped', stage: 'create', error: `Already on Buzzsprout (episode ${existing.id}, same title); nothing uploaded`, finishedAt: new Date(), buzzsprout: { existingEpisodeId: existing.id, pageUrl: pageUrl(existing.audio_url) } });
          this.logger.warn(`Episode ${youtubeId}: already on Buzzsprout as ${existing.id}; skipped`);
          return;
        }
        const created = existing ?? (await this.bs.createEpisode({ title: meta.title, description: meta.descriptionHtml, tags: meta.tags || undefined, artist: this.cfg.PODCAST_ARTIST }));
        bz.episodeId = created.id;
        await saveBz();
      }
      const episodeId = bz.episodeId!;

      // 4. audio upload (start -> PUT -> complete)
      if (!bz.uploadDone) {
        await stage('upload');
        // Never put audio on an episode that already has processed audio (a crash right after a good upload, a record that lost its flags).
        const current = await this.bs.getEpisode(episodeId);
        if (current.duration > 0) {
          this.logger.warn(`Episode ${youtubeId}: Buzzsprout episode ${episodeId} already has audio; not uploading again`);
        } else {
          const file = mp3 ?? (await this.audio.fetchKept(youtubeId, dir));
          if (!file) {
            ep.audio = undefined;
            await this.save(id, { audio: null });
            throw new Error('The kept MP3 is missing from storage; it will be made again on the next attempt');
          }
          const bytes = fs.statSync(file).size;
          const up = await this.bs.startUpload(episodeId, { filename: `${youtubeId}.mp3`, byteSize: bytes, type: 'audio/mpeg' });
          bz.uploadId = up.id;
          await saveBz();
          await this.bs.putFile(up.upload_url, file, bytes, 'audio/mpeg');
          await this.bs.completeUpload(episodeId, up.id);
        }
        bz.uploadDone = true;
        await saveBz();
      }

      // 5. wait for Buzzsprout's processing
      let live: BuzzsproutEpisode | null = null;
      if (!bz.processed) {
        await stage('processing');
        live = await this.bs.waitProcessed(episodeId);
        bz.processed = true;
        bz.audioUrl = live.audio_url ?? undefined;
        bz.pageUrl = pageUrl(live.audio_url);
        await saveBz();
      }

      // 6. chapters (a failure here must not hold the episode back)
      if (!bz.chaptersDone && meta.chapters.length >= 2) {
        await stage('chapters');
        try {
          await this.bs.putChapters(episodeId, meta.chapters);
          bz.chaptersDone = true;
          await saveBz();
        } catch (err) {
          this.logger.warn(`Episode ${youtubeId}: chapters not set (${(err as Error).message.slice(0, 200)}); publishing without them`);
        }
      }

      // 7. publish (now)
      if (!bz.published) {
        await stage('publish');
        const at = new Date();
        const done = await this.bs.publish(episodeId, at);
        bz.published = true;
        bz.publishedAt = at;
        bz.audioUrl = done.audio_url ?? bz.audioUrl;
        bz.pageUrl = pageUrl(done.audio_url) ?? bz.pageUrl;
        await saveBz();
      }

      await this.save(id, { status: 'uploaded', stage: 'done', error: null, finishedAt: new Date(), lockedAt: null });
      this.logger.log(`Episode ${youtubeId}: published on Buzzsprout (episode ${episodeId})`);
    } catch (err) {
      await this.fail(ep, err);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  private async fail(ep: PodcastEpisodeDocument, err: unknown) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    const id = ep._id as Types.ObjectId;
    if (err instanceof VideoUnavailableError) {
      await this.save(id, { status: 'skipped', error: `unavailable: ${message}`, finishedAt: new Date(), lockedAt: null });
      this.logger.warn(`Episode ${ep.youtubeId}: skipped (${message})`);
      return;
    }
    const attempts = ep.attempts + 1;
    const final = attempts >= this.cfg.PODCAST_MAX_ATTEMPTS || (err as any)?.permanent === true;
    const wait = BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)];
    await this.save(id, {
      status: final ? 'failed' : 'queued',
      attempts,
      error: `${ep.stage ?? 'start'}: ${message}`,
      nextAttemptAt: final ? null : new Date(Date.now() + wait * 60_000),
      lockedAt: null,
    });
    this.logger.error(`Episode ${ep.youtubeId} failed at ${ep.stage} (attempt ${attempts}${final ? ', giving up' : `, retry in ${wait} min`}): ${message}`);
    if (final || err instanceof YouTubeAuthError) await this.alert(`Podcast: "${ep.title}" (${ep.youtubeId}) ${final ? 'FAILED for good' : 'is waiting'} at ${ep.stage}: ${message}`);
  }

  private async findByTitle(title: string): Promise<BuzzsproutEpisode | null> {
    const all = await this.bs.listEpisodes();
    const n = normTitle(title);
    return all.find((e) => normTitle(e.title) === n) ?? null;
  }

  /** Developer alert only (never the client UI): ntfy.sh topic URL (plain text) or a Slack/Discord-style webhook (JSON). */
  async alert(text: string) {
    const url = this.cfg.ALERT_WEBHOOK_URL;
    if (!url) return;
    try {
      const ntfy = /ntfy\./i.test(url);
      await fetch(url, { method: 'POST', headers: { 'Content-Type': ntfy ? 'text/plain' : 'application/json' }, body: ntfy ? text : JSON.stringify({ text, content: text }), signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      this.logger.warn(`alert not sent: ${(err as Error).message}`);
    }
  }

  // ---------- read side (for the Podcast page) ----------

  list(channelId: string, limit = 50) {
    return this.episodes
      .find({ channelId: new Types.ObjectId(channelId) })
      .sort({ videoPublishedAt: -1 })
      .limit(limit)
      .select('-meta.descriptionHtml -audio.cuts')
      .lean();
  }

  async counts(channelId: string) {
    const rows = await this.episodes.aggregate([{ $match: { channelId: new Types.ObjectId(channelId) } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
    const out: Record<string, number> = { queued: 0, processing: 0, uploaded: 0, failed: 0, skipped: 0 };
    for (const r of rows) out[r._id] = r.n;
    return out;
  }

  async autoSinceForStatus(): Promise<string | null> {
    if (this.cfg.PODCAST_AUTO !== 'on') return null;
    return (await this.autoSince()).toISOString();
  }
}

/** The public page of an episode is its audio URL without ".mp3". */
export function pageUrl(audioUrl: string | null | undefined): string | undefined {
  return audioUrl ? audioUrl.replace(/\.mp3$/i, '') : undefined;
}
