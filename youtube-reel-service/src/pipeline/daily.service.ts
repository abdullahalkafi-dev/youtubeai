import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AiService } from '../ai/ai.service';
import { errMsg } from '../common/errors';
import { truncate } from '../common/text';
import { AppConfig, CONFIG } from '../config/config';
import { ReelCampaign, ReelCampaignDocument, TERMINAL_CAMPAIGN_STATUSES } from '../db/schemas/reel-campaign.schema';
import { ReelDailyRun, ReelDailyRunDocument } from '../db/schemas/reel-daily-run.schema';
import { ReelSetting, ReelSettingDocument } from '../db/schemas/reel-misc.schema';
import { buildDailyTopicUser, DAILY_TOPIC_SYSTEM, DailyTopicResult, DailyTopicSchema } from '../prompts/daily-topic.prompt';
import { AnalyticsService } from '../publishing/analytics.service';
import { QueueService } from '../queue/queue.service';
import { BrainCandidate, CandidateEvidence, scoreCandidate, ScoredCandidate, selectPortfolio } from './daily-brain';
import { freeDiskGb } from './media';
import { isBrandEntity, PillarService } from './pillars.service';
import { matchTrend, SignalsService, TREND_USABLE_HOURS, velocityShareFor } from './signals.service';

export const DAILY_TZ = 'America/New_York';
export const DAILY_HOUR = 4;

/** New York calendar date (YYYY-MM-DD) of a moment. */
export function nyDate(d = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: DAILY_TZ });
}

/** Next 4:00 AM New York (handles daylight-saving changes: NY offsets are whole hours). */
export function nextDailyRun(from = new Date()): Date {
  const t = new Date(from);
  t.setUTCMinutes(0, 0, 0);
  for (let i = 0; i < 50; i++) {
    t.setUTCHours(t.getUTCHours() + 1);
    const hour = Number(t.toLocaleString('en-US', { timeZone: DAILY_TZ, hour: 'numeric', hour12: false }));
    if (hour % 24 === DAILY_HOUR) return new Date(t);
  }
  return new Date(from.getTime() + 86_400_000);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface HealthNote {
  level: 'info' | 'warn' | 'error';
  code: string;
  message: string;
}

type RunTopic = NonNullable<ReelDailyRun['topic']>;

/**
 * The nightly automatic campaign. The model proposes topics; the Daily Brain (daily-brain.ts) scores them from fresh
 * signals (trends, the channel's own traffic, coverage, material) and splits the day: a main topic plus an explore topic.
 * Never publishes by itself (auto-publish is a separate, switchable service).
 */
@Injectable()
export class DailyService {
  private readonly logger = new Logger(DailyService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @InjectModel(ReelCampaign.name) private readonly campaigns: Model<ReelCampaignDocument>,
    @InjectModel(ReelDailyRun.name) private readonly runs: Model<ReelDailyRunDocument>,
    @InjectModel(ReelSetting.name) private readonly settings: Model<ReelSettingDocument>,
    private readonly ai: AiService,
    private readonly analytics: AnalyticsService,
    private readonly queues: QueueService,
    private readonly pillars: PillarService,
    private readonly signals: SignalsService,
  ) {}

  async isEnabled(channelId: string): Promise<boolean> {
    const s = await this.settings.findOne({ key: `daily:${channelId}` }).lean();
    return s?.value?.enabled ?? true;
  }

  async setEnabled(channelId: string, enabled: boolean) {
    await this.settings.updateOne({ key: `daily:${channelId}` }, { $set: { value: { enabled, updatedAt: new Date() } } }, { upsert: true });
  }

  /** Scheduled entry point (4 AM NY, and a 6 AM NY retry): every channel that uses Reels Studio. */
  async runScheduled() {
    if (!this.cfg.REELS_ENABLED) return;
    const ids = (await this.campaigns.distinct('channelId')) as Types.ObjectId[];
    for (const id of ids) {
      try {
        await this.runForChannel(String(id), 'schedule');
      } catch (err) {
        this.logger.warn(`Daily campaign for channel ${id} failed: ${errMsg(err)}`);
      }
    }
  }

  /** One run per channel per NY day. A failed day may be retried once; a manual run is allowed if the day had none or failed/skipped. */
  async runForChannel(channelId: string, trigger: 'schedule' | 'manual') {
    const date = nyDate();
    const cid = new Types.ObjectId(channelId);
    const existing = await this.runs.findOne({ channelId: cid, date });
    if (existing) {
      const retryable = existing.status === 'failed' || (trigger === 'manual' && existing.status === 'skipped');
      if (!retryable || existing.attempts >= 3) {
        if (trigger === 'manual') throw new ConflictException(existing.status === 'started' || existing.status === 'running' ? "Today's daily campaign has already started." : "Today's daily campaign can't be run again.");
        return existing;
      }
    }
    const run =
      existing ??
      (await this.runs.create({ channelId: cid, date, status: 'running', trigger }).catch(async (err) => {
        if (err?.code === 11000) return null; // another worker won the race
        throw err;
      }));
    if (!run) return null;
    if (existing) await this.runs.updateOne({ _id: run._id }, { $set: { status: 'running', trigger, reason: null }, $inc: { attempts: 1 } });

    const skip = async (reason: string, extra: Record<string, unknown> = {}) => {
      await this.runs.updateOne({ _id: run._id }, { $set: { status: 'skipped', reason, ...extra } });
      this.logger.log(`Daily ${date} for ${channelId}: skipped (${reason})`);
      return this.runs.findById(run._id).lean();
    };
    if (trigger === 'schedule' && !(await this.isEnabled(channelId))) {
      // A paused day still records what the brain WOULD have chosen, so its choices can be judged before it is switched on.
      const shadow = await this.shadowPick(cid, date);
      return skip('Paused by you', shadow ?? {});
    }
    if (freeDiskGb(this.cfg.REEL_WORK_DIR) < this.cfg.REEL_MIN_FREE_DISK_GB) return skip('Server disk is almost full');

    try {
      const decision = await this.decide(cid, date);
      if (!decision.main) return skip('Not enough matching footage for any topic today', { candidates: decision.candidates, degraded: decision.degraded });
      const { main, explore, mainReels, exploreReels } = decision;
      const label = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const owner = await this.campaigns.db.collection('channels').findOne({ _id: cid }, { projection: { userId: 1 } });
      const make = (t: ScoredCandidate, reels: number, track: 'main' | 'explore', parent?: Types.ObjectId) =>
        this.campaigns.create({
          channelId: cid,
          userId: owner?.userId ?? cid, // system-created on behalf of the channel owner
          origin: 'daily',
          dailyDate: date,
          track,
          parentCampaignId: parent ?? null,
          name: truncate(track === 'main' ? `Daily ${label}: ${t.c.name}` : `Daily ${label} (explore): ${t.c.name}`, 80),
          brief: t.c.brief,
          status: 'queued',
          settings: { targetReels: Math.min(reels, this.cfg.REEL_MAX_REELS_PER_CAMPAIGN), minSec: 30, maxSec: 60, allowCrossVideo: true, templateName: 'default', seedVideoIds: [] },
          progress: { stage: 'queued', message: `Daily ${track === 'main' ? 'campaign' : 'explore part'} — starting research` },
          log: [{ at: new Date(), level: 'info', msg: `Daily ${track} topic for ${date}: ${t.c.why}` }],
        });
      const campaign = await make(main, mainReels, 'main');
      const child = explore ? await make(explore, exploreReels, 'explore', campaign._id) : null;
      if (child) await this.campaigns.updateOne({ _id: campaign._id }, { $set: { exploreCampaignId: child._id } });
      await this.queues.campaign('research', String(campaign._id));
      if (child) await this.queues.campaign('research', String(child._id));
      const topicOf = (t: ScoredCandidate): RunTopic => ({ name: t.c.name, brief: t.c.brief, why: t.c.why, signal: t.c.signal, keywords: t.c.keywords, pillar: t.c.pillar, entity: t.c.entity, score: t.score });
      await this.runs.updateOne(
        { _id: run._id },
        {
          $set: {
            status: 'started',
            topic: topicOf(main),
            exploreTopic: explore ? topicOf(explore) : null,
            evidence: { moments: main.ev.moments, videos: main.ev.videos, strongMoments: main.ev.strongMoments },
            candidates: decision.candidates,
            degraded: decision.degraded,
            mainReels,
            exploreReels,
            campaignId: campaign._id,
            exploreCampaignId: child?._id ?? null,
          },
        },
      );
      this.logger.log(`Daily ${date} for ${channelId}: main "${main.c.name}" (${mainReels} reels, score ${main.score})${explore ? `, explore "${explore.c.name}" (${exploreReels} reels, ${explore.exploreScore})` : ''} → campaign ${campaign._id}`);
      return this.runs.findById(run._id).lean();
    } catch (err) {
      await this.runs.updateOne({ _id: run._id }, { $set: { status: 'failed', reason: errMsg(err).slice(0, 300) } });
      throw err;
    }
  }

  // ------------------------------------------------------------------ topic choice (the brain)

  /** What the brain would pick today, without creating anything. Costs one model call. */
  async preview(channelId: string) {
    const d = await this.decide(new Types.ObjectId(channelId), nyDate());
    return {
      main: d.main ? { name: d.main.c.name, why: d.main.c.why, score: d.main.score, reels: d.mainReels, pillar: d.main.c.pillar, entity: d.main.c.entity } : null,
      explore: d.explore ? { name: d.explore.c.name, why: d.explore.c.why, score: d.explore.exploreScore, reels: d.exploreReels, pillar: d.explore.c.pillar, entity: d.explore.c.entity } : null,
      candidates: d.candidates,
      degraded: d.degraded,
    };
  }

  private async shadowPick(cid: Types.ObjectId, date: string): Promise<Record<string, unknown> | null> {
    try {
      const d = await this.decide(cid, date);
      return { candidates: d.candidates, degraded: d.degraded, shadow: { topic: d.main?.c.name ?? null, exploreTopic: d.explore?.c.name ?? null, at: new Date() } };
    } catch (err) {
      this.logger.warn(`Daily shadow pick for ${cid} failed: ${errMsg(err)}`);
      return null;
    }
  }

  private async decide(channelId: Types.ObjectId, date: string) {
    const db = this.campaigns.db;
    // The brain needs the channel's pillars and today's signal snapshot; both are cheap and self-healing.
    await this.pillars.prepare(channelId).catch((err) => this.logger.warn(`Pillar prepare failed: ${errMsg(err)}`));
    const [pillarDefs, pillarState, snap, entityKeys, brands] = await Promise.all([this.pillars.list(channelId), this.pillars.state(channelId), this.signals.snapshot(channelId, date), this.signals.entityKeys(channelId), this.signals.brands(channelId)]);
    const pillarKeys = new Set(pillarDefs.map((p) => p.key));
    const usableTrends = snap.trendRows.filter((t) => (Date.now() - t.fetchedAt.getTime()) / 3_600_000 <= TREND_USABLE_HOURS);

    const [themes, entities, bank, bankPeople, recent] = await Promise.all([
      this.analytics.breakdown(String(channelId), 'theme', '30d').catch(() => ({ rows: [] as any[] })),
      this.analytics.breakdown(String(channelId), 'entity', '30d').catch(() => ({ rows: [] as any[] })),
      db.collection('reel_moments').aggregate([{ $match: { channelId } }, { $unwind: '$themes' }, { $group: { _id: '$themes', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 10 }]).toArray(),
      db.collection('reel_moments').aggregate([{ $match: { channelId } }, { $unwind: '$entityNames' }, { $group: { _id: '$entityNames', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 12 }]).toArray(),
      this.runs.find({ channelId, status: 'started', date: { $ne: date } }).sort({ date: -1 }).limit(14).select('topic exploreTopic').lean(),
    ]);
    const trendNote = snap.degraded.find((d) => /trend|lite/i.test(d)) ?? null;

    const res: DailyTopicResult = await this.ai.generateJson({
      task: `daily-topic:${channelId}:${date}`,
      system: DAILY_TOPIC_SYSTEM,
      user: buildDailyTopicUser({
        date,
        trending: usableTrends.slice(0, 15).map((t) => ({ title: t.title, score: t.score, ageHours: Math.round((Date.now() - t.fetchedAt.getTime()) / 360_000) / 10 })),
        trendNote,
        own: (snap.own?.byEntity ?? []).slice(0, 6).map((e) => ({ key: e.key, share: e.share3d })),
        performed: [...themes.rows, ...entities.rows].sort((a, b) => b.views - a.views).slice(0, 10).map((r) => ({ key: r.key, views: r.views, posts: r.posts })),
        pillars: pillarDefs.map((p) => ({ ...p, daysSinceCovered: pillarState[p.key]?.daysSinceCovered ?? null, lift: pillarState[p.key]?.lift ?? 1 })),
        recent: recent.flatMap((r) => [r.topic?.name, r.exploreTopic?.name]).filter(Boolean) as string[],
        // the channel's own name is not a topic: it would otherwise top the "most present people" list
        bankThemes: [...bank, ...bankPeople].filter((b: any) => !isBrandEntity(String(b._id), brands)).map((b: any) => ({ key: String(b._id), n: b.n })),
      }),
      schema: DailyTopicSchema,
      schemaName: 'daily_topic',
      reasoningEffort: 'medium',
    });

    // The model may name a person by a nickname: map it to the canonical person key; never the channel brand.
    const canonical = (raw: string | null): string | null => {
      if (!raw) return null;
      const n = raw.trim().toLowerCase();
      if (!n) return null;
      return entityKeys.find((e) => e.key === n || e.names.includes(n))?.key ?? n;
    };

    const scored: ScoredCandidate[] = [];
    const candidates: any[] = [];
    // memory for the saturation rule: the entity that led each of the last 5 days (newest first)
    const mainRuns = await this.runs.find({ channelId, status: 'started', date: { $ne: date } }).sort({ date: -1 }).limit(5).select('topic.entity').lean();
    const ctxBase = { recentMainEntities: mainRuns.map((r) => canonical(r.topic?.entity ?? null)), pillars: pillarState };

    for (const c of res.candidates) {
      const words = [...new Set(c.keywords.map((k) => k.trim().toLowerCase()).filter((k) => k.length >= 3))].slice(0, 10);
      if (!words.length) continue;
      const cand: BrainCandidate = { name: c.name, brief: c.brief, why: c.why, keywords: words, signal: c.signal, pillar: pillarKeys.has(c.pillar) ? c.pillar : null, entity: canonical(c.entity) };
      // A moment counts when it matches at least two of the topic's keywords (one broad word like "consequences" matches almost
      // everything); a catalog video counts when its title has one of the 3 main keywords.
      const text = { $concat: [{ $ifNull: ['$title', ''] }, ' ', { $ifNull: ['$summary', ''] }, ' ', { $reduce: { input: { $concatArrays: [{ $ifNull: ['$entityNames', []] }, { $ifNull: ['$themes', []] }] }, initialValue: '', in: { $concat: ['$$value', ' ', '$$this'] } } }] };
      const hits = { $add: words.map((w) => ({ $cond: [{ $regexMatch: { input: text, regex: escapeRe(w), options: 'i' } }, 1, 0] })) };
      const [m] = await db
        .collection('reel_moments')
        .aggregate<{ n: number; strong: number }>([
          { $match: { channelId } },
          { $project: { hits, strong: { $and: [{ $eq: ['$status', 'unused'] }, { $gte: [{ $ifNull: ['$standalone', 0] }, 7] }] } } },
          { $match: { hits: { $gte: Math.min(2, words.length) } } },
          { $group: { _id: null, n: { $sum: 1 }, strong: { $sum: { $cond: ['$strong', 1, 0] } } } },
        ])
        .toArray();
      const titleRe = new RegExp(words.slice(0, 3).map(escapeRe).join('|'), 'i');
      const videos = await db.collection('videos').countDocuments({ channelId, deletedFromYoutube: { $ne: true }, durationSeconds: { $gt: 240 }, title: titleRe });
      const trend = matchTrend(cand, usableTrends);
      const ev: CandidateEvidence = { moments: m?.n ?? 0, videos, strongMoments: m?.strong ?? 0, trendMatch: trend.match, trendTitle: trend.title, velocityShare: velocityShareFor(cand, snap.own) };
      const s = scoreCandidate(cand, ev, { ...ctxBase, targetReels: 7 });
      scored.push(s);
    }

    // First pass at the full day to choose the main topic; its footage decides how many reels the day can bear, then split.
    const first = selectPortfolio(scored, { ...ctxBase, targetReels: 7 });
    const total = first.main ? Math.max(4, Math.min(7, Math.round((first.main.ev.moments + first.main.ev.videos) / 4))) : 0;
    const portfolio = first.main ? selectPortfolio(scored, { ...ctxBase, targetReels: total }) : first;
    const reelsFor = (s: ScoredCandidate) => (s === portfolio.main ? portfolio.mainReels : s === portfolio.explore ? portfolio.exploreReels : 0);
    for (const s of scored) {
      candidates.push({
        name: s.c.name,
        signal: s.c.signal,
        pillar: s.c.pillar,
        entity: s.c.entity,
        moments: s.ev.moments,
        videos: s.ev.videos,
        strongMoments: s.ev.strongMoments,
        trendMatch: s.ev.trendMatch,
        trendTitle: s.ev.trendTitle,
        velocityShare: s.ev.velocityShare,
        components: s.components,
        score: s.score,
        exploreScore: s.exploreScore,
        eligible: s.eligible,
        reason: s.reason,
        picked: s === portfolio.main ? 'main' : s === portfolio.explore ? 'explore' : undefined,
        reels: reelsFor(s) || undefined,
      });
    }
    candidates.sort((a, b) => b.score - a.score);
    return { main: portfolio.main, explore: portfolio.explore, mainReels: portfolio.mainReels, exploreReels: portfolio.exploreReels, candidates, degraded: snap.degraded };
  }

  // ------------------------------------------------------------------ health + what the brain knows

  async health(channelId: string): Promise<HealthNote[]> {
    const cid = new Types.ObjectId(channelId);
    const notes: HealthNote[] = [];
    if (!(await this.isEnabled(channelId))) notes.push({ level: 'warn', code: 'paused', message: 'Daily is paused: scheduled runs are skipped (each one still records what it would have picked).' });
    if (freeDiskGb(this.cfg.REEL_WORK_DIR) < this.cfg.REEL_MIN_FREE_DISK_GB) notes.push({ level: 'error', code: 'disk', message: 'Server disk is almost full: new daily campaigns are skipped until space is freed.' });

    const trends = await this.signals.trends(cid);
    const fresh = trends.find((t) => (Date.now() - t.fetchedAt.getTime()) / 3_600_000 <= TREND_USABLE_HOURS);
    if (!trends.length) notes.push({ level: 'warn', code: 'trends-missing', message: 'No trend scan in the last 72 hours: topics are chosen from the channel\'s own traffic and archive only.' });
    else if (!fresh) notes.push({ level: 'warn', code: 'trends-stale', message: `The newest trend scan is ${Math.round((Date.now() - trends[0].fetchedAt.getTime()) / 3_600_000)} hours old; it is ignored for picking topics.` });
    else if (!trends.some((t) => t.source && t.source !== 'lite' && (Date.now() - t.fetchedAt.getTime()) / 3_600_000 <= TREND_USABLE_HOURS)) notes.push({ level: 'info', code: 'trends-lite', message: 'Only quick trend scans are fresh; the full daily scan has not succeeded recently (check OpenAI credits).' });

    const recentRuns = await this.runs.find({ channelId: cid }).sort({ date: -1 }).limit(3).select('status reason date').lean();
    if (recentRuns.some((r) => /credits/i.test(r.reason ?? ''))) notes.push({ level: 'error', code: 'credits', message: 'OpenAI credits ran out during a recent daily run. Add credits, then press "Run today now".' });
    else if (recentRuns[0]?.status === 'failed') notes.push({ level: 'error', code: 'last-failed', message: `Yesterday's daily run failed: ${recentRuns[0].reason ?? 'unknown reason'}` });
    const failedCamp = await this.campaigns.findOne({ channelId: cid, origin: 'daily', status: 'failed', createdAt: { $gte: new Date(Date.now() - 3 * 86_400_000) } }).select('error').lean();
    if (failedCamp && /credits/i.test(failedCamp.error ?? '')) notes.push({ level: 'error', code: 'credits', message: 'OpenAI credits ran out while a daily campaign was running. Add credits and retry.' });
    return notes.filter((n, i, a) => a.findIndex((x) => x.code === n.code) === i);
  }

  /** What the brain knows today, without any model call: pillars (coverage + performance), own traffic, trend freshness. */
  async brain(channelId: string) {
    const cid = new Types.ObjectId(channelId);
    const [defs, state, latest] = await Promise.all([this.pillars.list(cid), this.pillars.state(cid), this.signals.latest(cid)]);
    return {
      pillars: defs.map((p) => ({ key: p.key, name: p.name, daysSinceCovered: state[p.key]?.daysSinceCovered ?? null, lift: Math.round((state[p.key]?.lift ?? 1) * 100) / 100, posts: state[p.key]?.posts ?? 0 })),
      own: latest?.own ? { through: latest.own.through, views3d: latest.own.views3d, byEntity: latest.own.byEntity.slice(0, 5) } : null,
      trends: latest?.trends ?? null,
      degraded: latest?.degraded ?? [],
      signalDate: latest?.date ?? null,
    };
  }

  // ------------------------------------------------------------------ Daily tab

  async overview(channelId: string) {
    const cid = new Types.ObjectId(channelId);
    const runs = await this.runs.find({ channelId: cid }).sort({ date: -1 }).limit(45).lean();
    const parentIds = runs.map((r) => r.campaignId).filter(Boolean) as Types.ObjectId[];
    const childIds = runs.map((r) => r.exploreCampaignId).filter(Boolean) as Types.ObjectId[];
    const allIds = [...parentIds, ...childIds];
    const [camps, reelCounts, views] = await Promise.all([
      this.campaigns.find({ _id: { $in: allIds } }).setOptions({ withDeleted: true }).select('status progress name deletedAt').lean(),
      this.campaigns.db
        .collection('reels')
        .aggregate<{ _id: { c: Types.ObjectId; s: string }; n: number }>([{ $match: { campaignId: { $in: allIds }, deletedAt: null } }, { $group: { _id: { c: '$campaignId', s: '$status' }, n: { $sum: 1 } } }])
        .toArray(),
      this.analytics.viewsByCampaign(allIds),
    ]);
    const campById = new Map(camps.map((c) => [String(c._id), c]));
    const days = runs.map((r) => {
      const id = r.campaignId ? String(r.campaignId) : null;
      const cid2 = r.exploreCampaignId ? String(r.exploreCampaignId) : null;
      const ids = [id, cid2].filter(Boolean) as string[];
      const counts = (s: string) => reelCounts.filter((x) => ids.includes(String(x._id.c)) && x._id.s === s).reduce((n, x) => n + x.n, 0);
      const c = id ? campById.get(id) : undefined;
      const ch = cid2 ? campById.get(cid2) : undefined;
      const v = ids.reduce((a, i) => ({ views: a.views + (views.get(i)?.views ?? 0), posts: a.posts + (views.get(i)?.posts ?? 0) }), { views: 0, posts: 0 });
      const deleted = !!c?.deletedAt;
      // The day is "running" until both parts are finished; the explore part is part of the same card.
      const running = [c, ch].find((x) => x && !TERMINAL_CAMPAIGN_STATUSES.includes(x.status));
      return {
        date: r.date,
        deleted,
        status: r.status,
        reason: r.reason ?? null,
        topic: r.topic ?? null,
        exploreTopic: r.exploreTopic ?? null,
        evidence: r.evidence ?? null,
        candidates: (r.candidates ?? []).slice(0, 8),
        degraded: r.degraded ?? [],
        shadow: r.shadow ?? null,
        mainReels: r.mainReels ?? null,
        exploreReels: r.exploreReels ?? null,
        campaignId: deleted ? null : id,
        campaignStatus: running?.status ?? c?.status ?? null,
        progress: running ? running.progress?.message ?? null : null,
        reelsReady: counts('todo') + counts('posted'),
        reelsPosted: counts('posted'),
        views: v.views,
        posts: v.posts,
      };
    });
    const published = days.filter((d) => d.posts > 0);
    const avgPerPost = published.length ? published.reduce((n, d) => n + d.views, 0) / published.reduce((n, d) => n + d.posts, 0) : 0;
    const bySignal = ['trend', 'performance', 'explore', 'archive'].map((s) => {
      const list = published.filter((d) => d.topic?.signal === s);
      const posts = list.reduce((n, d) => n + d.posts, 0);
      return { signal: s, days: list.length, views: list.reduce((n, d) => n + d.views, 0), avgPerPost: posts ? Math.round(list.reduce((n, d) => n + d.views, 0) / posts) : 0 };
    });
    const [enabled, health, brain] = await Promise.all([this.isEnabled(channelId), this.health(channelId), this.brain(channelId).catch(() => null)]);
    return {
      enabled,
      nextRunAt: nextDailyRun(),
      timezone: DAILY_TZ,
      today: nyDate(),
      avgViewsPerPost: Math.round(avgPerPost),
      bySignal,
      health,
      brain,
      days: days.map((d) => ({
        ...d,
        verdict: d.posts === 0 || !avgPerPost ? null : d.views / d.posts >= avgPerPost * 1.25 ? 'better' : d.views / d.posts <= avgPerPost * 0.8 ? 'worse' : 'similar',
      })),
    };
  }
}
