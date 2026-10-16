import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { Reel, ReelDocument } from '../db/schemas/reel.schema';
import { ReelPost, ReelPostDocument } from '../db/schemas/reel-post.schema';
import { ReelPostMetric, ReelPostMetricDocument } from '../db/schemas/reel-post-metric.schema';
import { parsePeriodDays } from './publish.service';

export const BREAKDOWNS = ['platform', 'shape', 'theme', 'entity', 'duration', 'weekday', 'campaign'] as const;
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
