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
import { freeDiskGb } from './media';

export const DAILY_TZ = 'America/New_York';
export const DAILY_HOUR = 4;
const SIGNAL_WEIGHT: Record<string, number> = { trend: 1.3, performance: 1.15, archive: 1 };

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

/**
 * The nightly automatic campaign: pick today's best topic (trending × what the archive can cover × what performed),
 * then start a normal campaign with a relaxed quality bar so something good is made every day. Never publishes.
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

    const skip = async (reason: string) => {
      await this.runs.updateOne({ _id: run._id }, { $set: { status: 'skipped', reason } });
      this.logger.log(`Daily ${date} for ${channelId}: skipped (${reason})`);
      return this.runs.findById(run._id).lean();
    };
    if (trigger === 'schedule' && !(await this.isEnabled(channelId))) return skip('Paused by you');
    if (freeDiskGb(this.cfg.REEL_WORK_DIR) < this.cfg.REEL_MIN_FREE_DISK_GB) return skip('Server disk is almost full');

    try {
      const pick = await this.pickTopic(cid, date);
      if (!pick) return skip('Not enough matching footage for any topic today');
      const { topic, evidence, candidates } = pick;
      const target = Math.max(4, Math.min(7, Math.round((evidence.moments + evidence.videos) / 4)));
      const label = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const owner = await this.campaigns.db.collection('channels').findOne({ _id: cid }, { projection: { userId: 1 } });
      const campaign = await this.campaigns.create({
        channelId: cid,
        userId: owner?.userId ?? cid, // system-created on behalf of the channel owner
        origin: 'daily',
        dailyDate: date,
        name: truncate(`Daily ${label}: ${topic.name}`, 80),
        brief: topic.brief,
        status: 'queued',
        settings: { targetReels: Math.min(target, this.cfg.REEL_MAX_REELS_PER_CAMPAIGN), minSec: 30, maxSec: 60, allowCrossVideo: true, templateName: 'default', seedVideoIds: [] },
        progress: { stage: 'queued', message: 'Daily campaign — starting research' },
        log: [{ at: new Date(), level: 'info', msg: `Daily campaign for ${date}: ${topic.why}` }],
      });
      await this.queues.campaign('research', String(campaign._id));
      await this.runs.updateOne({ _id: run._id }, { $set: { status: 'started', topic, evidence, candidates, campaignId: campaign._id } });
      this.logger.log(`Daily ${date} for ${channelId}: "${topic.name}" (${evidence.moments} moments, ${evidence.videos} videos) → campaign ${campaign._id}`);
      return this.runs.findById(run._id).lean();
    } catch (err) {
      await this.runs.updateOne({ _id: run._id }, { $set: { status: 'failed', reason: errMsg(err).slice(0, 300) } });
      throw err;
    }
  }

  // ------------------------------------------------------------------ topic choice

  private async pickTopic(channelId: Types.ObjectId, date: string) {
    const db = this.campaigns.db;
    const since48h = new Date(Date.now() - 48 * 3600_000);
    const [trending, themes, entities, bank, bankPeople, recent] = await Promise.all([
      db
        .collection('trending_topics')
        .find({ channelId, fetchedAt: { $gte: since48h } }, { projection: { title: 1, summary: 1, opportunityScore: 1, channelFit: 1 } })
        .sort({ opportunityScore: -1 })
        .limit(15)
        .toArray()
        .catch(() => []),
      this.analytics.breakdown(String(channelId), 'theme', '30d').catch(() => ({ rows: [] as any[] })),
      this.analytics.breakdown(String(channelId), 'entity', '30d').catch(() => ({ rows: [] as any[] })),
      db.collection('reel_moments').aggregate([{ $match: { channelId } }, { $unwind: '$themes' }, { $group: { _id: '$themes', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 10 }]).toArray(),
      db.collection('reel_moments').aggregate([{ $match: { channelId } }, { $unwind: '$entityNames' }, { $group: { _id: '$entityNames', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 10 }]).toArray(),
      this.runs.find({ channelId, status: 'started', date: { $ne: date } }).sort({ date: -1 }).limit(14).select('topic.name').lean(),
    ]);

    const res: DailyTopicResult = await this.ai.generateJson({
      task: `daily-topic:${channelId}:${date}`,
      system: DAILY_TOPIC_SYSTEM,
      user: buildDailyTopicUser({
        date,
        trending: trending.map((t: any) => ({ title: String(t.title), summary: t.summary, score: t.opportunityScore, fit: t.channelFit })),
        performed: [...themes.rows, ...entities.rows].sort((a, b) => b.views - a.views).slice(0, 10).map((r) => ({ key: r.key, views: r.views, posts: r.posts })),
        recent: recent.map((r) => r.topic?.name ?? '').filter(Boolean),
        bankThemes: [...bank, ...bankPeople].map((b: any) => ({ key: String(b._id), n: b.n })),
      }),
      schema: DailyTopicSchema,
      schemaName: 'daily_topic',
      reasoningEffort: 'medium',
    });

    const scored = [];
    for (const c of res.candidates) {
      const words = [...new Set(c.keywords.map((k) => k.trim().toLowerCase()).filter((k) => k.length >= 3))].slice(0, 10);
      if (!words.length) continue;
      const re = new RegExp(words.map(escapeRe).join('|'), 'i');
      const [moments, videos] = await Promise.all([
        db.collection('reel_moments').countDocuments({ channelId, $or: [{ title: re }, { summary: re }, { entityNames: re }, { themes: re }] }),
        db.collection('videos').countDocuments({ channelId, deletedFromYoutube: { $ne: true }, durationSeconds: { $gt: 240 }, title: re }),
      ]);
      const score = Math.round((moments * 2 + videos) * (SIGNAL_WEIGHT[c.signal] ?? 1) * 10) / 10;
      scored.push({ c: { ...c, keywords: words }, moments, videos, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const best = scored.find((s) => s.moments + s.videos >= 3);
    if (!best) return null;
    return {
      topic: { name: best.c.name, brief: best.c.brief, why: best.c.why, signal: best.c.signal, keywords: best.c.keywords },
      evidence: { moments: best.moments, videos: best.videos },
      candidates: scored.map((s) => ({ name: s.c.name, signal: s.c.signal, moments: s.moments, videos: s.videos, score: s.score })),
    };
  }

  // ------------------------------------------------------------------ Daily tab

  async overview(channelId: string) {
    const cid = new Types.ObjectId(channelId);
    const runs = await this.runs.find({ channelId: cid }).sort({ date: -1 }).limit(45).lean();
    const campIds = runs.map((r) => r.campaignId).filter(Boolean) as Types.ObjectId[];
    const [camps, reelCounts, views] = await Promise.all([
      this.campaigns.find({ _id: { $in: campIds } }).select('status progress name').lean(),
      this.campaigns.db
        .collection('reels')
        .aggregate<{ _id: { c: Types.ObjectId; s: string }; n: number }>([{ $match: { campaignId: { $in: campIds } } }, { $group: { _id: { c: '$campaignId', s: '$status' }, n: { $sum: 1 } } }])
        .toArray(),
      this.analytics.viewsByCampaign(campIds),
    ]);
    const campById = new Map(camps.map((c) => [String(c._id), c]));
    const days = runs.map((r) => {
      const id = r.campaignId ? String(r.campaignId) : null;
      const counts = (s: string) => reelCounts.find((x) => String(x._id.c) === id && x._id.s === s)?.n ?? 0;
      const c = id ? campById.get(id) : undefined;
      const v = id ? views.get(id) : undefined;
      return {
        date: r.date,
        status: r.status,
        reason: r.reason ?? null,
        topic: r.topic ?? null,
        evidence: r.evidence ?? null,
        candidates: (r.candidates ?? []).slice(0, 6),
        campaignId: id,
        campaignStatus: c?.status ?? null,
        progress: c && !TERMINAL_CAMPAIGN_STATUSES.includes(c.status) ? c.progress?.message ?? null : null,
        reelsReady: counts('todo') + counts('posted'),
        reelsPosted: counts('posted'),
        views: v?.views ?? 0,
        posts: v?.posts ?? 0,
      };
    });
    const published = days.filter((d) => d.posts > 0);
    const avgPerPost = published.length ? published.reduce((n, d) => n + d.views, 0) / published.reduce((n, d) => n + d.posts, 0) : 0;
    const bySignal = ['trend', 'performance', 'archive'].map((s) => {
      const list = published.filter((d) => d.topic?.signal === s);
      const posts = list.reduce((n, d) => n + d.posts, 0);
      return { signal: s, days: list.length, views: list.reduce((n, d) => n + d.views, 0), avgPerPost: posts ? Math.round(list.reduce((n, d) => n + d.views, 0) / posts) : 0 };
    });
    return {
      enabled: await this.isEnabled(channelId),
      nextRunAt: nextDailyRun(),
      timezone: DAILY_TZ,
      today: nyDate(),
      avgViewsPerPost: Math.round(avgPerPost),
      bySignal,
      days: days.map((d) => ({
        ...d,
        verdict: d.posts === 0 || !avgPerPost ? null : d.views / d.posts >= avgPerPost * 1.25 ? 'better' : d.views / d.posts <= avgPerPost * 0.8 ? 'worse' : 'similar',
      })),
    };
  }
}
