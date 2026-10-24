import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { errMsg } from '../common/errors';
import { ReelAutoDay, ReelAutoDayDocument } from '../db/schemas/reel-autopublish.schema';
import { ReelCampaign, ReelCampaignDocument, TERMINAL_CAMPAIGN_STATUSES } from '../db/schemas/reel-campaign.schema';
import { MAX_FALLBACKS } from '../pipeline/daily-brain';
import { ReelDailyRun, ReelDailyRunDocument } from '../db/schemas/reel-daily-run.schema';
import { ReelSetting, ReelSettingDocument } from '../db/schemas/reel-misc.schema';
import { ReelPostMetric, ReelPostMetricDocument } from '../db/schemas/reel-post-metric.schema';
import { ReelPost, ReelPostDocument } from '../db/schemas/reel-post.schema';
import { Reel, ReelDocument } from '../db/schemas/reel.schema';
import { SharedChannel, SharedChannelDocument, SourceVideo, SourceVideoDocument } from '../db/schemas/shared.readonly';
import { nyDate } from '../pipeline/daily.service';
import { assignRotation, AutoSettings, DEFAULT_AUTO_SETTINGS, evaluateGuardrails, gateReason, nyToUtc, parseSlot, pickSlots, validSlot } from './auto-plan';
import { assignBandit, banditReady, DayPost, posteriors, rankObservations } from './slot-bandit';
import { PublishService } from './publish.service';
import { PublisherRegistry } from './registry';

const key = (channelId: string | Types.ObjectId) => `autopublish:${channelId}`;
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

export interface AutoSettingsPatch {
  enabled?: boolean;
  privacy?: 'public' | 'unlisted';
  slots?: string[];
  extraSlots?: string[];
  minScore?: number;
  maxPerDay?: number;
  /** true clears a pause (the client has looked at what happened). */
  resume?: boolean;
}

/**
 * Auto-publish: after the day's reels are made, the good ones go to YouTube by themselves at New York times the system chooses
 * (the client's list of slots; the order is randomised at first so each slot gets a fair test). Only ever active while the client's
 * Auto-publish switch is on. Every post can still be cancelled, moved or published now until its upload starts, and the system
 * stops itself when YouTube flags something or results collapse. It never deletes anything from YouTube.
 */
@Injectable()
export class AutoPublishService {
  private readonly logger = new Logger(AutoPublishService.name);

  constructor(
    @InjectModel(ReelSetting.name) private readonly settingsModel: Model<ReelSettingDocument>,
    @InjectModel(ReelAutoDay.name) private readonly days: Model<ReelAutoDayDocument>,
    @InjectModel(ReelDailyRun.name) private readonly runs: Model<ReelDailyRunDocument>,
    @InjectModel(ReelCampaign.name) private readonly campaigns: Model<ReelCampaignDocument>,
    @InjectModel(Reel.name) private readonly reels: Model<ReelDocument>,
    @InjectModel(ReelPost.name) private readonly posts: Model<ReelPostDocument>,
    @InjectModel(ReelPostMetric.name) private readonly metrics: Model<ReelPostMetricDocument>,
    @InjectModel(SharedChannel.name) private readonly channels: Model<SharedChannelDocument>,
    @InjectModel(SourceVideo.name) private readonly videos: Model<SourceVideoDocument>,
    private readonly publish: PublishService,
    private readonly registry: PublisherRegistry,
  ) {}

  // ------------------------------------------------------------------ settings

  async settings(channelId: string): Promise<AutoSettings> {
    const doc = await this.settingsModel.findOne({ key: key(channelId) }).lean();
    const v = (doc?.value ?? {}) as Partial<AutoSettings>;
    return { ...DEFAULT_AUTO_SETTINGS, ...v, pausedAt: v.pausedAt ? new Date(v.pausedAt) : null };
  }

  async update(channelId: string, patch: AutoSettingsPatch): Promise<AutoSettings> {
    const cur = await this.settings(channelId);
    const next: AutoSettings = { ...cur };
    if (patch.privacy) next.privacy = patch.privacy;
    if (patch.slots) {
      const ok = [...new Set(patch.slots.map((x) => parseSlot(x) ?? x))].filter(validSlot).sort();
      if (!ok.length) throw new BadRequestException('Give at least one valid time, like 8:00 AM (New York time)');
      next.slots = ok;
    }
    if (patch.extraSlots) next.extraSlots = [...new Set(patch.extraSlots.map((x) => parseSlot(x) ?? x))].filter(validSlot).sort();
    if (patch.minScore !== undefined) next.minScore = Math.max(0, Math.min(100, Math.round(patch.minScore)));
    if (patch.maxPerDay !== undefined) next.maxPerDay = Math.max(1, Math.min(10, Math.round(patch.maxPerDay)));
    if (patch.resume) {
      next.pausedReason = null;
      next.pausedAt = null;
    }
    if (patch.enabled !== undefined) {
      next.enabled = patch.enabled;
      if (patch.enabled) {
        next.pausedReason = null;
        next.pausedAt = null;
      }
    }
    await this.settingsModel.updateOne({ key: key(channelId) }, { $set: { value: { ...next, updatedAt: new Date() } } }, { upsert: true });
    return next;
  }

  /** Channels whose switch is on. */
  private async enabledChannels(): Promise<string[]> {
    const docs = await this.settingsModel.find({ key: /^autopublish:/, 'value.enabled': true }).select('key').lean();
    return docs.map((d) => d.key.slice('autopublish:'.length));
  }

  // ------------------------------------------------------------------ the periodic job

  async runDue() {
    for (const channelId of await this.enabledChannels()) {
      try {
        await this.guard(channelId);
        await this.plan(channelId);
      } catch (err) {
        this.logger.warn(`Auto-publish for channel ${channelId}: ${errMsg(err)}`);
      }
    }
  }

  /** Typical views of the channel's own Shorts (the baseline the stop rule compares against). */
  async shortsBaseline(channelId: string): Promise<number | null> {
    const since = new Date(Date.now() - 540 * 86_400_000);
    const rows = await this.videos
      .find({ channelId: new Types.ObjectId(channelId), deletedFromYoutube: { $ne: true }, durationSeconds: { $lte: 61 }, publishedAt: { $gte: since } })
      .select('viewCount')
      .lean();
    return rows.length >= 8 ? median(rows.map((r: any) => r.viewCount ?? 0)) : null;
  }

  /** Each settled automatic post with its views after about a day (the 24h snapshot, else the latest numbers once it is over 36 hours old). */
  async slotPosts(channelId: string, days = 90): Promise<DayPost[]> {
    const cid = new Types.ObjectId(channelId);
    const posts = await this.posts
      .find({ channelId: cid, source: 'auto', status: 'published', 'autoPlan.slot': { $exists: true }, publishedAt: { $gte: new Date(Date.now() - days * 86_400_000) } })
      .select('autoPlan publishedAt latestMetrics.views')
      .lean();
    const snaps = await this.metrics.find({ postId: { $in: posts.map((p) => p._id) }, checkpoint: '24h' }).select('postId views').lean();
    const at24 = new Map(snaps.map((s) => [String(s.postId), s.views]));
    const out: DayPost[] = [];
    for (const p of posts) {
      const age = Date.now() - new Date(p.publishedAt!).getTime();
      const views = at24.get(String(p._id)) ?? (age >= 36 * 3600_000 ? p.latestMetrics?.views : undefined);
      if (views === undefined || !p.autoPlan) continue;
      out.push({ id: String(p._id), date: p.autoPlan.planDate, slot: p.autoPlan.slot, views });
    }
    return out;
  }

  /** What each slot has shown so far (mean rank inside the day, with how many posts it rests on). */
  async slotReport(channelId: string) {
    const s = await this.settings(channelId);
    const slots = [...new Set([...s.slots, ...s.extraSlots])].sort();
    const obs = rankObservations(await this.slotPosts(channelId));
    return { ready: banditReady(obs, s.slots), observations: obs.length, slots: posteriors(obs, slots).map((p) => ({ slot: p.slot, posts: p.n, score: Math.round(p.mean * 100) / 100 })) };
  }

  /** Stops auto-publish (and cancels what has not started uploading) when YouTube flags something or the results collapse. */
  async guard(channelId: string) {
    const s = await this.settings(channelId);
    if (!s.enabled || s.pausedReason) return null;
    const cid = new Types.ObjectId(channelId);
    const recent = await this.posts
      .find({ channelId: cid, source: 'auto', createdAt: { $gte: new Date(Date.now() - 10 * 86_400_000) } })
      .sort({ createdAt: -1 })
      .select('status publishedAt latestMetrics.views warnings errorCode')
      .lean();
    const reason = evaluateGuardrails(
      recent.map((p) => ({ status: p.status, publishedAt: p.publishedAt ? new Date(p.publishedAt) : null, views: p.latestMetrics?.views ?? null, warnings: p.warnings ?? [], errorCode: p.errorCode })),
      await this.shortsBaseline(channelId),
    );
    if (!reason) return null;
    await this.pause(channelId, reason);
    return reason;
  }

  async pause(channelId: string, reason: string) {
    const cur = await this.settings(channelId);
    await this.settingsModel.updateOne({ key: key(channelId) }, { $set: { value: { ...cur, pausedReason: reason, pausedAt: new Date(), updatedAt: new Date() } } }, { upsert: true });
    const queued = await this.posts.find({ channelId: new Types.ObjectId(channelId), source: 'auto', status: 'queued' }).select('_id').lean();
    for (const p of queued) await this.publish.cancel(channelId, String(p._id)).catch(() => undefined);
    this.logger.warn(`Auto-publish paused for ${channelId}: ${reason} (${queued.length} waiting posts cancelled)`);
  }

  // ------------------------------------------------------------------ planning

  /**
   * Plans today's posts once, as soon as the day's campaigns (main + explore) are finished. Safe to call often: it does nothing when
   * the switch is off, when there is nothing to plan yet, or when today is already planned.
   */
  async plan(channelId: string, now = new Date()) {
    const s = await this.settings(channelId);
    if (!s.enabled) return { status: 'off' as const };
    if (s.pausedReason) return { status: 'paused' as const, reason: s.pausedReason };
    const cid = new Types.ObjectId(channelId);
    const date = nyDate(now);
    if (await this.days.exists({ channelId: cid, date })) return { status: 'already-planned' as const };

    const run = await this.runs.findOne({ channelId: cid, date, status: 'started' }).lean();
    if (!run?.campaignId) return { status: 'no-run' as const };
    const ids = [run.campaignId, run.exploreCampaignId].filter(Boolean) as Types.ObjectId[];
    const camps = await this.campaigns.find({ _id: { $in: ids } }).select('status track').lean();
    if (camps.some((c) => !TERMINAL_CAMPAIGN_STATUSES.includes(c.status))) return { status: 'still-making' as const };
    // a failed main topic is about to be replaced by the next-best one (see DailyService.rescue): wait for it instead of planning a half day
    const mainCamp = camps.find((c) => String(c._id) === String(run.campaignId));
    if (mainCamp?.status === 'failed' && !run.rescueExhausted && (run.fallbackCount ?? 0) < MAX_FALLBACKS) return { status: 'still-making' as const };
    const trackOf = new Map(camps.map((c) => [String(c._id), (c.track ?? 'main') as 'main' | 'explore']));

    const publisher = this.registry.get('youtube');
    const account = publisher ? await publisher.getAccountStatus(channelId).catch(() => null) : null;
    if (!account || account.state !== 'ok') return { status: 'youtube-not-connected' as const };

    // claim the day (a second worker or a repeated tick finds it and stops)
    try {
      await this.days.create({ channelId: cid, date, status: 'planning', mode: 'rotation' });
    } catch (err: any) {
      if (err?.code === 11000) return { status: 'already-planned' as const };
      throw err;
    }

    try {
      const reels = await this.reels.find({ campaignId: { $in: ids }, status: 'todo' }).select('campaignId scores.overall critique.verdict packaging.title concept').lean();
      const held: Array<{ reelId: Types.ObjectId; title: string; reason: string }> = [];
      const good: Array<{ r: (typeof reels)[number]; score: number }> = [];
      for (const r of reels) {
        const title = r.packaging?.title || r.concept || 'Reel';
        const pre = await this.publish.preflight(channelId, String(r._id), 'youtube', { privacy: s.privacy, scheduleAt: null }).catch((e) => ({ canPublish: false, issues: [{ level: 'error', message: errMsg(e) }] }));
        const errors = (pre.issues as Array<{ level: string; message: string }>).filter((i) => i.level === 'error').map((i) => i.message);
        const reason = gateReason({ score: r.scores?.overall ?? null, verdict: r.critique?.verdict ?? null, preflightErrors: errors, hasActivePost: false, minScore: s.minScore });
        if (reason) held.push({ reelId: r._id, title, reason });
        else good.push({ r, score: r.scores?.overall ?? 0 });
      }
      good.sort((a, b) => b.score - a.score);
      const wanted = good.slice(0, s.maxPerDay);
      for (const g of good.slice(s.maxPerDay)) held.push({ reelId: g.r._id, title: g.r.packaging?.title || g.r.concept || 'Reel', reason: `more than ${s.maxPerDay} a day` });

      const slots = pickSlots({ date, now, count: wanted.length, slots: s.slots, extraSlots: s.extraSlots, spacingMin: s.spacingMin });
      if (!wanted.length || !slots.length) {
        const reason = !wanted.length ? 'No reel passed the checks today' : 'No publishing slots are left today';
        await this.days.updateOne({ channelId: cid, date }, { $set: { status: 'skipped', reason, held } });
        return { status: 'skipped' as const, reason };
      }
      // The strongest reels are kept when there are fewer slots than reels. Until the slots have shown enough, the order is random (a fair
      // test of every slot); afterwards slots are chosen by Thompson sampling, with an exploration floor so no slot is ever dropped.
      const obs = rankObservations(await this.slotPosts(channelId));
      const useBandit = banditReady(obs, slots);
      const mode: 'rotation' | 'bandit' = useBandit ? 'bandit' : 'rotation';
      const top = wanted.slice(0, slots.length);
      const assigned = useBandit ? assignBandit(top, slots, posteriors(obs, slots), `${channelId}:${date}`) : assignRotation(top, slots, `${channelId}:${date}`);
      const owner = await this.channels.findOne({ _id: cid }).select('userId').lean();
      if (!owner?.userId) throw new Error('Channel owner not found');
      const items = [];
      for (const { item, slot } of assigned) {
        const title = item.r.packaging?.title || item.r.concept || 'Reel';
        try {
          const post = await this.publish.createAutoPost(channelId, String(owner.userId), String(item.r._id), {
            runAt: nyToUtc(date, slot),
            slot,
            planDate: date,
            mode,
            privacy: s.privacy,
            track: trackOf.get(String(item.r.campaignId)) ?? 'main',
            score: item.score,
          });
          items.push({ reelId: item.r._id, postId: new Types.ObjectId(post.id), slot, runAt: nyToUtc(date, slot), score: item.score, track: trackOf.get(String(item.r.campaignId)) ?? 'main', title });
        } catch (err) {
          held.push({ reelId: item.r._id, title, reason: errMsg(err) });
        }
      }
      for (const g of wanted.slice(slots.length)) held.push({ reelId: g.r._id, title: g.r.packaging?.title || g.r.concept || 'Reel', reason: 'no publishing slot left today' });
      await this.days.updateOne({ channelId: cid, date }, { $set: { status: 'planned', items, held, mode } });
      this.logger.log(`Auto-publish ${date} for ${channelId}: ${items.length} posts planned (${items.map((i) => i.slot).join(', ')}), ${held.length} held back`);
      return { status: 'planned' as const, planned: items.length, held: held.length, mode };
    } catch (err) {
      await this.days.deleteOne({ channelId: cid, date, status: 'planning' }); // let the next tick try again
      throw err;
    }
  }

  // ------------------------------------------------------------------ what the Daily tab shows

  async overview(channelId: string) {
    const cid = new Types.ObjectId(channelId);
    const [s, today, recentDays, baseline] = await Promise.all([
      this.settings(channelId),
      this.days.findOne({ channelId: cid, date: nyDate() }).lean(),
      this.days.find({ channelId: cid }).sort({ date: -1 }).limit(7).lean(),
      this.shortsBaseline(channelId),
    ]);
    const postIds = recentDays.flatMap((d) => d.items.map((i) => i.postId));
    const posts = postIds.length ? await this.posts.find({ _id: { $in: postIds } }).select('status url publishedAt latestMetrics.views error warnings autoPlan').lean() : [];
    const byId = new Map(posts.map((p) => [String(p._id), p]));
    const shape = (d: (typeof recentDays)[number]) => ({
      date: d.date,
      status: d.status,
      reason: d.reason ?? null,
      mode: d.mode,
      items: d.items
        .map((i) => {
          const p = byId.get(String(i.postId));
          return {
            postId: String(i.postId),
            reelId: String(i.reelId),
            title: i.title,
            slot: i.slot,
            runAt: p?.autoPlan?.runAt ?? i.runAt,
            moved: !!p?.autoPlan?.movedByClient,
            track: i.track,
            score: i.score,
            status: p?.status ?? 'queued',
            url: p?.url ?? null,
            views: p?.latestMetrics?.views ?? null,
            error: p?.error ?? null,
          };
        })
        .sort((a, b) => new Date(a.runAt).getTime() - new Date(b.runAt).getTime()),
      held: (d.held ?? []).map((h) => ({ reelId: String(h.reelId), title: h.title, reason: h.reason })),
    });
    return {
      settings: { enabled: s.enabled, privacy: s.privacy, slots: s.slots, extraSlots: s.extraSlots, minScore: s.minScore, maxPerDay: s.maxPerDay, pausedReason: s.pausedReason, pausedAt: s.pausedAt },
      timezone: 'America/New_York',
      shortsBaseline: baseline ? Math.round(baseline) : null,
      slotReport: await this.slotReport(channelId),
      today: today ? shape(today) : null,
      recent: recentDays.filter((d) => d.date !== nyDate()).map(shape),
    };
  }
}
