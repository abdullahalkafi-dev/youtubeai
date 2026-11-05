import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Video, VideoDocument } from '../mongo/schemas/video.schema';
import { MAX_ACTIVE_COMMENT_VIDEOS, MAX_ACTIVE_SHORT_COMMENT_VIDEOS } from '../automation/automation.constants';
import { ReplyKind, replyKind, SHORT_MAX_SECONDS, TOP_LANE_SIZE } from '../automation/comment-lanes';

/** Each kind has its own list: 10 long videos, 10 Shorts. */
export const capFor = (kind: ReplyKind) => (kind === 'short' ? MAX_ACTIVE_SHORT_COMMENT_VIDEOS : MAX_ACTIVE_COMMENT_VIDEOS);

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
 * Policy: two lists, each capped on its own: 10 long videos (MAX_ACTIVE_COMMENT_VIDEOS) and
 * 10 Shorts (MAX_ACTIVE_SHORT_COMMENT_VIDEOS). The 3 newest long videos are always on.
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
      .select('_id youtubeId title publishedAt privacyStatus autoReplyLastRanAt durationSeconds')
      .lean();
  }

  /**
   * The 3 newest public long videos are always on auto-reply (client, Nov 6 2026: "the main 3 recent long form
   * video must always be responded to in the comments automatically"). Turns on any that are off; returns them.
   */
  async ensureNewestLongEnabled(channelId: IdLike, n = TOP_LANE_SIZE) {
    const cId = toObjectId(channelId);
    const newest = await this.videoModel
      .find({
        channelId: cId,
        deletedFromYoutube: { $ne: true },
        privacyStatus: 'public',
        durationSeconds: { $gt: SHORT_MAX_SECONDS },
        publishedAt: { $lte: new Date() },
      })
      .sort({ publishedAt: -1 })
      .limit(n)
      .select('_id youtubeId title autoReplyEnabled')
      .lean();
    for (const v of newest) {
      if (v.autoReplyEnabled) continue;
      const res = await this.enableWithEviction(cId, v._id);
      this.logger.log(`Auto-reply: newest long video turned on: ${v.title} (${v.youtubeId})${res?.evicted.length ? `, replaced ${res.evicted.map((e) => e.youtubeId).join(', ')}` : ''}`);
    }
    return newest;
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

    const video = await this.videoModel.findById(targetOid).lean();
    if (!video) return null;
    if (video.deletedFromYoutube) return null;

    if (!video.autoReplyEnabled) {
      await this.videoModel.updateOne(
        { _id: video._id },
        { $set: { autoReplyEnabled: true } },
      );
    }

    // Evict only within the same kind: a Short replaces the oldest Short, a long video the oldest long video.
    const kind = replyKind(video);
    const maxActive = capFor(kind);
    const active = (await this.getActiveSet(cId)).filter((v) => replyKind(v) === kind);
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
   * Keep only the newest 10 long videos and the newest 10 Shorts (by YouTube publishedAt) in the active set.
   */
  async rebalanceToNewestUploads(
    channelId: IdLike,
  ): Promise<{ evicted: AutoReplyEvictedVideo[]; keptCount: number }> {
    const cId = toObjectId(channelId);
    const active = await this.getActiveSet(cId);
    const keep: typeof active = [];
    const evict: typeof active = [];
    for (const kind of ['long', 'short'] as const) {
      const ofKind = this.sortByPublishedNewestFirst(active.filter((v) => replyKind(v) === kind));
      keep.push(...ofKind.slice(0, capFor(kind)));
      evict.push(...ofKind.slice(capFor(kind)));
    }
    if (!evict.length) {
      return { evicted: [], keptCount: keep.length };
    }

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
