import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Channel, ChannelDocument } from '../mongo/schemas/channel.schema';
import { User, UserDocument } from '../mongo/schemas/user.schema';
import { Video, VideoDocument } from '../mongo/schemas/video.schema';
import { SyncLog, SyncLogDocument } from '../mongo/schemas/sync-log.schema';
import { SeoVersion, SeoVersionDocument } from '../mongo/schemas/seo-version.schema';
import { YouTubeService } from '../youtube/youtube.service';
import { YoutubeAnalyticsService } from '../youtube/youtube-analytics.service';
import { QuotaService } from '../quota/quota.service';
import { ChromaService } from '../chroma/chroma.service';
import {
  CreateChannelDto,
  UpdateSeoSettingsDto,
  UpdateApiKeysDto,
} from './dto/create-channel.dto';

interface SyncChange {
  videoId: string;
  youtubeId: string;
  field: string;
  oldValue: string;
  newValue: string;
  action: 'created' | 'updated' | 'drifted' | 'deleted';
}

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    @InjectModel(Channel.name) private readonly channelModel: Model<ChannelDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Video.name) private readonly videoModel: Model<VideoDocument>,
    @InjectModel(SyncLog.name) private readonly syncLogModel: Model<SyncLogDocument>,
    @InjectModel(SeoVersion.name) private readonly seoVersionModel: Model<SeoVersionDocument>,
    private readonly configService: ConfigService,
    private readonly youtubeService: YouTubeService,
    private readonly youtubeAnalyticsService: YoutubeAnalyticsService,
    private readonly quotaService: QuotaService,
    private readonly chromaService: ChromaService,
  ) {}

  async findAllByUser(userId: string): Promise<any[]> {
    const user = await this.userModel.findById(userId).select('role').lean();
    const filter = user?.role === 'ADMIN' ? {} : { userId: new Types.ObjectId(userId) };
    const channels = await this.channelModel.find(filter).sort({ createdAt: -1 }).lean();
    return channels.map(ch => {
      const { _id, __v, userId: uid, ...rest } = ch;
      return { id: _id.toString(), userId: uid ? uid.toString() : '', ...rest };
    });
  }

  async findById(id: string): Promise<any> {
    const channel = await this.channelModel.findById(new Types.ObjectId(id)).lean();
    if (!channel) throw new NotFoundException(`Channel ${id} not found`);
    const { _id, __v, userId, ...rest } = channel;
    return { id: _id.toString(), userId: userId.toString(), ...rest };
  }

  async create(userId: string, dto: CreateChannelDto) {
    const maxChannels = this.configService.get<number>('limits.maxChannelsPerUser', 0);
    if (maxChannels > 0) {
      const count = await this.channelModel.countDocuments({ userId });
      if (count >= maxChannels) {
        throw new ForbiddenException('Maximum channel limit per user reached');
      }
    }
    return this.channelModel.create({ userId, ...dto });
  }

  async update(id: string, userId: string, dto: Partial<CreateChannelDto>) {
    const channel = await this.findById(id);
    await this.ensureOwnership(channel.userId.toString(), userId);
    return this.channelModel.findByIdAndUpdate(id, { $set: dto }, { new: true }).lean();
  }

  async updateSeoSettings(id: string, userId: string, dto: UpdateSeoSettingsDto) {
    const channel = await this.findById(id);
    await this.ensureOwnership(channel.userId.toString(), userId);
    const currentSettings = channel.seoSettings || {};
    return this.channelModel.findByIdAndUpdate(
      id,
      { $set: { seoSettings: { ...currentSettings, ...dto } } },
      { new: true },
    ).lean();
  }

  async updateApiKeys(id: string, userId: string, dto: UpdateApiKeysDto) {
    const channel = await this.findById(id);
    await this.ensureOwnership(channel.userId.toString(), userId);
    return this.channelModel.findByIdAndUpdate(id, { $set: dto }, { new: true }).lean();
  }

  async remove(id: string, userId: string) {
    const channel = await this.findById(id);
    await this.ensureOwnership(channel.userId.toString(), userId);
    return this.channelModel.findByIdAndDelete(id).lean();
  }

  async syncChannel(id: string, userId: string) {
    const channel = await this.findById(id);
    await this.ensureOwnership(channel.userId.toString(), userId);

    const accessToken = await this.youtubeService.getValidAccessToken(channel.userId.toString());

    const errors: string[] = [];
    const changes: SyncChange[] = [];
    let newCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;
    let driftedCount = 0;

    // Step 1: Fetch channel info
    const channelInfo = await this.youtubeService.getChannelInfo(accessToken);
    if (!channelInfo) throw new NotFoundException('Could not fetch channel info from YouTube');
    await this.quotaService.logCall({ channelId: id, endpoint: 'channels.list', quotaCost: 1 });

    // Step 2: Update channel stats
    await this.channelModel.findByIdAndUpdate(id, {
      $set: {
        youtubeChannelId: channelInfo.channelId,
        name: channelInfo.title,
        description: channelInfo.description,
        avatarUrl: channelInfo.thumbnailUrl,
        subscriberCount: channelInfo.subscriberCount,
        totalVideos: channelInfo.videoCount,
        totalViews: Number(channelInfo.viewCount),
      },
    });

    // Step 3: Get uploads playlist
    const contentDetails = await this.youtubeService.getChannelContentDetails(accessToken);
    if (!contentDetails.uploadsPlaylistId) throw new NotFoundException('Could not find uploads playlist');
    await this.quotaService.logCall({ channelId: id, endpoint: 'channels.list', quotaCost: 1 });

    // Step 4: Paginate playlist items
    const allVideoIds: string[] = [];
    let pageToken: string | undefined;
    let hasMore = true;
    let hitCap = false;

    while (hasMore) {
      try {
        const result = await this.youtubeService.getPlaylistItems(accessToken, contentDetails.uploadsPlaylistId, pageToken, 50);
        allVideoIds.push(...result.videoIds);
        pageToken = result.nextPageToken;
        hasMore = !!pageToken;
        await this.quotaService.logCall({ channelId: id, endpoint: 'playlistItems.list', quotaCost: 1 });
        if (allVideoIds.length >= 3000) {
          hasMore = false;
          hitCap = true;
          this.logger.warn(`Channel sync capped at 3000 videos`);
        }
      } catch (error) {
        errors.push(`Playlist fetch failed: ${error.message}`);
        hasMore = false;
      }
    }

    const youtubeVideoIds = new Set(allVideoIds);

    // Step 5: Fetch current DB videos for this channel
    const channelObjectId = new Types.ObjectId(id);
    const existingVideos = await this.videoModel.find({ channelId: channelObjectId }).lean();
    const existingByYoutubeId = new Map(existingVideos.map(v => [v.youtubeId, v]));

    // Check if this is the first sync (no videos have lastSyncedAt)
    const isFirstSync = existingVideos.every(v => !v.lastSyncedAt);

    // Step 6: Mark videos NOT in YouTube playlist as deleted (skip on first sync or if cap hit)
    if (!isFirstSync && !hitCap) {
      for (const dbVideo of existingVideos) {
        if (!youtubeVideoIds.has(dbVideo.youtubeId) && !dbVideo.deletedFromYoutube) {
          await this.videoModel.findByIdAndUpdate(dbVideo._id, {
            $set: { deletedFromYoutube: true, deletedAt: new Date() },
          });
          // Remove from ChromaDB so deleted videos don't appear in RAG
          try {
            await this.chromaService.delete('video_metadata', dbVideo._id.toString());
          } catch { /* RAG optional */ }
          deletedCount++;
          changes.push({
            videoId: dbVideo._id.toString(),
            youtubeId: dbVideo.youtubeId,
            field: 'status',
            oldValue: 'active',
            newValue: 'deleted',
            action: 'deleted',
          });
        }
      }
    }

    // Step 7: Fetch video details in parallel chunks (Concurrency = 5)
    const BATCH_SIZE = 50;
    const CONCURRENCY = 5;
    const videoBulkOps: any[] = [];

    const batches: string[][] = [];
    for (let i = 0; i < allVideoIds.length; i += BATCH_SIZE) {
      batches.push(allVideoIds.slice(i, i + BATCH_SIZE));
    }

    for (let i = 0; i < batches.length; i += CONCURRENCY) {
      const chunk = batches.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map(async (batch) => {
          try {
            const details = await this.youtubeService.getVideoDetails(accessToken, batch);
            await this.quotaService.logCall({ channelId: id, endpoint: 'videos.list', quotaCost: 1 });

            for (const ytVideo of details) {
              try {
                const existing = existingByYoutubeId.get(ytVideo.videoId);

                if (existing) {
                  // === DIFF-BASED UPDATE ===
                  const $set: any = {};
                  const $unset: any = {};

                  // Resurrect soft-deleted video
                  if (existing.deletedFromYoutube) {
                    $set.deletedFromYoutube = false;
                    $unset.deletedAt = '';
                  }

                  // Always update analytics/safe fields from YouTube
                  $set.viewCount = ytVideo.viewCount;
                  $set.likeCount = ytVideo.likeCount;
                  $set.commentCount = ytVideo.commentCount;
                  $set.thumbnailUrl = ytVideo.thumbnailUrl;
                  $set.duration = ytVideo.duration;
                  $set.durationSeconds = ytVideo.durationSeconds;
                  $set.privacyStatus = ytVideo.privacyStatus;
                  $set.lastSyncedAt = new Date();

                  // Live YouTube Studio metadata is the primary source of truth
                  if (existing.title !== ytVideo.title) {
                    $set.title = ytVideo.title;
                    changes.push({
                      videoId: existing._id.toString(),
                      youtubeId: ytVideo.videoId,
                      field: 'title',
                      oldValue: existing.title,
                      newValue: ytVideo.title,
                      action: 'updated',
                    });
                  }

                  if ((existing.description || '') !== (ytVideo.description || '')) {
                    $set.description = ytVideo.description;
                  }

                  if (JSON.stringify(existing.tags || []) !== JSON.stringify(ytVideo.tags || [])) {
                    $set.tags = ytVideo.tags;
                  }

                  // Update stored youtube fields
                  $set.youtubeTitle = ytVideo.title;
                  $set.youtubeDescription = ytVideo.description;
                  $set.youtubeTags = ytVideo.tags;

                  const hasChanges = Object.keys($set).length > 0 || Object.keys($unset).length > 0;
                  if (hasChanges) {
                    const updateOp: any = {};
                    if (Object.keys($set).length > 0) updateOp.$set = $set;
                    if (Object.keys($unset).length > 0) updateOp.$unset = $unset;
                    videoBulkOps.push({
                      updateOne: {
                        filter: { _id: existing._id },
                        update: updateOp,
                      },
                    });
                    updatedCount++;

                    // Re-embed in ChromaDB if title or description changed
                    if ($set.title || $set.description) {
                      const newTitle = $set.title || existing.title;
                      const newDesc = $set.description || existing.description || '';
                      const newTags = $set.tags || existing.tags || [];
                      this.chromaService.upsert(
                        'video_metadata',
                        existing._id.toString(),
                        `Title: ${newTitle}\nDescription: ${newDesc.slice(0, 500)}\nTags: ${newTags.join(', ')}`,
                        { channelId: id, viewCount: $set.viewCount || existing.viewCount, title: newTitle },
                      ).catch(err => this.logger.warn(`ChromaDB re-embed failed for ${existing._id}: ${err.message}`));
                    }
                  }
                } else {
                  // === NEW VIDEO ===
                  const created = await this.videoModel.create({
                    channelId: channelObjectId,
                    youtubeId: ytVideo.videoId,
                    title: ytVideo.title,
                    youtubeTitle: ytVideo.title,
                    description: ytVideo.description,
                    youtubeDescription: ytVideo.description,
                    tags: ytVideo.tags,
                    youtubeTags: ytVideo.tags,
                    thumbnailUrl: ytVideo.thumbnailUrl,
                    publishedAt: new Date(ytVideo.publishedAt),
                    duration: ytVideo.duration,
                    durationSeconds: ytVideo.durationSeconds,
                    viewCount: ytVideo.viewCount,
                    likeCount: ytVideo.likeCount,
                    commentCount: ytVideo.commentCount,
                    videoUrl: ytVideo.videoUrl,
                    definition: ytVideo.definition,
                    caption: ytVideo.caption,
                    categoryId: ytVideo.categoryId,
                    favoriteCount: ytVideo.favoriteCount,
                    privacyStatus: ytVideo.privacyStatus,
                    embeddable: ytVideo.embeddable,
                    publicStatsViewable: ytVideo.publicStatsViewable,
                    license: ytVideo.license,
                    defaultLanguage: ytVideo.defaultLanguage,
                    defaultAudioLanguage: ytVideo.defaultAudioLanguage,
                    liveBroadcastContent: ytVideo.liveBroadcastContent,
                    projection: ytVideo.projection,
                    seoStatus: 'not_started',
                    lastSyncedAt: new Date(),
                  });
                  newCount++;

                  // Save original version for rollback history
                  await this.seoVersionModel.create({
                    videoId: created._id,
                    type: 'original',
                    approved: false,
                    seo: {
                      title: ytVideo.title,
                      description: ytVideo.description || '',
                      tags: ytVideo.tags || [],
                      hashtags: [],
                    },
                    note: 'Original YouTube metadata at sync time',
                  });

                  // Embed in ChromaDB
                  this.chromaService.upsert(
                    'video_metadata',
                    created._id.toString(),
                    `Title: ${ytVideo.title}\nDescription: ${(ytVideo.description || '').slice(0, 500)}\nTags: ${(ytVideo.tags || []).join(', ')}`,
                    { channelId: id, viewCount: ytVideo.viewCount, title: ytVideo.title },
                  ).catch(err => this.logger.warn(`ChromaDB embed failed for new video: ${err.message}`));

                  changes.push({
                    videoId: created._id.toString(),
                    youtubeId: ytVideo.videoId,
                    field: 'status',
                    oldValue: '',
                    newValue: 'created',
                    action: 'created',
                  });
                }
              } catch (error: any) {
                errors.push(`Failed to save video ${ytVideo.videoId}: ${error.message}`);
              }
            }
          } catch (error: any) {
            errors.push(`Batch fetch failed: ${error.message}`);
          }
        }),
      );
    }

    if (videoBulkOps.length > 0) {
      await this.videoModel.bulkWrite(videoBulkOps);
      this.logger.log(`Step 7: Synced ${videoBulkOps.length} existing video updates via bulkWrite`);
    }

    // Step 8: Fetch analytics
    try {
      const ch = await this.channelModel.findById(id);
      if (ch?.youtubeChannelId) {
        const analyticsMap = await this.youtubeAnalyticsService.getChannelVideoAnalytics(userId, ch.youtubeChannelId);
        if (analyticsMap.size > 0) {
          const bulkOps = Array.from(analyticsMap.entries()).map(([youtubeId, analytics]) => ({
            updateMany: {
              filter: { channelId: channelObjectId, youtubeId },
              update: {
                $set: {
                  avgWatchTime: analytics.averageViewDuration,
                  retentionPercent: analytics.averageViewPercentage,
                  estimatedRevenue: analytics.estimatedRevenue,
                  lastAnalyticsSync: new Date(),
                },
              },
            },
          }));
          const result = await this.videoModel.bulkWrite(bulkOps);
          this.logger.log(`Analytics synced for ${result.modifiedCount || analyticsMap.size} videos via bulkWrite`);
        }
      }
    } catch (error) {
      errors.push(`Analytics sync failed: ${error.message}`);
    }

    // Step 9: Save sync log
    try {
      await this.syncLogModel.create({
        channelId: channelObjectId,
        videoCount: allVideoIds.length,
        newVideos: newCount,
        updatedVideos: updatedCount,
        deletedVideos: deletedCount,
        driftedVideos: driftedCount,
        errors,
        changes: changes.slice(0, 500),
      });
    } catch (error) {
      this.logger.warn(`Failed to save sync log: ${error.message}`);
    }

    const totalSynced = newCount + updatedCount;
    return {
      synced: totalSynced,
      new: newCount,
      updated: updatedCount,
      deleted: deletedCount,
      drifted: driftedCount,
      errors,
      channelStats: {
        subscriberCount: channelInfo.subscriberCount,
        videoCount: channelInfo.videoCount,
        viewCount: channelInfo.viewCount,
      },
    };
  }

  private async ensureOwnership(channelUserId: string, requestUserId: string) {
    const user = await this.userModel.findById(requestUserId).select('role').lean();
    if (user?.role === 'ADMIN') return;
    if (channelUserId !== requestUserId) throw new ForbiddenException('You do not own this channel');
  }
}
