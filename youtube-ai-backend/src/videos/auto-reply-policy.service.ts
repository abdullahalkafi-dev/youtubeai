import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Video, VideoDocument } from '../mongo/schemas/video.schema';
import { MAX_ACTIVE_COMMENT_VIDEOS } from '../automation/automation.constants';

export interface AutoReplyEvictedVideo {
  videoId: string;
  youtubeId: string;
  title: string;
  publishedAt?: Date;
}

export interface AutoReplyEnableResult {
  videoId: string;
  youtubeId: string;
  title: string;
  publishedAt?: Date;
  evicted: AutoReplyEvictedVideo[];
}

export interface AutoAddSyncCandidate {
  _id: string | Types.ObjectId;
  youtubeId: string;
  title: string;
  publishedAt?: Date | string | null;
  privacyStatus?: string | null;
}

type IdLike = string | Types.ObjectId;

function toObjectId(id: IdLike): Types.ObjectId {
  return typeof id === 'string' ? new Types.ObjectId(id) : id;
}

function publishedMs(video: { publishedAt?: Date | string | null }): number {
  if (!video.publishedAt) return 0;
  const t = new Date(video.publishedAt).getTime();
  return Number.isFinite(t) ? t : 0;
}

function isPublicPrivacy(privacyStatus?: string | null): boolean {
  if (!privacyStatus) return true;
  return String(privacyStatus).toLowerCase() === 'public';
}

/**
 * Single source of truth for comment auto-reply list membership.
 * Policy: active set is capped at MAX_ACTIVE_COMMENT_VIDEOS.
 * Eviction key is YouTube publishedAt (oldest upload leaves), NOT added-to-list time.
 */
@Injectable()
export class AutoReplyPolicyService {
  private readonly logger = new Logger(AutoReplyPolicyService.name);

  constructor(
    @InjectModel(Video.name) private readonly videoModel: Model<VideoDocument>,
  ) {}

  async getActiveSet(channelId: IdLike) {
    const cId = toObjectId(channelId);
    return this.videoModel
      .find({
        channelId: cId,
        autoReplyEnabled: true,
        deletedFromYoutube: { $ne: true },
      })
      .select('_id youtubeId title publishedAt privacyStatus autoReplyLastRanAt')
      .lean();
  }

  private sortByPublishedOldestFirst<
    T extends { publishedAt?: Date | string | null; _id?: unknown },
  >(videos: T[]): T[] {
    return [...videos].sort((a, b) => {
      const pa = publishedMs(a);
      const pb = publishedMs(b);
      if (pa !== pb) return pa - pb;
      return String(a._id || '').localeCompare(String(b._id || ''));
    });
  }

  private sortByPublishedNewestFirst<
    T extends { publishedAt?: Date | string | null; _id?: unknown },
  >(videos: T[]): T[] {
    return [...videos].sort((a, b) => {
      const pa = publishedMs(a);
      const pb = publishedMs(b);
      if (pa !== pb) return pb - pa;
      return String(b._id || '').localeCompare(String(a._id || ''));
    });
  }

  private toEvicted(video: {
    _id: unknown;
    youtubeId: string;
    title: string;
    publishedAt?: Date | string | null;
  }): AutoReplyEvictedVideo {
    return {
      videoId: String(video._id),
      youtubeId: video.youtubeId,
      title: video.title,
      publishedAt: video.publishedAt
        ? new Date(video.publishedAt)
        : undefined,
    };
  }

  /**
   * Enable one video for auto-reply. If the active set exceeds the cap,
   * disable oldest publishedAt members until the set fits.
   * Never evicts the video being enabled.
   */
  async enableWithEviction(
    channelId: IdLike,
    videoId: IdLike,
  ): Promise<AutoReplyEnableResult | null> {
    const cId = toObjectId(channelId);
    const targetOid = toObjectId(videoId);
    const maxActive = MAX_ACTIVE_COMMENT_VIDEOS;

    const video = await this.videoModel.findById(targetOid).lean();
    if (!video) return null;
    if (video.deletedFromYoutube) return null;

    if (!video.autoReplyEnabled) {
      await this.videoModel.updateOne(
        { _id: video._id },
        { $set: { autoReplyEnabled: true } },
      );
    }

    const active = await this.getActiveSet(cId);
    const sortedOldestFirst = this.sortByPublishedOldestFirst(active);
    const targetId = String(video._id);
    const evicted: AutoReplyEvictedVideo[] = [];

    while (sortedOldestFirst.length > maxActive) {
      const evictIndex = sortedOldestFirst.findIndex(
        (v) => String(v._id) !== targetId,
      );
      if (evictIndex === -1) break;
      const victim = sortedOldestFirst.splice(evictIndex, 1)[0];
      await this.videoModel.updateOne(
        { _id: victim._id },
        { $set: { autoReplyEnabled: false } },
      );
      const evictedItem = this.toEvicted(victim);
      evicted.push(evictedItem);
      this.logger.log(
        `Auto-reply evicted oldest publishedAt video: ${evictedItem.title} (${evictedItem.youtubeId})`,
      );
    }

    return {
      videoId: targetId,
      youtubeId: video.youtubeId,
      title: video.title,
      publishedAt: video.publishedAt
        ? new Date(video.publishedAt)
        : undefined,
      evicted,
    };
  }

  /**
   * Keep only the newest N videos by YouTube publishedAt in the active set.
   */
  async rebalanceToNewestUploads(
    channelId: IdLike,
    maxActive = MAX_ACTIVE_COMMENT_VIDEOS,
  ): Promise<{ evicted: AutoReplyEvictedVideo[]; keptCount: number }> {
    const cId = toObjectId(channelId);
    const active = await this.getActiveSet(cId);
    if (active.length <= maxActive) {
      return { evicted: [], keptCount: active.length };
    }

    const newestFirst = this.sortByPublishedNewestFirst(active);
    const keep = newestFirst.slice(0, maxActive);
    const evict = newestFirst.slice(maxActive);

    for (const victim of evict) {
      await this.videoModel.updateOne(
        { _id: victim._id },
        { $set: { autoReplyEnabled: false } },
      );
      this.logger.log(
        `Auto-reply rebalance evicted: ${victim.title} (${victim.youtubeId})`,
      );
    }

    return {
      evicted: evict.map((v) => this.toEvicted(v)),
      keptCount: keep.length,
    };
  }

  /**
   * Auto-add genuine new public uploads (and privacy→public promotions),
   * then rebalance the active set to the newest N by publishedAt.
   * Callers must NOT pass first-sync bulk backfills.
   */
  async autoAddPublicUploads(
    channelId: IdLike,
    candidates: AutoAddSyncCandidate[],
  ): Promise<{
    added: Array<{ videoId: string; youtubeId: string; title: string; publishedAt?: Date }>;
    evicted: AutoReplyEvictedVideo[];
    skippedNonPublic: number;
  }> {
    if (!candidates.length) {
      return { added: [], evicted: [], skippedNonPublic: 0 };
    }

    const eligible = candidates.filter((v) => isPublicPrivacy(v.privacyStatus));
    const skippedNonPublic = candidates.length - eligible.length;

    if (!eligible.length) {
      return { added: [], evicted: [], skippedNonPublic };
    }

    const added: Array<{
      videoId: string;
      youtubeId: string;
      title: string;
      publishedAt?: Date;
    }> = [];

    for (const v of eligible) {
      const oid = toObjectId(v._id);
      await this.videoModel.updateOne(
        { _id: oid, deletedFromYoutube: { $ne: true } },
        { $set: { autoReplyEnabled: true } },
      );
      added.push({
        videoId: String(v._id),
        youtubeId: v.youtubeId,
        title: v.title,
        publishedAt: v.publishedAt ? new Date(v.publishedAt) : undefined,
      });
      this.logger.log(
        `Auto-reply auto-added public upload: ${v.title} (${v.youtubeId})`,
      );
    }

    const rebalance = await this.rebalanceToNewestUploads(channelId);

    return {
      added,
      evicted: rebalance.evicted,
      skippedNonPublic,
    };
  }

  /**
   * Should this sync run auto-add for created videos?
   * Skip first-sync backfills and large historical imports.
   */
  shouldAutoAddCreatedVideos(params: {
    isFirstSync: boolean;
    newCount: number;
  }): boolean {
    if (params.isFirstSync) return false;
    // Large create bursts are almost always backfill/history import.
    if (params.newCount > 3) return false;
    return params.newCount > 0;
  }

  /**
   * Filter sync-created videos down to genuine recent public uploads.
   */
  filterGenuineNewUploads(
    created: AutoAddSyncCandidate[],
    now = new Date(),
    maxAgeDays = 30,
  ): AutoAddSyncCandidate[] {
    const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
    return created.filter((v) => {
      if (!isPublicPrivacy(v.privacyStatus)) return false;
      const published = publishedMs(v);
      if (!published) return false;
      return published >= cutoff;
    });
  }
}
