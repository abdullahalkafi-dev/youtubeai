import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  OnApplicationBootstrap,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Video, VideoDocument } from '../mongo/schemas/video.schema';
import { Channel, ChannelDocument } from '../mongo/schemas/channel.schema';
import {
  AutomationBatch,
  AutomationBatchDocument,
} from '../mongo/schemas/automation-batch.schema';
import {
  SeoVersion,
  SeoVersionDocument,
} from '../mongo/schemas/seo-version.schema';
import {
  SeoSuggestion,
  SeoSuggestionDocument,
} from '../mongo/schemas/seo-suggestion.schema';
import { User, UserDocument } from '../mongo/schemas/user.schema';
import { SeoService } from '../seo/seo.service';
import { YouTubeService } from '../youtube/youtube.service';
import { QuotaService, QuotaExceededException } from '../quota/quota.service';
import { AutomationGateway } from './automation.gateway';
import { BatchQueryDto } from './dto/automation.dto';
import { leanDoc, leanDocs } from '../common/utils/lean';

const YOUTUBE_QUOTA_COST_PER_VIDEO = 51; // 1 unit videos.list + 50 units videos.update
const YOUTUBE_HARD_CAP_CEILING = 9000; // 90% of 10,000 daily quota
const PUSH_SAFETY_GAP_MS = 5000; // 5-second burst smoothing gap
const MAX_PUSH_ATTEMPTS = 4; // 1 initial attempt + 3 retries
const STALE_LOCK_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours fallback
const HEARTBEAT_STALE_MS = 15 * 60 * 1000; // 15 minutes without heartbeat

@Injectable()
export class AutomationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AutomationService.name);
  private activeBatchCancelTokens = new Map<string, boolean>();

  constructor(
    @InjectModel(AutomationBatch.name)
    private readonly batchModel: Model<AutomationBatchDocument>,
    @InjectModel(Video.name)
    private readonly videoModel: Model<VideoDocument>,
    @InjectModel(Channel.name)
    private readonly channelModel: Model<ChannelDocument>,
    @InjectModel(SeoVersion.name)
    private readonly seoVersionModel: Model<SeoVersionDocument>,
    @InjectModel(SeoSuggestion.name)
    private readonly seoSuggestionModel: Model<SeoSuggestionDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @Inject(forwardRef(() => SeoService))
    private readonly seoService: SeoService,
    private readonly youtubeService: YouTubeService,
    private readonly quotaService: QuotaService,
    private readonly gateway: AutomationGateway,
  ) {}

  /**
   * Startup Hook: Auto-recovers stale channel locks & reconciles stuck batch items
   */
  async onApplicationBootstrap() {
    this.logger.log('AutomationService initialized. Running crash recovery & stale lock reconciliation...');
    try {
      await this.recoverStaleBatches();
    } catch (err: any) {
      this.logger.error(`Error during startup stale batch recovery: ${err.message}`);
    }
  }

  private async recoverStaleBatches() {
    const activeChannels = await this.channelModel.find({
      isBatchRunning: true,
    }).lean();

    for (const channel of activeChannels) {
      const channelId = channel._id.toString();
      const batchId = channel.activeBatchId;

      if (!batchId) {
        this.logger.warn(`Channel ${channelId} locked with no activeBatchId. Releasing lock.`);
        await this.channelModel.findByIdAndUpdate(channelId, {
          $set: { isBatchRunning: false, activeBatchId: null },
        });
        continue;
      }

      const batch = await this.batchModel.findById(batchId);
      if (!batch) {
        this.logger.warn(`Channel ${channelId} refers to non-existent batch ${batchId}. Releasing lock.`);
        await this.channelModel.findByIdAndUpdate(channelId, {
          $set: { isBatchRunning: false, activeBatchId: null },
        });
        continue;
      }

      const now = Date.now();
      const started = batch.startedAt ? new Date(batch.startedAt).getTime() : 0;
      const heartbeat = batch.lastHeartbeatAt ? new Date(batch.lastHeartbeatAt).getTime() : started;
      const isStale = (now - heartbeat > HEARTBEAT_STALE_MS) || (now - started > STALE_LOCK_THRESHOLD_MS);

      if (isStale || ['checking_quota', 'generating', 'staging', 'pushing'].includes(batch.status)) {
        this.logger.warn(`Reconciling stuck batch ${batch._id} for channel ${channelId} (Status: ${batch.status})`);
        await this.reconcileStuckBatch(batch, channel);
      }
    }
  }

  private async reconcileStuckBatch(batch: AutomationBatchDocument, channel: any) {
    let userAccessToken: string | null = null;
    try {
      if (channel.userId) {
        userAccessToken = await this.youtubeService.getValidAccessToken(channel.userId.toString());
      }
    } catch (e: any) {
      this.logger.warn(`Could not get access token for reconciliation of channel ${channel._id}: ${e.message}`);
    }

    let successful = 0;
    let failed = 0;
    let skipped = 0;

    for (const item of batch.items) {
      if (item.status === 'completed') {
        successful++;
      } else if (item.status === 'skipped_manual_override') {
        skipped++;
      } else if (item.status === 'pushing' && userAccessToken && item.youtubeId && item.generatedTitle) {
        // Inspect live YouTube snippet with complete intended SEO comparison
        try {
          const ytDetails = await this.youtubeService.getVideoDetails(userAccessToken, [item.youtubeId]);
          const live = ytDetails?.[0];
          const titleMatch = live && live.title === item.generatedTitle;
          const descMatch = live && (!item.generatedDescription || live.description === item.generatedDescription);
          const tagsMatch =
            live &&
            (!item.generatedTags ||
              item.generatedTags.length === 0 ||
              (live.tags &&
                item.generatedTags.every((t: string) => live.tags.includes(t))));

          if (titleMatch && descMatch && tagsMatch) {
            item.status = 'completed';
            item.processedAt = new Date();
            successful++;
            await this.videoModel.findByIdAndUpdate(item.videoId, {
              $set: {
                seoStatus: 'approved',
                optimizationSource: batch.source,
                lastBatchId: batch._id,
              },
            });
            this.logger.log(`Reconciliation: Video ${item.youtubeId} verified pushed to YouTube`);
          } else {
            // Mark failed with clear reconciliation error so user can retry cleanly
            item.status = 'failed';
            item.error = 'Interrupted during push phase due to server restart. Ready for retry.';
            failed++;
          }
        } catch (err: any) {
          item.status = 'failed';
          item.error = `Reconciliation error: ${err.message}`;
          failed++;
        }
      } else if (item.status === 'generating' || item.status === 'queued') {
        item.status = 'failed';
        item.error = 'Server restarted before generation finished.';
        failed++;
      } else if (item.status === 'failed') {
        failed++;
      }
    }

    batch.successfulItems = successful;
    batch.failedItems = failed;
    batch.skippedItems = skipped;
    batch.status = successful === batch.totalItems && batch.totalItems > 0
      ? 'completed'
      : successful > 0
      ? 'partial'
      : 'failed';
    batch.completedAt = new Date();
    await batch.save();

    await this.channelModel.findByIdAndUpdate(channel._id, {
      $set: { isBatchRunning: false, activeBatchId: null },
    });

    this.gateway.emitBatchCompleted(channel._id.toString(), {
      batchId: batch._id.toString(),
      status: batch.status,
      successful,
      failed,
      skipped,
    });
  }

  /**
   * Get KPI statistics, quota meter, and next run calculation
   */
  async getStats(channelId: string) {
    const cId = new Types.ObjectId(channelId);

    const [totalVideos, optimizedVideos, pendingVideos, notStartedVideos, channel, quotaInfo, activeBatch] =
      await Promise.all([
        this.videoModel.countDocuments({ channelId: cId, deletedFromYoutube: { $ne: true } }),
        this.videoModel.countDocuments({ channelId: cId, seoStatus: { $in: ['approved', 'optimized'] }, deletedFromYoutube: { $ne: true } }),
        this.videoModel.countDocuments({ channelId: cId, seoStatus: 'pending', deletedFromYoutube: { $ne: true } }),
        this.videoModel.countDocuments({ channelId: cId, seoStatus: { $in: ['not_started', null] }, deletedFromYoutube: { $ne: true } }),
        this.channelModel.findById(cId).lean(),
        this.quotaService.getDailyUsage(channelId).catch(() => ({ used: 0, limit: 10000 })),
        this.getActiveBatch(channelId),
      ]);

    const remainingUnoptimized = notStartedVideos;
    const dailyBatchSize = 20;
    const estimatedDaysRemaining = remainingUnoptimized > 0 ? Math.ceil(remainingUnoptimized / dailyBatchSize) : 0;

    // Calculate next run time (7:30 AM America/New_York)
    const nextRunTime = this.calculateNextNyRunTime(7, 30);

    return {
      totalVideos,
      optimizedVideos,
      pendingVideos,
      remainingUnoptimized,
      dailyBatchSize,
      estimatedDaysRemaining,
      nextRunTime,
      quotaUsed: quotaInfo.used,
      quotaLimit: quotaInfo.limit,
      quotaSafetyCap: YOUTUBE_HARD_CAP_CEILING,
      quotaCostPerBatch: dailyBatchSize * YOUTUBE_QUOTA_COST_PER_VIDEO,
      isBatchRunning: Boolean(channel?.isBatchRunning),
      activeBatch,
      settings: channel?.seoSettings || {},
    };
  }

  /**
   * Helper to calculate the next 7:30 AM New York time (DST-aware)
   */
  private calculateNextNyRunTime(targetHour: number, targetMinute: number): Date {
    const now = new Date();
    // Get current time in NY
    const nyFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    });
    const parts = nyFormatter.formatToParts(now);
    const nyYear = parseInt(parts.find(p => p.type === 'year')?.value || '2026', 10);
    const nyMonth = parseInt(parts.find(p => p.type === 'month')?.value || '1', 10);
    const nyDay = parseInt(parts.find(p => p.type === 'day')?.value || '1', 10);
    const nyHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    const nyMin = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);

    const isTodayPast = nyHour > targetHour || (nyHour === targetHour && nyMin >= targetMinute);
    const baseDate = new Date(Date.UTC(nyYear, nyMonth - 1, isTodayPast ? nyDay + 1 : nyDay));
    const yyyy = baseDate.getUTCFullYear();
    const mm = String(baseDate.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(baseDate.getUTCDate()).padStart(2, '0');
    const hh = String(targetHour).padStart(2, '0');
    const min = String(targetMinute).padStart(2, '0');

    // Dynamically compute exact DST offset
    const guessDate = new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:00.000Z`);
    const nyGuessParts = nyFormatter.formatToParts(guessDate);
    const nyGuessHour = parseInt(nyGuessParts.find(p => p.type === 'hour')?.value || '0', 10);
    const hourDiff = targetHour - nyGuessHour;
    return new Date(guessDate.getTime() + hourDiff * 3600 * 1000);
  }

  /**
   * Query historical batches for a channel
   */
  async getBatches(channelId: string, query: BatchQueryDto) {
    const { page = 1, limit = 10 } = query;
    const filter = { channelId: new Types.ObjectId(channelId) };

    const [items, total] = await Promise.all([
      this.batchModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.batchModel.countDocuments(filter),
    ]);

    return {
      items: leanDocs(items),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Query the currently active batch (if any)
   */
  async getActiveBatch(channelId: string) {
    const batch = await this.batchModel
      .findOne({
        channelId: new Types.ObjectId(channelId),
        status: { $in: ['checking_quota', 'generating', 'staging', 'pushing'] },
      })
      .sort({ createdAt: -1 })
      .lean();

    return batch ? leanDoc(batch) : null;
  }

  /**
   * Primary Batch Execution Coordinator (Layer-by-Layer Staging & Paced Push)
   */
  async runBatch(
    channelId: string,
    batchSize: number = 20,
    source: string = 'manual_ui_batch',
    customInstructions?: string,
  ) {
    const cId = new Types.ObjectId(channelId);

    // 1. Atomic CAS Concurrency Lock on Channel
    const acquiredChannel = await this.channelModel.findOneAndUpdate(
      { _id: cId, isBatchRunning: { $ne: true } },
      {
        $set: {
          isBatchRunning: true,
          batchStartedAt: new Date(),
          lastBatchHeartbeatAt: new Date(),
        },
      },
      { new: true },
    );

    if (!acquiredChannel) {
      throw new ConflictException('A batch is already running for this channel. Please wait until it completes.');
    }

    const releaseLock = async () => {
      await this.channelModel.findByIdAndUpdate(cId, {
        $set: { isBatchRunning: false, activeBatchId: null },
      });
    };

    // 2. Verified YouTube API Quota Pre-Check
    const estimatedQuota = batchSize * YOUTUBE_QUOTA_COST_PER_VIDEO;
    try {
      const { used } = await this.quotaService.getDailyUsage(channelId);
      if (used + estimatedQuota > YOUTUBE_HARD_CAP_CEILING) {
        await releaseLock();
        this.logger.warn(`Batch rejected: quota would exceed 90% ceiling (${used} + ${estimatedQuota} > ${YOUTUBE_HARD_CAP_CEILING})`);
        throw new BadRequestException(
          `Daily YouTube API quota ceiling reached (${used}/${YOUTUBE_HARD_CAP_CEILING} units used). Running ${batchSize} videos would cost ~${estimatedQuota} units.`,
        );
      }
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      // If quota service has transient error, proceed with caution
    }

    // 3. Select Target Unoptimized Videos
    const targetVideos = await this.videoModel
      .find({
        channelId: cId,
        seoStatus: { $in: ['not_started', null] },
        deletedFromYoutube: { $ne: true },
      })
      .sort({ publishedAt: -1 })
      .limit(batchSize)
      .lean();

    if (targetVideos.length === 0) {
      await releaseLock();
      return { message: 'No unoptimized videos available in queue.', totalItems: 0, queued: false };
    }

    // 4. Create AutomationBatch Document in DB
    const batchDoc = await this.batchModel.create({
      channelId: cId,
      type: 'video_seo',
      source,
      status: 'generating',
      totalItems: targetVideos.length,
      successfulItems: 0,
      failedItems: 0,
      skippedItems: 0,
      quotaUnitsUsed: 0,
      startedAt: new Date(),
      lastHeartbeatAt: new Date(),
      items: targetVideos.map((v) => ({
        videoId: v._id,
        youtubeId: v.youtubeId,
        originalTitle: v.title,
        originalDescription: v.description || '',
        originalTags: v.tags || [],
        status: 'queued',
        batchLockTimestamp: new Date(),
      })),
    });

    await this.channelModel.findByIdAndUpdate(cId, {
      $set: { activeBatchId: batchDoc._id },
    });

    // Reset cancel token
    this.activeBatchCancelTokens.set(batchDoc._id.toString(), false);

    // Emit live event: batch started
    this.gateway.emitBatchStarted(channelId, {
      batchId: batchDoc._id.toString(),
      source,
      totalItems: targetVideos.length,
      startedAt: batchDoc.startedAt,
    });

    // 5. Execute processing asynchronously in background to not block HTTP request
    this.processBatchPipeline(batchDoc._id.toString(), channelId, customInstructions).catch((err) => {
      this.logger.error(`Fatal error in batch pipeline ${batchDoc._id}: ${err.message}`, err.stack);
    });

    return {
      message: `Batch started with ${targetVideos.length} videos.`,
      batchId: batchDoc._id.toString(),
      totalItems: targetVideos.length,
      queued: true,
    };
  }

  /**
   * Internal Background Batch Pipeline Execution
   */
  private async processBatchPipeline(batchId: string, channelId: string, customInstructions?: string) {
    const batch = await this.batchModel.findById(batchId);
    if (!batch) return;

    const channel = await this.channelModel.findById(channelId).lean();
    const user = channel?.userId ? await this.userModel.findById(channel.userId).lean() : null;

    const updateHeartbeat = async () => {
      const now = new Date();
      await Promise.all([
        this.batchModel.findByIdAndUpdate(batchId, { $set: { lastHeartbeatAt: now } }),
        this.channelModel.findByIdAndUpdate(channelId, { $set: { lastBatchHeartbeatAt: now } }),
      ]);
    };

    // =========================================================================
    // LAYER 1: AI SEO GENERATION & DB STAGING (ALL 30 FIRST)
    // =========================================================================
    this.logger.log(`[Batch ${batchId}] Layer 1: Starting AI generation for ${batch.items.length} videos...`);

    for (let i = 0; i < batch.items.length; i++) {
      if (this.activeBatchCancelTokens.get(batchId)) {
        this.logger.warn(`[Batch ${batchId}] Cancel token detected. Aborting generation.`);
        batch.status = 'cancelled';
        await batch.save();
        await this.channelModel.findByIdAndUpdate(channelId, { $set: { isBatchRunning: false, activeBatchId: null } });
        return;
      }

      const item = batch.items[i];

      // Fast-track already staged items (e.g. child retry batches)
      if (item.status === 'staged' && item.generatedTitle) {
        this.logger.log(`[Batch ${batchId}] Item #${i + 1} (${item.videoId}) is already staged in DB. Fast-tracking to push.`);
        this.gateway.emitItemProgress(channelId, {
          batchId,
          itemIndex: i,
          videoId: item.videoId.toString(),
          stage: 'staged',
          status: 'staged',
          generatedTitle: item.generatedTitle,
        });
        continue;
      }

      item.status = 'generating';
      await batch.save();

      this.gateway.emitItemProgress(channelId, {
        batchId,
        itemIndex: i,
        videoId: item.videoId.toString(),
        stage: 'generating',
        status: 'generating',
      });

      const startTime = Date.now();
      try {
        // Generate SEO with OpenAI Engine
        const suggestion = await this.seoService.generateSeo({
          videoId: item.videoId.toString(),
          customInstructions,
        });

        // Stage in DB
        item.generatedTitle = suggestion.title;
        item.generatedDescription = suggestion.description;
        item.generatedTags = suggestion.tags || [];
        item.generatedHashtags = suggestion.hashtags || [];
        item.status = 'staged';
        item.durationMs = Date.now() - startTime;

        // Tag suggestion with batch & source
        await this.seoSuggestionModel.findByIdAndUpdate(suggestion._id, {
          $set: { source: batch.source, batchId: batch._id },
        });

        this.gateway.emitItemProgress(channelId, {
          batchId,
          itemIndex: i,
          videoId: item.videoId.toString(),
          stage: 'staged',
          status: 'staged',
          generatedTitle: item.generatedTitle,
        });
      } catch (genError: any) {
        const isQuotaExceeded =
          genError instanceof QuotaExceededException ||
          genError?.name === 'QuotaExceededException' ||
          genError?.reason === 'quotaExceeded' ||
          genError?.response?.data?.error?.errors?.[0]?.reason === 'quotaExceeded';

        if (isQuotaExceeded) {
          this.logger.error(`[Batch ${batchId}] YouTube quota exhausted during generation. Halting batch immediately: ${genError.message}`);
          batch.status = 'failed';
          item.status = 'failed';
          item.error = `Quota exhausted: ${genError.message}`;
          batch.failedItems++;
          await batch.save();
          await this.channelModel.findByIdAndUpdate(channelId, { $set: { isBatchRunning: false, activeBatchId: null } });
          this.gateway.emitBatchCompleted(channelId, {
            batchId,
            status: 'failed',
            error: 'Daily YouTube quota exhausted',
          });
          throw genError;
        }

        this.logger.error(`[Batch ${batchId}] AI Generation failed for video ${item.videoId}: ${genError.message}`);
        item.status = 'failed';
        item.error = `AI Generation error: ${genError.message}`;
        item.durationMs = Date.now() - startTime;
        batch.failedItems++;

        this.gateway.emitItemProgress(channelId, {
          batchId,
          itemIndex: i,
          videoId: item.videoId.toString(),
          stage: 'generating',
          status: 'failed',
          error: item.error,
        });
      }

      await batch.save();
      await updateHeartbeat();

      // Pacing delay (400ms) to throttle requests on Hostinger VPS IP
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    // =========================================================================
    // LAYER 2: STAGGERED YOUTUBE PUSH WITH 5-SECOND BURST SMOOTHING & CONFLICT GUARD
    // =========================================================================
    batch.status = 'pushing';
    await batch.save();
    this.logger.log(`[Batch ${batchId}] Layer 2: Starting 5s-paced YouTube push...`);

    let accessToken: string | null = null;
    if (user?._id) {
      try {
        accessToken = await this.youtubeService.getValidAccessToken(user._id.toString());
      } catch (err: any) {
        this.logger.error(`[Batch ${batchId}] Could not get YouTube access token: ${err.message}`);
      }
    }

    for (let i = 0; i < batch.items.length; i++) {
      if (this.activeBatchCancelTokens.get(batchId)) {
        this.logger.warn(`[Batch ${batchId}] Cancel token detected during push. Aborting.`);
        break;
      }

      const item = batch.items[i];
      if (item.status !== 'staged') {
        continue; // Skip failed generation items
      }

      // Check Invariant: Conflict Guard (Manual client edit overrides batch)
      const currentVideo = await this.videoModel.findById(item.videoId).lean();
      if (!currentVideo) {
        item.status = 'failed';
        item.error = 'Video no longer exists in DB';
        batch.failedItems++;
        await batch.save();
        continue;
      }

      if (
        currentVideo.lastManualModifiedAt &&
        new Date(currentVideo.lastManualModifiedAt).getTime() > new Date(item.batchLockTimestamp).getTime()
      ) {
        this.logger.warn(`[Batch ${batchId}] Conflict detected on video ${item.videoId} (manually modified at ${currentVideo.lastManualModifiedAt}). Skipping push.`);
        item.status = 'skipped_manual_override';
        item.error = 'Skipped: Client manually modified video metadata during active batch run.';
        batch.skippedItems++;
        await batch.save();

        this.gateway.emitItemProgress(channelId, {
          batchId,
          itemIndex: i,
          videoId: item.videoId.toString(),
          stage: 'pushing',
          status: 'skipped_manual_override',
          reason: item.error,
        });
        continue;
      }

      item.status = 'pushing';
      await batch.save();

      this.gateway.emitItemProgress(channelId, {
        batchId,
        itemIndex: i,
        videoId: item.videoId.toString(),
        stage: 'pushing',
        status: 'pushing',
      });

      if (!accessToken || !currentVideo.youtubeId) {
        item.status = 'failed';
        item.error = 'YouTube push failed: No valid OAuth access token or YouTube ID.';
        batch.failedItems++;
        await batch.save();
        continue;
      }

      // Push to YouTube with 4 Total Attempts (1 initial + 3 retries)
      const pushSuccess = await this.executeYoutubePushWithRetries(
        accessToken,
        currentVideo.youtubeId,
        item.generatedTitle!,
        item.generatedDescription || '',
        item.generatedTags || [],
      );

      if (pushSuccess.success) {
        // 1. Preserve Previous Version in SeoVersion collection (Append-only)
        const previousSeo = currentVideo.currentSeo || {
          title: currentVideo.title,
          description: currentVideo.description || '',
          tags: currentVideo.tags || [],
          hashtags: [],
        };

        await this.seoVersionModel.create({
          videoId: currentVideo._id,
          type: currentVideo.seoStatus === 'approved' ? 'ai_optimized' : 'original',
          approved: true,
          source: batch.source,
          batchId: batch._id,
          seo: previousSeo,
          note: `Auto-saved before batch #${batchId.slice(-6)} optimization`,
        });

        // 2. Update Video in DB
        const newSeo = {
          title: item.generatedTitle!,
          description: item.generatedDescription || '',
          tags: item.generatedTags || [],
          hashtags: item.generatedHashtags || [],
        };

        await this.videoModel.findByIdAndUpdate(item.videoId, {
          $set: {
            title: item.generatedTitle,
            description: item.generatedDescription,
            tags: item.generatedTags,
            youtubeTitle: item.generatedTitle,
            youtubeDescription: item.generatedDescription,
            youtubeTags: item.generatedTags,
            currentSeo: newSeo,
            suggestedSeo: null,
            seoStatus: 'approved',
            optimizationSource: batch.source,
            lastBatchId: batch._id,
          },
        });

        // 3. Mark Suggestion Approved
        await this.seoSuggestionModel.findOneAndUpdate(
          { videoId: item.videoId, status: 'pending' },
          { $set: { status: 'approved', source: batch.source, batchId: batch._id } },
        );

        // 4. Log Quota Units
        await this.quotaService.logCall({
          channelId,
          endpoint: 'videos.update',
          quotaCost: YOUTUBE_QUOTA_COST_PER_VIDEO,
          relatedId: item.videoId.toString(),
        });

        item.status = 'completed';
        item.processedAt = new Date();
        batch.successfulItems++;
        batch.quotaUnitsUsed += YOUTUBE_QUOTA_COST_PER_VIDEO;

        this.gateway.emitItemProgress(channelId, {
          batchId,
          itemIndex: i,
          videoId: item.videoId.toString(),
          stage: 'pushing',
          status: 'completed',
          title: item.generatedTitle,
        });
      } else {
        item.status = 'failed';
        item.error = pushSuccess.error;
        batch.failedItems++;

        await this.quotaService.logCall({
          channelId,
          endpoint: 'videos.update',
          quotaCost: YOUTUBE_QUOTA_COST_PER_VIDEO,
          relatedId: item.videoId.toString(),
          success: false,
          errorMessage: pushSuccess.error,
        }).catch(() => {});

        this.gateway.emitItemProgress(channelId, {
          batchId,
          itemIndex: i,
          videoId: item.videoId.toString(),
          stage: 'pushing',
          status: 'failed',
          error: item.error,
        });
      }

      await batch.save();
      await updateHeartbeat();

      // 5-Second Pacing Gap between pushes
      if (i < batch.items.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, PUSH_SAFETY_GAP_MS));
      }
    }

    // =========================================================================
    // LAYER 3: FINALIZATION & ATOMIC LOCK RELEASE
    // =========================================================================
    batch.completedAt = new Date();
    const wasCancelled = batch.status === 'cancelled' || Boolean(this.activeBatchCancelTokens.get(batchId));
    if (!wasCancelled) {
      batch.status =
        batch.successfulItems === batch.totalItems && batch.totalItems > 0
          ? 'completed'
          : batch.successfulItems > 0
          ? 'partial'
          : 'failed';
    } else {
      batch.status = 'cancelled';
    }

    await batch.save();

    // Release channel lock atomically
    await this.channelModel.findByIdAndUpdate(channelId, {
      $set: { isBatchRunning: false, activeBatchId: null },
    });

    this.activeBatchCancelTokens.delete(batchId);

    // Broadcast completion & updated stats
    this.gateway.emitBatchCompleted(channelId, {
      batchId,
      status: batch.status,
      totalItems: batch.totalItems,
      successfulItems: batch.successfulItems,
      failedItems: batch.failedItems,
      skippedItems: batch.skippedItems,
      completedAt: batch.completedAt,
    });

    const updatedStats = await this.getStats(channelId);
    this.gateway.emitStatsUpdated(channelId, updatedStats);

    this.logger.log(`[Batch ${batchId}] Completed with status: ${batch.status} (${batch.successfulItems}/${batch.totalItems} successful)`);
  }

  /**
   * Helper: Execute YouTube Push with 4 Total Attempts (1 Initial + 3 Retries)
   */
  private async executeYoutubePushWithRetries(
    accessToken: string,
    youtubeId: string,
    title: string,
    description: string,
    tags: string[],
  ): Promise<{ success: boolean; error?: string }> {
    let lastError = '';

    for (let attempt = 1; attempt <= MAX_PUSH_ATTEMPTS; attempt++) {
      try {
        await this.youtubeService.updateVideo(accessToken, youtubeId, title, description, tags);
        return { success: true };
      } catch (err: any) {
        lastError = err.message || 'YouTube update failed';
        this.logger.warn(`YouTube push attempt ${attempt}/${MAX_PUSH_ATTEMPTS} for ${youtubeId} failed: ${lastError}`);

        const isNonRetryable =
          err.status === 400 ||
          err.status === 401 ||
          err.status === 403 ||
          err.status === 404 ||
          lastError.includes('invalid_grant');

        if (isNonRetryable || attempt >= MAX_PUSH_ATTEMPTS) {
          break;
        }

        // Exponential backoff with jitter: 1.5s -> 3.0s -> 6.0s (+/- 300ms)
        const baseDelay = 1500 * Math.pow(2, attempt - 1);
        const jitter = Math.floor(Math.random() * 600) - 300;
        const delay = Math.min(Math.max(baseDelay + jitter, 1000), 10000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    return { success: false, error: lastError };
  }

  /**
   * Reconciles manual overrides from Video Details / SEO Suggestion approvals
   */
  async reconcileManualOverride(videoId: string | Types.ObjectId) {
    const vId = typeof videoId === 'string' && Types.ObjectId.isValid(videoId) ? new Types.ObjectId(videoId) : videoId;
    const batches = await this.batchModel.find({
      $or: [
        { 'items.videoId': vId },
        { 'items.videoId': videoId.toString() },
      ],
      'items.status': 'failed',
    });

    for (const batch of batches) {
      let updated = false;
      for (const item of batch.items) {
        const itemVid = item.videoId?.toString?.() || String(item.videoId);
        if (itemVid === videoId.toString() && item.status === 'failed') {
          item.status = 'skipped_manual_override';
          item.processedAt = new Date();
          item.error = 'Resolved via manual approval on video details page.';
          updated = true;
        }
      }

      if (updated) {
        const successful = batch.items.filter((i) => i.status === 'completed').length;
        const skipped = batch.items.filter((i) => i.status === 'skipped_manual_override').length;
        const failed = batch.items.filter((i) => i.status === 'failed').length;

        batch.successfulItems = successful;
        batch.skippedItems = skipped;
        batch.failedItems = failed;

        if (failed === 0 && (successful > 0 || skipped > 0)) {
          batch.status = 'completed';
        }

        await batch.save();

        const channelId = batch.channelId.toString();
        this.gateway.emitBatchCompleted(channelId, {
          batchId: batch._id.toString(),
          status: batch.status,
          totalItems: batch.totalItems,
          successfulItems: batch.successfulItems,
          failedItems: batch.failedItems,
          skippedItems: batch.skippedItems,
        });

        const updatedStats = await this.getStats(channelId);
        this.gateway.emitStatsUpdated(channelId, updatedStats);
      }
    }
  }

  /**
   * Immutable Child Batch Retry Pattern
   */
  async retryFailedItems(batchId: string) {
    const parentBatch = await this.batchModel.findById(batchId);
    if (!parentBatch) throw new NotFoundException(`Batch ${batchId} not found`);

    if (parentBatch.isRetried) {
      throw new BadRequestException(
        `Batch has already been retried in child batch #${parentBatch.retriedByBatchId ? parentBatch.retriedByBatchId.toString().slice(-6).toUpperCase() : ''}`,
      );
    }

    // Reconcile any items that might have already been approved manually in DB
    const failedCandidates = parentBatch.items.filter((i) => i.status === 'failed' || i.status === 'staged');
    const actionableItems = [];

    for (const item of failedCandidates) {
      const vid = await this.videoModel.findById(item.videoId).lean();
      if (vid && (vid.seoStatus === 'approved' || vid.seoStatus === 'optimized')) {
        item.status = 'skipped_manual_override';
        item.processedAt = new Date();
        item.error = 'Resolved via manual approval on video details page.';
      } else {
        actionableItems.push(item);
      }
    }

    // Update parent batch item counts in case some were resolved manually
    parentBatch.successfulItems = parentBatch.items.filter((i) => i.status === 'completed').length;
    parentBatch.skippedItems = parentBatch.items.filter((i) => i.status === 'skipped_manual_override').length;
    parentBatch.failedItems = parentBatch.items.filter((i) => i.status === 'failed').length;

    if (actionableItems.length === 0) {
      if (parentBatch.failedItems === 0) {
        parentBatch.status = 'completed';
      }
      await parentBatch.save();
      throw new BadRequestException('All failed items in this batch have already been resolved.');
    }

    const channelId = parentBatch.channelId.toString();

    // Quota pre-check for child retry batch
    const estimatedQuota = actionableItems.length * YOUTUBE_QUOTA_COST_PER_VIDEO;
    try {
      const { used } = await this.quotaService.getDailyUsage(channelId);
      if (used + estimatedQuota > YOUTUBE_HARD_CAP_CEILING) {
        throw new BadRequestException(
          `Daily YouTube API quota limit reached (${used}/${YOUTUBE_HARD_CAP_CEILING} units used). Retrying ${actionableItems.length} videos would cost ~${estimatedQuota} units.`,
        );
      }
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
    }

    // Acquire channel lock
    const acquiredChannel = await this.channelModel.findOneAndUpdate(
      { _id: parentBatch.channelId, isBatchRunning: { $ne: true } },
      { $set: { isBatchRunning: true, batchStartedAt: new Date(), lastBatchHeartbeatAt: new Date() } },
      { new: true },
    );

    if (!acquiredChannel) {
      throw new ConflictException('Another batch is currently running for this channel.');
    }

    // Create child batch with parentBatchId
    const childBatch = await this.batchModel.create({
      channelId: parentBatch.channelId,
      type: parentBatch.type,
      source: 'manual_ui_batch',
      parentBatchId: parentBatch._id,
      status: 'generating',
      totalItems: actionableItems.length,
      successfulItems: 0,
      failedItems: 0,
      skippedItems: 0,
      quotaUnitsUsed: 0,
      startedAt: new Date(),
      lastHeartbeatAt: new Date(),
      items: actionableItems.map((f) => ({
        videoId: f.videoId,
        youtubeId: f.youtubeId,
        originalTitle: f.originalTitle,
        originalDescription: f.originalDescription,
        originalTags: f.originalTags,
        generatedTitle: f.generatedTitle,
        generatedDescription: f.generatedDescription,
        generatedTags: f.generatedTags,
        status: f.generatedTitle ? 'staged' : 'queued',
        batchLockTimestamp: new Date(),
      })),
    });

    // Mark parent batch as retried so UI disables retry and links to child
    parentBatch.isRetried = true;
    parentBatch.retriedByBatchId = childBatch._id;
    await parentBatch.save();

    await this.channelModel.findByIdAndUpdate(parentBatch.channelId, {
      $set: { activeBatchId: childBatch._id },
    });

    this.activeBatchCancelTokens.set(childBatch._id.toString(), false);

    this.gateway.emitBatchStarted(channelId, {
      batchId: childBatch._id.toString(),
      parentBatchId: parentBatch._id.toString(),
      totalItems: actionableItems.length,
      startedAt: childBatch.startedAt,
    });

    this.processBatchPipeline(childBatch._id.toString(), channelId).catch((err) => {
      this.logger.error(`Error in retry batch pipeline ${childBatch._id}: ${err.message}`);
    });

    return {
      message: `Retry batch created with ${actionableItems.length} items.`,
      batchId: childBatch._id.toString(),
      parentBatchId: parentBatch._id.toString(),
    };
  }

  /**
   * Cancel an in-flight batch safely
   */
  async cancelBatch(batchId: string) {
    const batch = await this.batchModel.findById(batchId);
    if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);

    this.activeBatchCancelTokens.set(batchId, true);
    batch.status = 'cancelled';
    batch.completedAt = new Date();
    await batch.save();

    await this.channelModel.findByIdAndUpdate(batch.channelId, {
      $set: { isBatchRunning: false, activeBatchId: null },
    });

    this.gateway.emitBatchCompleted(batch.channelId.toString(), {
      batchId,
      status: 'cancelled',
      totalItems: batch.totalItems,
      successfulItems: batch.successfulItems,
      failedItems: batch.failedItems,
    });

    const updatedStats = await this.getStats(batch.channelId.toString());
    this.gateway.emitStatsUpdated(batch.channelId.toString(), updatedStats);

    return { message: 'Batch cancelled successfully.', batchId };
  }
}
