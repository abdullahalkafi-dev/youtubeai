import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { errMsg } from '../common/errors';
import { nyDate } from '../common/time';
import { ReelCampaign, ReelCampaignDocument } from '../db/schemas/reel-campaign.schema';
import { ReelDailyRun, ReelDailyRunDocument } from '../db/schemas/reel-daily-run.schema';
import { ReelOpsReport, ReelOpsReportDocument } from '../db/schemas/reel-ops-report.schema';
import { entityPattern } from './daily-brain';
import { nyDayRange, OpsReportBody, opsIssues, POSTS_PER_DAY } from './ops-report';

const STUCK_HOURS = 3;
const MADE_STATUSES = ['queued', 'rendering', 'todo', 'posted'];

/**
 * Writes the developer's daily health record (`reel_ops_reports`): what each daily campaign made, which topics failed and why, stuck or
 * failed videos, download quality and the YouTube session, render fallbacks, stock and posting. Read-only towards the pipeline.
 */
@Injectable()
export class OpsReportService {
  private readonly logger = new Logger(OpsReportService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @InjectModel(ReelOpsReport.name) private readonly reports: Model<ReelOpsReportDocument>,
    @InjectModel(ReelCampaign.name) private readonly campaigns: Model<ReelCampaignDocument>,
    @InjectModel(ReelDailyRun.name) private readonly runs: Model<ReelDailyRunDocument>,
  ) {}

  /** Builds and stores the report of `date` (default: today in New York) for every channel that has campaigns. */
  async buildAll(date = nyDate()) {
    const out: Array<{ channelId: string; issues: string[] }> = [];
    for (const id of (await this.campaigns.distinct('channelId')) as Types.ObjectId[]) {
      try {
        const r = await this.build(id, date);
        out.push({ channelId: String(id), issues: r.issues });
      } catch (err) {
        this.logger.warn(`Ops report ${date} for ${id} failed: ${errMsg(err)}`);
      }
    }
    return out;
  }

  async build(channelId: Types.ObjectId, date: string) {
    const db = this.campaigns.db;
    const { start, end } = nyDayRange(date);
    const now = new Date();

    const run = await this.runs.findOne({ channelId, date }).lean();
    const camps = await this.campaigns.find({ channelId, origin: 'daily', dailyDate: date }).lean();
    const reelsBy = new Map<string, number>();
    for (const c of camps) reelsBy.set(String(c._id), await db.collection('reels').countDocuments({ campaignId: c._id, deletedAt: null, status: { $in: MADE_STATUSES } }));
    const made = [...reelsBy.values()].reduce((a, b) => a + b, 0);

    // topics: every main topic tried today, with the footage that really names its person
    const tried = [...(run?.fallbacks ?? []).map((f) => ({ name: f.name, outcome: 'failed' as const })), ...(run?.topic ? [{ name: run.topic.name, outcome: 'current' as const }] : [])];
    const topics: OpsReportBody['topics'] = [];
    for (const t of tried) {
      const c = (run?.candidates ?? []).find((x) => x.name === t.name);
      const rx = c?.entity ? entityPattern([c.entity]) : null;
      const footage = rx
        ? await db.collection('reel_moments').countDocuments({ channelId, $or: [{ entityNames: { $regex: rx, $options: 'i' } }, { title: { $regex: rx, $options: 'i' } }, { summary: { $regex: rx, $options: 'i' } }] })
        : c?.moments ?? 0;
      topics.push({ name: t.name, entity: c?.entity ?? null, footage, anchors: c?.anchors?.length ?? 0, outcome: t.outcome });
    }

    const stuckSince = new Date(now.getTime() - STUCK_HOURS * 3_600_000);
    const stuck = await db
      .collection('reel_sources')
      .find({ stage: { $in: ['downloading', 'downloaded', 'transcribing', 'mining'] }, updatedAt: { $lt: stuckSince } })
      .project({ youtubeId: 1, title: 1, stage: 1, updatedAt: 1 })
      .toArray();
    const views = async (yt: string) => ((await db.collection('videos').findOne({ youtubeId: yt }, { projection: { viewCount: 1 } })) as any)?.viewCount ?? 0;
    const stuckSources = [];
    for (const s of stuck) stuckSources.push({ youtubeId: s.youtubeId, title: s.title ?? '', stage: s.stage, hours: Math.round((now.getTime() - new Date(s.updatedAt).getTime()) / 3_600_000), views: await views(s.youtubeId) });
    const failedSources = (await db.collection('reel_sources').find({ stage: 'failed', updatedAt: { $gte: start, $lt: end } }).project({ youtubeId: 1, title: 1, error: 1 }).toArray()).map((s) => ({
      youtubeId: s.youtubeId,
      title: s.title ?? '',
      error: String(s.error ?? 'unknown'),
    }));

    const downloaded = await db.collection('reel_sources').find({ downloadedAt: { $gte: start, $lt: end } }).project({ height: 1 }).toArray();
    const heights: Record<string, number> = {};
    for (const s of downloaded) heights[String(s.height ?? '?')] = (heights[String(s.height ?? '?')] ?? 0) + 1;
    const session = ((await db.collection('reel_settings').findOne({ key: 'youtube-session' })) as any)?.value ?? {};

    const renderFailed = await db.collection('reels').countDocuments({ channelId, status: 'failed', updatedAt: { $gte: start, $lt: end }, error: { $ne: 'Campaign cancelled' } });
    const fallbacks = (await db.collection('reels').find({ channelId, lookNote: /render failed/, updatedAt: { $gte: start, $lt: end } }).project({ lookNote: 1 }).toArray()).map((r) => ({
      reelId: String(r._id),
      note: String(r.lookNote),
    }));

    const todo = await db.collection('reels').countDocuments({ channelId, status: 'todo', deletedAt: null });
    // YouTube health only: Facebook posts have their own section below, so a Facebook problem never reads as a YouTube one.
    const queuedPosts = await db.collection('reel_posts').countDocuments({ channelId, platform: 'youtube', status: 'queued' });
    const published = await db.collection('reel_posts').countDocuments({ channelId, platform: 'youtube', status: 'published', publishedAt: { $gte: start, $lt: end } });
    const failedPosts = (await db.collection('reel_posts').find({ channelId, platform: 'youtube', status: 'failed', updatedAt: { $gte: start, $lt: end } }).project({ errorCode: 1, error: 1 }).toArray()).map((p) => ({
      postId: String(p._id),
      errorCode: p.errorCode ?? null,
      error: String(p.error ?? ''),
    }));

    // Facebook lanes: this day's lane posts and whether the lane stopped by itself (reel_settings facebook-lane:<channel>)
    const fbState = ((await db.collection('reel_settings').findOne({ key: `facebook-lane:${channelId}` })) as any)?.value ?? {};
    const fbToday = await db.collection('reel_posts').find({ channelId, platform: 'facebook', source: { $in: ['fb-mirror', 'fb-extra', 'fb-backlog'] }, createdAt: { $gte: start, $lt: end } }).project({ status: 1, source: 1, errorCode: 1, error: 1 }).toArray();
    const facebook: OpsReportBody['facebook'] = {
      enabled: this.cfg.FACEBOOK_AUTO !== 'off',
      paused: !!fbState.pausedReason,
      pausedReason: fbState.pausedReason ?? null,
      posted: fbToday.filter((p) => p.status !== 'cancelled').length,
      published: fbToday.filter((p) => p.status === 'published').length,
      failed: fbToday.filter((p) => p.status === 'failed').map((p) => ({ postId: String(p._id), source: String(p.source), errorCode: p.errorCode ?? null, error: String(p.error ?? '') })),
    };

    // posts a day = the channel's auto-publish slots (2 since Nov 6 2026)
    const auto = ((await db.collection('reel_settings').findOne({ key: `autopublish:${channelId}` })) as any)?.value;
    const postsPerDay = Math.max(1, auto?.slots?.length ?? POSTS_PER_DAY);

    // the reels-vs-main-channel test: long videos of the last 14 days, views as of now
    const longs = await db
      .collection('videos')
      .find({ channelId, deletedFromYoutube: { $ne: true }, durationSeconds: { $gt: 180 }, publishedAt: { $gte: new Date(now.getTime() - 14 * 86_400_000), $lte: now } })
      .project({ youtubeId: 1, title: 1, publishedAt: 1, viewCount: 1 })
      .sort({ publishedAt: -1 })
      .toArray();
    const mainChannel = longs.map((v) => {
      const age = Math.max(0.5, (now.getTime() - new Date(v.publishedAt).getTime()) / 86_400_000);
      return { youtubeId: v.youtubeId, title: v.title ?? '', ageDays: Math.floor(age), views: v.viewCount ?? 0, viewsPerDay: Math.round((v.viewCount ?? 0) / age) };
    });

    // how many of the day's reels come from the newest videos (youngest source of each reel, under 15 days at the end of the day)
    const madeReels = await db.collection('reels').find({ campaignId: { $in: camps.map((c) => c._id) }, deletedAt: null, status: { $in: MADE_STATUSES } }).project({ 'clips.youtubeId': 1, openingMode: 1 }).toArray();
    const srcDates = new Map<string, number>();
    for (const v of await db.collection('videos').find({ youtubeId: { $in: [...new Set(madeReels.flatMap((r) => (r.clips ?? []).map((c: { youtubeId?: string }) => c.youtubeId)).filter(Boolean))] } }).project({ youtubeId: 1, publishedAt: 1 }).toArray()) {
      if (v.publishedAt) srcDates.set(v.youtubeId, new Date(v.publishedAt).getTime());
    }
    const fromHot = madeReels.filter((r) => {
      const newest = Math.max(0, ...(r.clips ?? []).map((c: { youtubeId?: string }) => srcDates.get(c.youtubeId ?? '') ?? 0));
      return newest > 0 && (Math.min(now.getTime(), end.getTime()) - newest) / 86_400_000 <= 15;
    }).length;

    const empty = camps.filter((c) => !reelsBy.get(String(c._id)));
    const body: OpsReportBody = {
      target: this.cfg.REEL_DAILY_REELS,
      made,
      run: {
        status: run?.status ?? null,
        reason: run?.reason ?? null,
        topic: run?.topic?.name ?? null,
        fallbacks: (run?.fallbacks ?? []).map((f) => ({ name: f.name, reason: f.reason })),
        backup: run?.backupCampaignId ? 'started' : run && run.backupCampaignId === null ? 'nothing to use' : 'none',
      },
      topics,
      campaigns: camps.map((c) => ({
        track: c.track ?? 'main',
        name: c.name,
        status: c.status,
        target: c.settings?.targetReels ?? 0,
        reels: reelsBy.get(String(c._id)) ?? 0,
        autoTopup: !!c.autoTopupAt,
        error: c.error ?? null,
      })),
      stuckSources,
      failedSources,
      downloads: { count: downloaded.length, heights, lowRes: downloaded.filter((s) => (s.height ?? 0) < 720).length },
      session: { status: session.status ?? null, cookiesUpdatedAt: session.updatedAt ?? null, lastCheckAt: session.lastCheckAt ?? null, lastError: session.lastError ?? null },
      renders: { failed: renderFailed, fullscreenFallbacks: fallbacks },
      stock: { todo, queuedPosts, daysLeft: Math.floor(Math.max(0, todo - queuedPosts) / postsPerDay) },
      posting: { published, failed: failedPosts },
      wasted: {
        promptTokens: empty.reduce((a, c) => a + (c.usage?.promptTokens ?? 0), 0),
        sttMinutes: Math.round(empty.reduce((a, c) => a + (c.usage?.sttSeconds ?? 0), 0) / 60),
      },
      mainChannel,
      facebook,
      hot: { fromHot, made: madeReels.length, relaxed: madeReels.filter((r) => r.openingMode === 'relaxed').length },
    };
    const issues = opsIssues(body, now);
    await this.reports.updateOne({ channelId, date }, { $set: { generatedAt: now, issues, body } }, { upsert: true });
    if (issues.length) this.logger.warn(`Ops report ${date}: ${issues.length} issue(s): ${issues.slice(0, 3).join(' | ')}`);
    return { date, issues, body };
  }

  /** The stored reports of the last `days` days, newest first. */
  async latest(days = 7) {
    return this.reports.find({}).sort({ date: -1 }).limit(Math.max(1, days)).lean();
  }
}
