import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';

/**
 * Read-only snapshot of Reels Studio (owned by the separate reel service) for the AI chat:
 * campaigns, their reels, where they were published and the views they earned.
 * Never writes; if the reel collections are missing, it returns nothing.
 */
@Injectable()
export class ReelContextService {
  private readonly logger = new Logger(ReelContextService.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  /** Questions about reels / shorts / campaigns. */
  static isReelQuery(q: string): boolean {
    return /\b(reels?|shorts?|campaigns?|reel studio|posted reels?)\b/i.test(q || '');
  }

  async build(channelId: string): Promise<string> {
    try {
      const db = this.connection.db;
      if (!db) return '';
      const cid = new Types.ObjectId(channelId);
      const campaigns = await db
        .collection('reel_campaigns')
        .find({ channelId: cid }, { projection: { name: 1, brief: 1, status: 1, createdAt: 1, 'settings.targetReels': 1 } })
        .sort({ createdAt: -1 })
        .limit(15)
        .toArray();
      if (!campaigns.length) return '';
      const ids = campaigns.map((c) => c._id);

      const [reelCounts, postAgg, topPosts] = await Promise.all([
        db
          .collection('reels')
          .aggregate<{ _id: { c: Types.ObjectId; s: string }; n: number }>([
            { $match: { campaignId: { $in: ids } } },
            { $group: { _id: { c: '$campaignId', s: '$status' }, n: { $sum: 1 } } },
          ])
          .toArray(),
        db
          .collection('reel_posts')
          .aggregate<{ _id: { c: Types.ObjectId; p: string }; posts: number; views: number; likes: number; comments: number }>([
            { $match: { campaignId: { $in: ids }, status: 'published' } },
            {
              $group: {
                _id: { c: '$campaignId', p: '$platform' },
                posts: { $sum: 1 },
                views: { $sum: { $ifNull: ['$latestMetrics.views', 0] } },
                likes: { $sum: { $ifNull: ['$latestMetrics.likes', 0] } },
                comments: { $sum: { $ifNull: ['$latestMetrics.comments', 0] } },
              },
            },
          ])
          .toArray(),
        db
          .collection('reel_posts')
          .find({ channelId: cid, status: 'published' }, { projection: { campaignId: 1, platform: 1, 'metadata.title': 1, latestMetrics: 1, publishedAt: 1 } })
          .sort({ 'latestMetrics.views': -1 })
          .limit(8)
          .toArray(),
      ]);

      const nameById = new Map(campaigns.map((c) => [String(c._id), String(c.name)]));
      const lines = ['', '', '## REELS STUDIO (short vertical reels made from the channel\'s long videos)'];
      lines.push('Only YouTube is connected for publishing today; other platforms come later. Views of posts under ~48h old are still growing.');
      for (const c of campaigns) {
        const counts = reelCounts.filter((r) => String(r._id.c) === String(c._id));
        const n = (s: string) => counts.find((r) => r._id.s === s)?.n ?? 0;
        const plats = postAgg.filter((p) => String(p._id.c) === String(c._id));
        const views = plats.reduce((a, p) => a + p.views, 0);
        const posts = plats.reduce((a, p) => a + p.posts, 0);
        const byPlat = plats.map((p) => `${p._id.p}: ${p.views} views / ${p.posts} posts`).join(', ');
        lines.push(
          `- Campaign "${c.name}" (${c.status}, started ${new Date(c.createdAt).toISOString().slice(0, 10)}): ${n('todo')} reels waiting in To-do, ${n('posted')} posted, ${n('rejected')} rejected; ` +
            (posts ? `${posts} published posts, ${views} views total, ${Math.round(views / posts)} views per post${byPlat ? ` (${byPlat})` : ''}` : 'nothing published yet'),
        );
      }
      if (topPosts.length) {
        lines.push('Top published reels by views:');
        for (const p of topPosts) {
          const m = p.latestMetrics ?? {};
          lines.push(
            `- "${p.metadata?.title ?? 'reel'}" — ${p.platform}, campaign "${nameById.get(String(p.campaignId)) ?? 'other'}", ${m.views ?? 0} views, ${m.likes ?? 0} likes, ${m.comments ?? 0} comments, published ${p.publishedAt ? new Date(p.publishedAt).toISOString().slice(0, 10) : '?'}`,
          );
        }
      }
      lines.push('Each campaign page in Reels Studio also has its own assistant for campaign-specific questions.');
      return lines.join('\n');
    } catch (err: any) {
      this.logger.warn(`Reel context skipped: ${err?.message || err}`);
      return '';
    }
  }
}
