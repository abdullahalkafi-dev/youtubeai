import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { Reel, ReelDocument } from '../db/schemas/reel.schema';
import { ReelPost, ReelPostDocument } from '../db/schemas/reel-post.schema';
import { ReelPostMetric, ReelPostMetricDocument } from '../db/schemas/reel-post-metric.schema';
import { parsePeriodDays } from './publish.service';

export const BREAKDOWNS = ['platform', 'shape', 'theme', 'entity', 'duration', 'weekday', 'campaign', 'images', 'voice'] as const;
export type Breakdown = (typeof BREAKDOWNS)[number];

const DURATION_BUCKETS = [0, 30, 45, 60, 1e9];
const DURATION_LABELS = ['under 30s', '30–45s', '45–60s', 'over 60s'];
const WEEKDAYS = ['', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Roll-ups of what each post earned: by reel, platform, format, topic, length and weekday. */
@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(ReelPost.name) private readonly posts: Model<ReelPostDocument>,
    @InjectModel(Reel.name) private readonly reels: Model<ReelDocument>,
    @InjectModel(ReelPostMetric.name) private readonly metrics: Model<ReelPostMetricDocument>,
  ) {}

  private since(period: string) {
    return period === 'all' ? new Date(0) : new Date(Date.now() - parsePeriodDays(period) * 86_400_000);
  }

  /** Headline numbers for the period (posts published in it). */
  async overview(channelId: string, period: string) {
    const cid = new Types.ObjectId(channelId);
    const since = this.since(period);
    const published = { channelId: cid, status: { $in: ['published', 'scheduled', 'removed'] }, publishedAt: { $gte: since } };

    const [totals, byPlatform, statusAgg, top] = await Promise.all([
      this.posts.aggregate<{ posts: number; views: number; likes: number; comments: number; watchMinutes: number }>([
        { $match: { ...published, status: 'published' } },
        {
          $group: {
            _id: null,
            posts: { $sum: 1 },
            views: { $sum: { $ifNull: ['$latestMetrics.views', 0] } },
            likes: { $sum: { $ifNull: ['$latestMetrics.likes', 0] } },
            comments: { $sum: { $ifNull: ['$latestMetrics.comments', 0] } },
            watchMinutes: { $sum: { $ifNull: ['$latestMetrics.watchMinutes', 0] } },
          },
        },
      ]),
      this.posts.aggregate<{ _id: string; posts: number; views: number }>([
        { $match: { ...published, status: 'published' } },
        { $group: { _id: '$platform', posts: { $sum: 1 }, views: { $sum: { $ifNull: ['$latestMetrics.views', 0] } } } },
        { $sort: { views: -1 } },
      ]),
      this.posts.aggregate<{ _id: string; n: number }>([
        { $match: { channelId: cid, createdAt: { $gte: since } } },
        { $group: { _id: '$status', n: { $sum: 1 } } },
      ]),
      this.posts
        .find({ ...published, status: 'published', 'latestMetrics.views': { $exists: true } })
        .sort({ 'latestMetrics.views': -1 })
        .limit(5)
        .select('reelId platform url metadata.title latestMetrics publishedAt')
        .lean(),
    ]);
    const t = totals[0] ?? { posts: 0, views: 0, likes: 0, comments: 0, watchMinutes: 0 };
    return {
      period,
      since,
      posts: t.posts,
      views: t.views,
      likes: t.likes,
      comments: t.comments,
      watchMinutes: Math.round(t.watchMinutes),
      avgViewsPerPost: t.posts ? Math.round(t.views / t.posts) : 0,
      byPlatform: byPlatform.map((p) => ({ platform: p._id, posts: p.posts, views: p.views })),
      statuses: Object.fromEntries(statusAgg.map((s) => [s._id, s.n])),
      top: top.map((p) => ({
        postId: String(p._id),
        reelId: String(p.reelId),
        platform: p.platform,
        url: p.url ?? null,
        title: p.metadata?.title ?? '',
        views: p.latestMetrics?.views ?? 0,
        publishedAt: p.publishedAt,
      })),
    };
  }

  /** Which kinds of reels perform: group published posts by a property of their reel. */
  async breakdown(channelId: string, by: Breakdown, period: string) {
    if (!BREAKDOWNS.includes(by)) throw new BadRequestException(`Unknown breakdown "${by}"`);
    const cid = new Types.ObjectId(channelId);
    const pipeline: PipelineStage[] = [
      { $match: { channelId: cid, status: 'published', publishedAt: { $gte: this.since(period) }, 'latestMetrics.views': { $exists: true } } },
      { $lookup: { from: 'reels', localField: 'reelId', foreignField: '_id', as: 'reel' } },
      { $unwind: '$reel' },
    ];
    let key: unknown;
    switch (by) {
      case 'platform':
        key = '$platform';
        break;
      case 'shape':
        key = '$reel.shape';
        break;
      case 'campaign':
        key = '$campaignId';
        break;
      case 'weekday':
        key = { $dayOfWeek: { date: '$publishedAt', timezone: 'America/New_York' } };
        break;
      case 'duration':
        key = '$bucketKey'; // computed below
        break;
      case 'images': {
        // how many AI pictures the reel had: does a busier reel keep people watching?
        const n = { $size: { $filter: { input: { $ifNull: ['$reel.visuals', []] }, as: 'v', cond: { $eq: ['$$v.status', 'ready'] } } } };
        pipeline.push({
          $addFields: {
            picKey: { $switch: { branches: [{ case: { $eq: [n, 0] }, then: 'No pictures' }, { case: { $lte: [n, 2] }, then: '1–2 pictures' }, { case: { $lte: [n, 4] }, then: '3–4 pictures' }], default: '5 or more pictures' } },
          },
        });
        key = '$picKey';
        break;
      }
      case 'voice':
        // the pace/voice treatment the reel was rendered with (older reels have none recorded)
        pipeline.push({
          $addFields: {
            voiceKey: {
              $switch: {
                branches: [
                  { case: { $eq: ['$reel.timing.voice', 'energetic'] }, then: { $concat: ['Energetic voice ', { $toString: '$reel.timing.speed' }, 'x'] } },
                  { case: { $eq: ['$reel.timing.voice', 'chipmunk'] }, then: { $concat: ['Chipmunk voice ', { $toString: '$reel.timing.speed' }, 'x'] } },
                  { case: { $eq: ['$reel.timing.voice', 'natural'] }, then: { $concat: ['Natural voice ', { $toString: '$reel.timing.speed' }, 'x'] } },
                ],
                default: 'Older reels (before pacing)',
              },
            },
          },
        });
        key = '$voiceKey';
        break;
      case 'theme':
        pipeline.push({ $unwind: '$reel.themes' });
        key = '$reel.themes';
        break;
      case 'entity':
        pipeline.push({ $unwind: '$reel.entityNames' });
        key = '$reel.entityNames';
        break;
    }
    if (by === 'duration') {
      const branches = DURATION_LABELS.slice(0, -1).map((label, i) => ({ case: { $lt: ['$reel.durationSec', DURATION_BUCKETS[i + 1]] }, then: label }));
      pipeline.push({ $addFields: { bucketKey: { $switch: { branches, default: DURATION_LABELS[DURATION_LABELS.length - 1] } } } });
    }
    pipeline.push(
      {
        $group: {
          _id: key,
          posts: { $sum: 1 },
          views: { $sum: '$latestMetrics.views' },
          likes: { $sum: { $ifNull: ['$latestMetrics.likes', 0] } },
          comments: { $sum: { $ifNull: ['$latestMetrics.comments', 0] } },
          watchMinutes: { $sum: { $ifNull: ['$latestMetrics.watchMinutes', 0] } },
          avgViewPct: { $avg: '$latestMetrics.avgViewPct' },
        },
      },
      { $sort: { views: -1 } },
      { $limit: 30 },
    );
    const rows = await this.posts.aggregate<{ _id: unknown; posts: number; views: number; likes: number; comments: number; watchMinutes: number; avgViewPct: number | null }>(pipeline);

    let names = new Map<string, string>();
    if (by === 'campaign') {
      const camps = await this.reels.db.collection('reel_campaigns').find({ _id: { $in: rows.map((r) => r._id as Types.ObjectId) } }, { projection: { name: 1 } }).toArray();
      names = new Map(camps.map((c) => [String(c._id), String(c.name)]));
    }
    return {
      by,
      period,
      rows: rows.map((r) => ({
        key: by === 'weekday' ? WEEKDAYS[Number(r._id)] ?? String(r._id) : by === 'campaign' ? names.get(String(r._id)) ?? String(r._id) : String(r._id),
        posts: r.posts,
        views: r.views,
        avgViews: r.posts ? Math.round(r.views / r.posts) : 0,
        likes: r.likes,
        comments: r.comments,
        watchMinutes: Math.round(r.watchMinutes),
        avgViewPct: r.avgViewPct !== null && r.avgViewPct !== undefined ? Math.round(r.avgViewPct * 10) / 10 : null,
      })),
    };
  }

  /** Total views per campaign (published posts only) — for the campaign list. */
  async viewsByCampaign(campaignIds: Types.ObjectId[]): Promise<Map<string, { views: number; posts: number }>> {
    if (!campaignIds.length) return new Map();
    const rows = await this.posts.aggregate<{ _id: Types.ObjectId; views: number; posts: number }>([
      { $match: { campaignId: { $in: campaignIds }, status: 'published' } },
      { $group: { _id: '$campaignId', views: { $sum: { $ifNull: ['$latestMetrics.views', 0] } }, posts: { $sum: 1 } } },
    ]);
    return new Map(rows.map((r) => [String(r._id), { views: r.views, posts: r.posts }]));
  }

  /**
   * How one campaign is doing: totals, views per platform, its reels ranked, and a plain verdict against the
   * channel's other campaigns. The verdict compares first-day views (24h snapshot) when both sides have them,
   * because lifetime totals favour older posts; otherwise it falls back to lifetime views per post.
   */
  async campaignPerformance(channelId: string, campaignId: string) {
    if (!Types.ObjectId.isValid(campaignId)) throw new NotFoundException('Campaign not found');
    const cid = new Types.ObjectId(channelId);
    const campId = new Types.ObjectId(campaignId);
    const camp = await this.reels.db.collection('reel_campaigns').findOne({ _id: campId, channelId: cid, deletedAt: null }, { projection: { name: 1 } });
    if (!camp) throw new NotFoundException('Campaign not found');

    const [posts, reelDocs, totalReels] = await Promise.all([
      this.posts
        .find({ campaignId: campId, status: { $in: ['published', 'scheduled', 'processing', 'removed'] } })
        .select('reelId platform status url publishedAt latestMetrics metadata.title')
        .lean(),
      this.reels.find({ campaignId: campId }).select('packaging.title concept status').lean(),
      this.reels.countDocuments({ campaignId: campId, status: { $in: ['todo', 'posted'] } }),
    ]);
    const published = posts.filter((p) => p.status === 'published');
    const sum = (list: typeof posts, k: 'views' | 'likes' | 'comments') => list.reduce((n, p) => n + (p.latestMetrics?.[k] ?? 0), 0);

    const platforms = [...new Set(published.map((p) => p.platform))];
    const byPlatform = platforms
      .map((platform) => {
        const list = published.filter((p) => p.platform === platform);
        return { platform, posts: list.length, views: sum(list, 'views'), likes: sum(list, 'likes'), comments: sum(list, 'comments') };
      })
      .sort((a, b) => b.views - a.views);

    const titleById = new Map(reelDocs.map((r) => [String(r._id), r.packaging?.title || r.concept || 'Reel']));
    const reelIds = [...new Set(published.map((p) => String(p.reelId)))];
    const reels = reelIds
      .map((id) => {
        const list = published.filter((p) => String(p.reelId) === id);
        return {
          reelId: id,
          title: titleById.get(id) ?? 'Reel',
          views: sum(list, 'views'),
          likes: sum(list, 'likes'),
          comments: sum(list, 'comments'),
          platforms: list.map((p) => ({ platform: p.platform, views: p.latestMetrics?.views ?? 0, url: p.url ?? null })),
        };
      })
      .sort((a, b) => b.views - a.views);

    const views = sum(published, 'views');
    const comparison = await this.compareWithChannel(cid, campId, published.map((p) => p._id as Types.ObjectId), published.length ? views / published.length : 0);
    const lastUpdated = published.reduce<Date | null>((d, p) => {
      const at = p.latestMetrics?.capturedAt ? new Date(p.latestMetrics.capturedAt) : null;
      return at && (!d || at > d) ? at : d;
    }, null);

    return {
      campaignId,
      name: String(camp.name ?? ''),
      totals: {
        views,
        likes: sum(published, 'likes'),
        comments: sum(published, 'comments'),
        posts: published.length,
        reelsPublished: reelIds.length,
        reelsReady: totalReels,
        pending: posts.filter((p) => p.status === 'scheduled' || p.status === 'processing').length,
      },
      avgViewsPerPost: published.length ? Math.round(views / published.length) : 0,
      byPlatform,
      reels,
      comparison,
      lastUpdated,
    };
  }

  private async compareWithChannel(channelId: Types.ObjectId, campaignId: Types.ObjectId, ownPostIds: Types.ObjectId[], ownLifetimeAvg: number) {
    const others = await this.posts
      .find({ channelId, campaignId: { $ne: campaignId }, status: 'published' })
      .select('_id campaignId latestMetrics.views')
      .lean();
    const otherCampaigns = new Set(others.map((p) => String(p.campaignId))).size;
    if (!ownPostIds.length || !others.length) {
      return { verdict: 'not_enough_data' as const, basis: null, campaignAvg: Math.round(ownLifetimeAvg), channelAvg: null, otherCampaigns };
    }

    // First-day views where both sides have a 24h snapshot.
    const day = await this.metrics.aggregate<{ _id: Types.ObjectId; views: number }>([
      { $match: { postId: { $in: [...ownPostIds, ...others.map((p) => p._id as Types.ObjectId)] }, checkpoint: '24h' } },
      { $group: { _id: '$postId', views: { $max: '$views' } } },
    ]);
    const dayById = new Map(day.map((d) => [String(d._id), d.views]));
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const ownDay = ownPostIds.map((id) => dayById.get(String(id))).filter((v): v is number => v !== undefined);
    const otherDay = others.map((p) => dayById.get(String(p._id))).filter((v): v is number => v !== undefined);

    let basis: 'first_day' | 'lifetime';
    let mine: number;
    let theirs: number;
    if (ownDay.length && otherDay.length) {
      basis = 'first_day';
      mine = avg(ownDay);
      theirs = avg(otherDay);
    } else {
      basis = 'lifetime';
      mine = ownLifetimeAvg;
      theirs = avg(others.map((p) => p.latestMetrics?.views ?? 0));
    }
    const ratio = theirs > 0 ? mine / theirs : mine > 0 ? 2 : 1;
    const verdict = ratio >= 1.25 ? ('better' as const) : ratio <= 0.8 ? ('worse' as const) : ('similar' as const);
    return { verdict, basis, campaignAvg: Math.round(mine), channelAvg: Math.round(theirs), otherCampaigns };
  }

  /** Numbers over time for one post (one point per checkpoint) — for the chart. */
  async series(channelId: string, postId: string) {
    if (!Types.ObjectId.isValid(postId)) throw new NotFoundException('Post not found');
    const post = await this.posts.findOne({ _id: postId, channelId }).select('_id').lean();
    if (!post) throw new NotFoundException('Post not found');
    const rows = await this.metrics.find({ postId }).sort({ capturedAt: 1 }).lean();
    return rows.map((r) => ({
      capturedAt: r.capturedAt,
      ageHours: r.ageHours,
      checkpoint: r.checkpoint,
      views: r.views,
      likes: r.likes ?? null,
      comments: r.comments ?? null,
      watchMinutes: r.watchMinutes ?? null,
      avgViewPct: r.avgViewPct ?? null,
      subscribersGained: r.subscribersGained ?? null,
      provisional: r.provisional,
    }));
  }
}
