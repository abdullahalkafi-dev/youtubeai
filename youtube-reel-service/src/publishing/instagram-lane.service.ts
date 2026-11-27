import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { errMsg } from '../common/errors';
import { nyDate } from '../common/time';
import { AppConfig, CONFIG } from '../config/config';
import { ReelPost, ReelPostDocument } from '../db/schemas/reel-post.schema';
import { ReelSetting, ReelSettingDocument } from '../db/schemas/reel-misc.schema';
import { Reel, ReelDocument } from '../db/schemas/reel.schema';
import { SharedChannel, SharedChannelDocument, SourceVideo, SourceVideoDocument } from '../db/schemas/shared.readonly';
import { nyDayRange } from '../pipeline/ops-report';
import { DEFAULT_AUTO_SETTINGS, gateReason, jitterRunAt, MIN_GAP_MIN, nyToUtc, seededRandom } from './auto-plan';
import { backlogOrder, BacklogRow, countsOf, DayCounts, dueSlots, facebookMetadata, laneCaps, LaneConfig, laneConfig, LanePostRow, LaneSlot, laneSlots, laneTrouble, RETENTION_MIN_VIEWS, totalOf } from './facebook-lane';
import { InstagramPublisher } from './instagram.publisher';
import { PublishService } from './publish.service';
import { INSTAGRAM_LANE_SOURCES, InstagramLaneSource, PostMetadata } from './types';

const stateKey = (channelId: string) => `instagram-lane:${channelId}`;
const dayKey = (channelId: string, date: string) => `instagram-lane-day:${channelId}:${date}`;
/** The upload starts about this long after the post is created at the earliest (same lead as the other lanes). */
const LEAD_MS = 3 * 60_000;
const MAX_TRIES = 12;
const NEWEST_STOCK_DAYS = 10;
/** A mirror goes out this long (a random 2 to 6 minutes) after the YouTube post, so it is never the same second as the Facebook one. */
const MIRROR_DELAY_MIN = [2, 6] as const;

export interface InstagramLaneState {
  goLiveAt: Date;
  pausedReason: string | null;
  pausedAt: Date | null;
}

interface Candidate {
  reelId: string;
  score: number | null;
  metadata?: Partial<PostMetadata>;
  title: string;
  youtubeUrl: string | null;
  publishedAt?: Date;
}

/** The Instagram lane settings, read from the INSTAGRAM_* env (the rules themselves are the Facebook lane's pure functions). */
export function instagramLaneConfig(cfg: Pick<AppConfig, 'INSTAGRAM_AUTO' | 'INSTAGRAM_NEW_PER_DAY' | 'INSTAGRAM_BACKLOG_PER_DAY' | 'INSTAGRAM_BACKLOG_DAYS' | 'INSTAGRAM_BACKLOG_ORDER' | 'INSTAGRAM_EXTRA_SLOT_ET' | 'INSTAGRAM_BACKLOG_SLOTS_ET'>): LaneConfig {
  return laneConfig({
    FACEBOOK_AUTO: cfg.INSTAGRAM_AUTO,
    FACEBOOK_NEW_PER_DAY: cfg.INSTAGRAM_NEW_PER_DAY,
    FACEBOOK_BACKLOG_PER_DAY: cfg.INSTAGRAM_BACKLOG_PER_DAY,
    FACEBOOK_BACKLOG_DAYS: cfg.INSTAGRAM_BACKLOG_DAYS,
    FACEBOOK_BACKLOG_ORDER: cfg.INSTAGRAM_BACKLOG_ORDER,
    FACEBOOK_EXTRA_SLOT_ET: cfg.INSTAGRAM_EXTRA_SLOT_ET,
    FACEBOOK_BACKLOG_SLOTS_ET: cfg.INSTAGRAM_BACKLOG_SLOTS_ET,
  });
}

/**
 * The Instagram lanes (client decision 2026-11-26): the same reels as Facebook, 3 new + 2 backlog a day, 5 in all, each at a random
 * time within INSTAGRAM_JITTER_MIN (2) minutes of its slot. Works on posts with platform 'instagram' and an `ig-*` source only; it never
 * reads or changes a YouTube or Facebook post. INSTAGRAM_AUTO=off stops all of it; a problem on Instagram pauses only this lane.
 */
@Injectable()
export class InstagramLaneService implements OnModuleInit {
  private readonly logger = new Logger(InstagramLaneService.name);
  readonly lane: LaneConfig;

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @InjectModel(ReelSetting.name) private readonly settings: Model<ReelSettingDocument>,
    @InjectModel(ReelPost.name) private readonly posts: Model<ReelPostDocument>,
    @InjectModel(Reel.name) private readonly reels: Model<ReelDocument>,
    @InjectModel(SharedChannel.name) private readonly channels: Model<SharedChannelDocument>,
    @InjectModel(SourceVideo.name) private readonly videos: Model<SourceVideoDocument>,
    private readonly publish: PublishService,
    private readonly instagram: InstagramPublisher,
  ) {
    this.lane = instagramLaneConfig(cfg);
  }

  onModuleInit() {
    // The mirror: every YouTube post that goes live is offered to Instagram (detached by PublishService: it cannot slow or fail YouTube).
    this.publish.onYoutubePublished(async (p) => {
      await this.mirror(p);
    });
  }

  get enabled() {
    return this.lane.enabled;
  }

  // ------------------------------------------------------------------ state

  async state(channelId: string, firstSeen = new Date()): Promise<InstagramLaneState> {
    const read = async () => (await this.settings.findOne({ key: stateKey(channelId) }).lean())?.value as Partial<InstagramLaneState> | undefined;
    let v = await read();
    if (!v?.goLiveAt) {
      const configured = this.cfg.INSTAGRAM_AUTO_SINCE ? new Date(this.cfg.INSTAGRAM_AUTO_SINCE) : null;
      const goLiveAt = configured && !Number.isNaN(configured.getTime()) ? configured : firstSeen;
      try {
        await this.settings.updateOne({ key: stateKey(channelId) }, { $setOnInsert: { value: { goLiveAt, pausedReason: null, pausedAt: null } } }, { upsert: true });
      } catch (err: any) {
        if (err?.code !== 11000) throw err;
      }
      v = await read();
    }
    return { goLiveAt: new Date(v?.goLiveAt as Date), pausedReason: v?.pausedReason ?? null, pausedAt: v?.pausedAt ? new Date(v.pausedAt) : null };
  }

  async pause(channelId: string, reason: string) {
    await this.state(channelId);
    await this.settings.updateOne({ key: stateKey(channelId) }, { $set: { 'value.pausedReason': reason, 'value.pausedAt': new Date() } });
    const waiting = await this.posts
      .find({ channelId: new Types.ObjectId(channelId), platform: 'instagram', source: { $in: [...INSTAGRAM_LANE_SOURCES] }, status: { $in: ['queued', 'blocked'] } })
      .select('_id')
      .lean();
    for (const p of waiting) await this.publish.cancel(channelId, String(p._id)).catch(() => undefined);
    this.logger.warn(`Instagram lane paused for ${channelId}: ${reason} (${waiting.length} waiting post(s) cancelled)`);
  }

  async resume(channelId: string) {
    await this.state(channelId);
    await this.settings.updateOne({ key: stateKey(channelId) }, { $set: { 'value.pausedReason': null, 'value.pausedAt': null } });
  }

  /** Stops by itself when Instagram refuses the login/permission or rejects 2 reels in the day. */
  async guard(channelId: string, now = new Date()): Promise<string | null> {
    const state = await this.state(channelId);
    if (state.pausedReason) return state.pausedReason;
    const { start, end } = nyDayRange(nyDate(now));
    const rows = await this.posts
      .find({ channelId: new Types.ObjectId(channelId), platform: 'instagram', source: { $in: [...INSTAGRAM_LANE_SOURCES] }, updatedAt: { $gte: start, $lt: end } })
      .select('status errorCode error warnings')
      .lean();
    const reason = laneTrouble(rows as LanePostRow[])?.replace(/Facebook/g, 'Instagram') ?? null;
    if (reason) await this.pause(channelId, reason);
    return reason;
  }

  // ------------------------------------------------------------------ counting

  async dayCounts(channelId: string, date: string): Promise<DayCounts> {
    const { start, end } = nyDayRange(date);
    const rows = await this.posts
      .find({ channelId: new Types.ObjectId(channelId), platform: 'instagram', source: { $in: [...INSTAGRAM_LANE_SOURCES] }, createdAt: { $gte: start, $lt: end }, status: { $ne: 'cancelled' } })
      .select('source')
      .lean();
    return countsOf(rows.map((r) => String(r.source)), 'ig');
  }

  private async owner(channelId: string): Promise<string> {
    const ch = await this.channels.findOne({ _id: new Types.ObjectId(channelId) }).select('userId').lean();
    if (!ch?.userId) throw new Error('Channel owner not found');
    return String(ch.userId);
  }

  private async onInstagram(reelId: string): Promise<boolean> {
    return !!(await this.posts.exists({ reelId: new Types.ObjectId(reelId), platform: 'instagram', status: { $nin: ['cancelled', 'failed'] } }));
  }

  // ------------------------------------------------------------------ the mirror

  /** A YouTube post just went live: post the same reel to Instagram a few minutes later (once per reel, only after go-live). */
  async mirror(p: { id: string; reelId: string; channelId: string; publishedAt: Date }): Promise<'posted' | 'skipped'> {
    if (!this.enabled) return 'skipped';
    const state = await this.state(p.channelId, p.publishedAt);
    if (state.pausedReason) return 'skipped';
    if (p.publishedAt.getTime() < state.goLiveAt.getTime()) return 'skipped';
    const now = new Date();
    if (!laneCaps(this.lane, await this.dayCounts(p.channelId, nyDate(now))).mirror) return 'skipped';
    if (await this.onInstagram(p.reelId)) return 'skipped';
    if (!(await this.publish.lookAllowedIds([p.reelId])).has(p.reelId)) return 'skipped'; // classic / no-look reels stay on YouTube only
    const yt = await this.posts.findById(p.id).select('metadata').lean();
    if (!yt?.metadata) return 'skipped';
    const [lo, hi] = MIRROR_DELAY_MIN;
    const delayMs = Math.round((lo + seededRandom(`ig-mirror:${p.id}`)() * (hi - lo)) * 60_000);
    await this.publish.createInstagramPost(p.channelId, await this.owner(p.channelId), p.reelId, {
      source: 'ig-mirror',
      runAt: new Date(now.getTime() + delayMs),
      slot: 'mirror',
      planDate: nyDate(now),
      metadata: facebookMetadata(yt.metadata),
      score: null,
    });
    this.logger.log(`Instagram mirror: reel ${p.reelId} queued about ${Math.round(delayMs / 60_000)} min after its YouTube post`);
    return 'posted';
  }

  // ------------------------------------------------------------------ candidates

  private async youtubeRetention(youtubeIds: Array<string | undefined | null>): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const ids = [...new Set(youtubeIds.filter((x): x is string => Boolean(x)))];
    if (!ids.length || this.lane.backlogOrder !== 'retention') return out;
    try {
      const vids = await this.videos.find({ youtubeId: { $in: ids }, lastAnalyticsSync: { $exists: true } }).select('youtubeId retentionPercent viewCount').lean();
      for (const v of vids) {
        if (typeof v.retentionPercent === 'number' && Number.isFinite(v.retentionPercent) && (v.viewCount ?? 0) >= RETENTION_MIN_VIEWS) out.set(String(v.youtubeId), v.retentionPercent);
      }
    } catch (err) {
      this.logger.warn(`YouTube retention lookup failed, using newest-first: ${errMsg(err)}`);
    }
    return out;
  }

  /** Reels with a YouTube post published inside the window and nothing on Instagram yet (same order as the Facebook backlog). */
  async backlogPool(channelId: string, now = new Date(), exclude: Set<string> = new Set()): Promise<Candidate[]> {
    const cid = new Types.ObjectId(channelId);
    const since = new Date(now.getTime() - this.lane.backlogDays * 86_400_000);
    const yt = await this.posts
      .find({ channelId: cid, platform: 'youtube', status: 'published', publishedAt: { $gte: since } })
      .sort({ publishedAt: -1 })
      .limit(500)
      .select('reelId publishedAt metadata url externalId')
      .lean();
    const retentionByYoutubeId = await this.youtubeRetention(yt.map((p) => p.externalId));
    const ids = [...new Set(yt.map((p) => String(p.reelId)))];
    const onIg = ids.length ? await this.posts.find({ reelId: { $in: ids.map((i) => new Types.ObjectId(i)) }, platform: 'instagram', status: { $nin: ['cancelled', 'failed'] } }).select('reelId').lean() : [];
    const blocked = new Set([...onIg.map((p) => String(p.reelId)), ...exclude]);
    const rows: Array<BacklogRow & { metadata: PostMetadata; url: string | null }> = yt.map((p) => ({
      reelId: String(p.reelId),
      publishedAt: new Date(p.publishedAt as Date),
      metadata: p.metadata,
      url: p.url ?? null,
      retention: retentionByYoutubeId.get(String(p.externalId)) ?? null,
    }));
    const ordered = backlogOrder(rows, blocked, now, this.lane.backlogDays, this.lane.backlogOrder);
    const lookOk = await this.publish.lookAllowedIds(ordered.map((r) => r.reelId)); // only full-screen reels (SOCIAL_LOOK_ONLY)
    return ordered.filter((r) => lookOk.has(r.reelId)).map((r) => ({
      reelId: r.reelId,
      score: r.retention ?? null,
      metadata: facebookMetadata(r.metadata),
      title: r.metadata?.title ?? 'Reel',
      youtubeUrl: r.url,
      publishedAt: r.publishedAt,
    }));
  }

  /** Newest finished reels that are on neither YouTube nor Instagram yet and pass the same quality gate the YouTube lane uses. */
  async extraPool(channelId: string, now = new Date(), exclude: Set<string> = new Set()): Promise<Candidate[]> {
    const cid = new Types.ObjectId(channelId);
    const auto = ((await this.settings.findOne({ key: `autopublish:${channelId}` }).lean())?.value ?? {}) as { minScore?: number };
    const minScore = Number.isFinite(auto.minScore) ? Number(auto.minScore) : DEFAULT_AUTO_SETTINGS.minScore;
    const rows = await this.reels
      .find({ channelId: cid, status: 'todo', createdAt: { $gte: new Date(now.getTime() - NEWEST_STOCK_DAYS * 86_400_000) } })
      .sort({ createdAt: -1 })
      .limit(40)
      .select('scores.overall critique.verdict packaging.title concept')
      .lean();
    if (!rows.length) return [];
    // A reel already on YouTube is a backlog reel, not a new one; a reel only on Facebook is fine (the same reels go to both).
    const taken = await this.posts.find({ reelId: { $in: rows.map((r) => r._id) }, platform: { $in: ['youtube', 'instagram'] }, status: { $nin: ['cancelled', 'failed'] } }).select('reelId').lean();
    const used = new Set([...taken.map((p) => String(p.reelId)), ...exclude]);
    const lookOk = await this.publish.lookAllowedIds(rows.map((r) => String(r._id))); // only full-screen reels (SOCIAL_LOOK_ONLY)
    return rows
      .filter((r) => !used.has(String(r._id)) && lookOk.has(String(r._id)))
      .filter((r) => !gateReason({ score: r.scores?.overall ?? null, verdict: r.critique?.verdict ?? null, preflightErrors: [], hasActivePost: false, minScore }))
      .map((r) => ({ reelId: String(r._id), score: r.scores?.overall ?? null, title: r.packaging?.title || r.concept || 'Reel', youtubeUrl: null }));
  }

  // ------------------------------------------------------------------ the day's slots

  private async claimed(channelId: string, date: string): Promise<string[]> {
    const doc = await this.settings.findOne({ key: dayKey(channelId, date) }).lean();
    return Object.keys((doc?.value as { slots?: Record<string, unknown> } | undefined)?.slots ?? {});
  }

  private async claim(channelId: string, date: string, slotId: string): Promise<boolean> {
    try {
      const r = await this.settings.updateOne(
        { key: dayKey(channelId, date), [`value.slots.${slotId}`]: { $exists: false } },
        { $set: { [`value.slots.${slotId}`]: { state: 'claimed', at: new Date() } } },
        { upsert: true },
      );
      return (r.upsertedCount ?? 0) + (r.modifiedCount ?? 0) > 0;
    } catch (err: any) {
      if (err?.code === 11000) return false;
      throw err;
    }
  }

  private async mark(channelId: string, date: string, slotId: string, state: string, extra: Record<string, unknown> = {}) {
    await this.settings.updateOne({ key: dayKey(channelId, date) }, { $set: { [`value.slots.${slotId}`]: { state, at: new Date(), ...extra } } });
  }

  private async release(channelId: string, date: string, slotId: string) {
    await this.settings.updateOne({ key: dayKey(channelId, date) }, { $unset: { [`value.slots.${slotId}`]: '' } });
  }

  private async todayRunTimes(channelId: string, date: string): Promise<number[]> {
    const { start, end } = nyDayRange(date);
    const rows = await this.posts
      .find({ channelId: new Types.ObjectId(channelId), platform: 'instagram', source: { $in: [...INSTAGRAM_LANE_SOURCES] }, createdAt: { $gte: start, $lt: end }, status: { $ne: 'cancelled' } })
      .select('autoPlan.runAt createdAt')
      .lean();
    return rows.map((r) => new Date((r.autoPlan?.runAt as Date | undefined) ?? (r.createdAt as Date)).getTime());
  }

  /** A random second within INSTAGRAM_JITTER_MIN (2) minutes either side of the slot, never earlier than a few minutes from now. */
  private runAtFor(date: string, slot: LaneSlot, now: Date, others: number[], channelId: string): Date {
    const gap = MIN_GAP_MIN * 60_000;
    const futureOthers = others.filter((o) => o + gap > now.getTime());
    const earliest = Math.max(now.getTime() + LEAD_MS, ...futureOthers.map((o) => o + gap));
    return jitterRunAt({ date, slot: slot.time, seed: `ig:${channelId}:${date}:${slot.id}`, earliest, others, jitterMin: this.cfg.INSTAGRAM_JITTER_MIN });
  }

  // ------------------------------------------------------------------ the periodic job

  /** Every 10 minutes (maintenance task 'instagram-lane'). Does nothing unless INSTAGRAM_AUTO is on. */
  async runDue(now = new Date()) {
    if (!this.enabled) return;
    const ids = ((await this.reels.distinct('channelId')) as Types.ObjectId[]).map(String);
    for (const channelId of ids) {
      try {
        await this.tick(channelId, now);
      } catch (err) {
        this.logger.warn(`Instagram lane for channel ${channelId}: ${errMsg(err)}`);
      }
    }
  }

  async tick(channelId: string, now = new Date()) {
    await this.state(channelId, now);
    const trouble = await this.guard(channelId, now);
    if (trouble) return { status: 'paused' as const, reason: trouble };
    const account = await this.instagram.getAccountStatus(channelId);
    if (account.state !== 'ok') return { status: 'instagram-not-connected' as const };
    return this.plan(channelId, now);
  }

  /** Creates the day's extra and backlog posts as their slots come within the planning window; the caps (3 new + 2 backlog = 5) are checked every time. */
  async plan(channelId: string, now = new Date()) {
    const date = nyDate(now);
    const due = dueSlots(date, now, laneSlots(this.lane), await this.claimed(channelId, date));
    if (!due.length) return { status: 'nothing-due' as const };
    const owner = await this.owner(channelId);
    const made: string[] = [];
    for (const slot of due) {
      if (!(await this.claim(channelId, date, slot.id))) continue;
      try {
        const counts = await this.dayCounts(channelId, date);
        const caps = laneCaps(this.lane, counts);
        if (slot.kind === 'extra' ? !caps.extra : !caps.backlog) {
          await this.mark(channelId, date, slot.id, 'skipped', { reason: 'daily cap reached' });
          continue;
        }
        const others = await this.todayRunTimes(channelId, date);
        const runAt = this.runAtFor(date, slot, now, others, channelId);
        const source: InstagramLaneSource = slot.kind === 'extra' ? 'ig-extra' : 'ig-backlog';
        let pool = slot.kind === 'extra' ? await this.extraPool(channelId, now) : await this.backlogPool(channelId, now);
        if (slot.kind === 'extra' && !pool.length) pool = await this.backlogPool(channelId, now);
        const postId = await this.createFromPool(channelId, owner, pool, { source, runAt, slot: slot.time, planDate: date });
        if (postId === 'cap') await this.mark(channelId, date, slot.id, 'skipped', { reason: 'Instagram 24-hour limit' });
        else if (postId) {
          await this.mark(channelId, date, slot.id, 'planned', { postId });
          made.push(postId);
        } else await this.mark(channelId, date, slot.id, 'empty');
      } catch (err) {
        await this.release(channelId, date, slot.id).catch(() => undefined);
        throw err;
      }
    }
    if (made.length) this.logger.log(`Instagram lane ${date} for ${channelId}: ${made.length} post(s) planned`);
    return { status: 'planned' as const, planned: made.length };
  }

  private async createFromPool(
    channelId: string,
    owner: string,
    pool: Candidate[],
    o: { source: InstagramLaneSource; runAt: Date; slot: string; planDate: string },
  ): Promise<string | 'cap' | null> {
    let tries = 0;
    for (const c of pool) {
      if (tries++ >= MAX_TRIES) break;
      try {
        let metadata = c.metadata;
        if (!metadata) {
          const reel = await this.reels.findById(c.reelId);
          if (!reel) continue;
          metadata = facebookMetadata(await this.publish.defaultMetadata(reel));
        }
        const post = await this.publish.createInstagramPost(channelId, owner, c.reelId, { source: o.source, runAt: o.runAt, slot: o.slot, planDate: o.planDate, metadata, score: c.score });
        return post.id;
      } catch (err) {
        if (isLimitError(err)) return 'cap';
        this.logger.warn(`Instagram lane: reel ${c.reelId} skipped (${errMsg(err).slice(0, 160)})`);
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ preview (read-only)

  /** What the lanes would post in the next 24 hours, without creating anything. */
  async preview(channelId: string, now = new Date()) {
    const end = now.getTime() + 24 * 3_600_000;
    const slots = laneSlots(this.lane);
    const used = new Set<string>();
    const items: Array<{ kind: string; date: string; time: string; reelId: string | null; title: string; youtubeUrl: string | null; note?: string }> = [];
    const counts = await this.dayCounts(channelId, nyDate(now));
    const state = await this.state(channelId, now).catch(() => null);
    const claimedToday = new Set(await this.claimed(channelId, nyDate(now)));
    for (const date of [nyDate(now), nyDate(new Date(now.getTime() + 24 * 3_600_000))]) {
      const isToday = date === nyDate(now);
      const left = { ...counts };
      if (!isToday) Object.assign(left, { mirror: 0, extra: 0, backlog: 0 });
      for (const slot of slots) {
        const at = nyToUtc(date, slot.time).getTime();
        if (at > end || (isToday && claimedToday.has(slot.id))) continue;
        if (at < now.getTime() - 3 * 3_600_000 && isToday) continue;
        const caps = laneCaps(this.lane, left);
        if (slot.kind === 'extra' ? !caps.extra : !caps.backlog) {
          items.push({ kind: slot.kind, date, time: slot.time, reelId: null, title: '', youtubeUrl: null, note: 'daily cap reached' });
          continue;
        }
        let pool = slot.kind === 'extra' ? await this.extraPool(channelId, now, used) : await this.backlogPool(channelId, now, used);
        if (slot.kind === 'extra' && !pool.length) pool = await this.backlogPool(channelId, now, used);
        const pick = pool[0];
        if (!pick) {
          items.push({ kind: slot.kind, date, time: slot.time, reelId: null, title: '', youtubeUrl: null, note: 'nothing available' });
          continue;
        }
        used.add(pick.reelId);
        if (slot.kind === 'extra') left.extra++;
        else left.backlog++;
        items.push({ kind: slot.kind, date, time: slot.time, reelId: pick.reelId, title: pick.title, youtubeUrl: pick.youtubeUrl });
      }
    }
    const backlog = await this.backlogPool(channelId, now);
    return { enabled: this.enabled, paused: state?.pausedReason ?? null, goLiveAt: state?.goLiveAt ?? null, todayCounts: counts, items, backlogSize: backlog.length };
  }

  // ------------------------------------------------------------------ what the app shows

  /** GET …/instagram/overview. Never contains a token; an Instagram problem degrades the follower count to null. */
  async overview(channelId: string, now = new Date()) {
    const cid = new Types.ObjectId(channelId);
    const account = await this.instagram.getAccountStatus(channelId);
    const connected = account.state !== 'missing';
    const state = await this.state(channelId, now).catch(() => null);
    const counts = await this.dayCounts(channelId, nyDate(now));
    const [stats, backlog, totals, recent] = await Promise.all([
      connected ? this.instagram.accountStats(channelId) : Promise.resolve(null),
      this.backlogPool(channelId, now).catch(() => []),
      this.posts.aggregate<{ posts: number; views: number; likes: number; comments: number }>([
        { $match: { channelId: cid, platform: 'instagram', status: 'published' } },
        {
          $group: {
            _id: null,
            posts: { $sum: 1 },
            views: { $sum: { $ifNull: ['$latestMetrics.views', 0] } },
            likes: { $sum: { $ifNull: ['$latestMetrics.likes', 0] } },
            comments: { $sum: { $ifNull: ['$latestMetrics.comments', 0] } },
          },
        },
      ]),
      this.posts.find({ channelId: cid, platform: 'instagram', status: { $ne: 'cancelled' } }).sort({ createdAt: -1 }).limit(30).lean(),
    ]);
    const t = totals[0] ?? { posts: 0, views: 0, likes: 0, comments: 0 };
    return {
      connected,
      state: account.state,
      account: connected && account.externalId ? { id: account.externalId, name: account.displayName ?? '', followers: stats?.followers ?? null, mediaCount: stats?.mediaCount ?? null, fetchedAt: (stats?.fetchedAt ?? new Date()).toISOString() } : null,
      lanes: {
        enabled: this.enabled,
        paused: !!state?.pausedReason,
        pausedReason: state?.pausedReason ?? null,
        newPerDay: this.lane.newPerDay,
        backlogPerDay: this.lane.backlogPerDay,
        backlogRemaining: backlog.length,
        postedToday: totalOf(counts),
        dailyCap: this.lane.dailyCap,
      },
      totals: { posts: t.posts, views: t.views, likes: t.likes, comments: t.comments },
      recent: recent.map((p) => ({
        postId: String(p._id),
        reelId: String(p.reelId),
        title: p.metadata?.title ?? '',
        url: p.url ?? null,
        status: p.status,
        source: p.source,
        publishedAt: p.publishedAt ? new Date(p.publishedAt).toISOString() : null,
        views: p.latestMetrics?.views ?? null,
        likes: p.latestMetrics?.likes ?? null,
        comments: p.latestMetrics?.comments ?? null,
      })),
    };
  }
}

function isLimitError(err: unknown): boolean {
  const res = (err as { getResponse?: () => unknown })?.getResponse?.() as { issues?: Array<{ code?: string }> } | undefined;
  return !!res?.issues?.some((i) => i.code === 'daily_cap');
}
