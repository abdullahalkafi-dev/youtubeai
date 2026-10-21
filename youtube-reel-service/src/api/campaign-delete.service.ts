import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ReelCampaign, ReelCampaignDocument, TERMINAL_CAMPAIGN_STATUSES } from '../db/schemas/reel-campaign.schema';
import { ReelCampaignChat, ReelCampaignChatDocument } from '../db/schemas/reel-campaign-chat.schema';
import { ReelMoment, ReelMomentDocument } from '../db/schemas/reel-moment.schema';
import { ReelPost, ReelPostDocument } from '../db/schemas/reel-post.schema';
import { Reel, ReelDocument } from '../db/schemas/reel.schema';
import { campaignFamily } from '../common/campaign-family';
import { BUCKETS, StorageService } from '../storage/storage.service';

/** A post that is (or will be) on a platform: it stays there, and we keep its record so views keep being tracked. */
const ON_PLATFORM = ['processing', 'scheduled', 'published', 'removed'];

/**
 * "Delete campaign" = remove it from the app. It NEVER deletes anything from YouTube or any other platform
 * (and the UI never offers to): reel_posts rows are kept, which also keeps the main app's SEO automation away
 * from those videos and keeps their views in Performance.
 */
@Injectable()
export class CampaignDeleteService {
  private readonly logger = new Logger(CampaignDeleteService.name);

  constructor(
    @InjectModel(ReelCampaign.name) private readonly campaigns: Model<ReelCampaignDocument>,
    @InjectModel(Reel.name) private readonly reels: Model<ReelDocument>,
    @InjectModel(ReelMoment.name) private readonly moments: Model<ReelMomentDocument>,
    @InjectModel(ReelPost.name) private readonly posts: Model<ReelPostDocument>,
    @InjectModel(ReelCampaignChat.name) private readonly chats: Model<ReelCampaignChatDocument>,
    private readonly storage: StorageService,
  ) {}

  /** What the delete dialog shows: how many reels, which posts stay on their platform, and anything blocking it. */
  async preview(channelId: string, campaignId: string) {
    if (!Types.ObjectId.isValid(campaignId)) throw new NotFoundException('Campaign not found');
    // A daily campaign and its hidden explore part are one thing to the client: both go together.
    const fam = await campaignFamily(this.campaigns, campaignId, { channelId });
    if (!fam) throw new NotFoundException('Campaign not found');
    const c = fam.root;
    const [reels, posts] = await Promise.all([
      this.reels.find({ campaignId: { $in: fam.ids } }).select('status').lean(),
      this.posts.find({ campaignId: { $in: fam.ids }, status: { $in: [...ON_PLATFORM, 'uploading'] } }).select('platform status url metadata.title metadata.scheduleAt latestMetrics.views').lean(),
    ]);
    const blockers: string[] = [];
    if ([c, fam.child].some((x) => x && !TERMINAL_CAMPAIGN_STATUSES.includes(x.status))) blockers.push('This campaign is still running. Press Stop first, then delete it.');
    if (reels.some((r) => r.status === 'queued' || r.status === 'rendering')) blockers.push('Some reels are still being made. Try again in a minute.');
    if (posts.some((p) => p.status === 'uploading')) blockers.push('A video is uploading to YouTube right now. Wait until it finishes, then delete.');
    return {
      name: c.name,
      reels: reels.length,
      blockers,
      /** Already on a platform: these stay there. */
      livePosts: posts
        .filter((p) => ON_PLATFORM.includes(p.status))
        .map((p) => ({
          platform: p.platform,
          status: p.status,
          title: p.metadata?.title ?? '',
          url: p.url ?? null,
          views: p.latestMetrics?.views ?? null,
          scheduledFor: p.status === 'scheduled' ? p.metadata?.scheduleAt ?? null : null,
        })),
    };
  }

  async remove(channelId: string, campaignId: string) {
    const p = await this.preview(channelId, campaignId);
    if (p.blockers.length) throw new ConflictException(p.blockers[0]);
    const fam = (await campaignFamily(this.campaigns, campaignId, { channelId }))!;
    const ids = fam.ids;
    const now = new Date();
    const reels = await this.reels.find({ campaignId: { $in: ids } }).select('_id momentIds campaignId').lean();
    const reelIds = reels.map((r) => r._id);

    // Posts that never reached a platform are cancelled; posts that did are left exactly as they are.
    await this.posts.updateMany({ campaignId: { $in: ids }, status: { $in: ['queued', 'blocked'] } }, { $set: { status: 'cancelled', cancelRequested: true, error: null } });

    // Hide first (so nothing shows it any more), then clean up behind it.
    await this.reels.updateMany({ campaignId: { $in: ids } }, { $set: { deletedAt: now } });
    await this.campaigns.updateMany({ _id: { $in: ids } }, { $set: { deletedAt: now } });

    // Free the footage these reels used, so it can be used again by future campaigns.
    const momentIds = reels.flatMap((r) => r.momentIds ?? []);
    if (momentIds.length) {
      await this.moments.updateMany({ _id: { $in: momentIds } }, { $pull: { usedByReelIds: { $in: reelIds } } });
      await this.moments.updateMany({ _id: { $in: momentIds }, status: 'used', usedByReelIds: { $size: 0 } }, { $set: { status: 'unused' }, $unset: { lastUsedAt: '' } });
    }

    // Files: everything, except a published reel's cover and thumbnails (small; kept for the Performance views).
    const liveReels = new Set((await this.posts.find({ campaignId: { $in: ids }, status: { $in: ON_PLATFORM } }).select('reelId').lean()).map((x) => String(x.reelId)));
    let purged = 0;
    for (const r of reels) {
      const prefix = `${channelId}/${r.campaignId}/${r._id}/`;
      try {
        purged += liveReels.has(String(r._id)) ? await this.storage.removePrefixExcept(BUCKETS.reels, prefix, /(\/cover\.jpg|\/thumbs\/[^/]+)$/) : await this.storage.removePrefix(BUCKETS.reels, prefix);
      } catch (err) {
        this.logger.warn(`Delete ${campaignId}: could not purge ${prefix}: ${(err as Error).message}`);
      }
    }
    await this.chats.deleteMany({ campaignId: { $in: ids } });

    this.logger.log(`Campaign ${campaignId}${fam.child ? ' (+ explore part)' : ''} deleted from the app: ${reels.length} reels hidden, ${liveReels.size} kept on platforms, ${purged} files removed`);
    return { ok: true, reelsHidden: reels.length, stillOnPlatforms: p.livePosts.length, filesRemoved: purged };
  }
}
