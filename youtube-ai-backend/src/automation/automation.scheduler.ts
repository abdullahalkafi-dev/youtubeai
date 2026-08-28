import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Channel, ChannelDocument } from '../mongo/schemas/channel.schema';
import { Video, VideoDocument } from '../mongo/schemas/video.schema';
import { AutomationService } from './automation.service';
import { CommentsService } from '../comments/comments.service';
import { QuotaService } from '../quota/quota.service';
import {
  DEFAULT_DAILY_BATCH_SIZE,
  DEFAULT_COMMENT_DAILY_CAP,
  YOUTUBE_HARD_CAP_CEILING,
} from './automation.constants';

const POSTPONE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_POSTPONE_DURATION_MS = 30 * 60 * 1000; // Up to 30 minutes (7:30 AM -> 8:00 AM NY time)

@Injectable()
export class AutomationScheduler {
  private readonly logger = new Logger(AutomationScheduler.name);
  private isProcessingCommentCron = false;

  constructor(
    @InjectModel(Channel.name)
    private readonly channelModel: Model<ChannelDocument>,
    @InjectModel(Video.name)
    private readonly videoModel: Model<VideoDocument>,
    private readonly automationService: AutomationService,
    private readonly commentsService: CommentsService,
    private readonly quotaService: QuotaService,
  ) {}

  /**
   * Daily scheduled automation cron at 7:30 AM New York time (DST-aware)
   */
  @Cron('30 7 * * *', { timeZone: 'America/New_York' })
  async handleDailyMorningAutomation() {
    this.logger.log('⏰ Triggering Daily Morning Video SEO Automation (7:30 AM America/New_York)...');

    const channels = await this.channelModel.find({
      $or: [
        { 'seoSettings.autoPauseAtLimit': { $ne: false } },
        { 'seoSettings.autoPauseAtLimit': { $exists: false } },
      ],
    }).lean();

    this.logger.log(`Found ${channels.length} channels eligible for daily automation batch.`);

    for (const channel of channels) {
      const channelId = channel._id.toString();
      const batchSize = channel.seoSettings?.dailyUpdateCap || DEFAULT_DAILY_BATCH_SIZE;

      this.dispatchWithAutoPostpone(channelId, channel.name, batchSize);
    }
  }

  /**
   * Dispatches a batch, or auto-postpones if a batch is currently active
   */
  private async dispatchWithAutoPostpone(
    channelId: string,
    channelName: string,
    batchSize: number,
  ) {
    try {
      this.logger.log(`Dispatching daily cron batch for channel ${channelName} (${channelId}) with batch size ${batchSize}`);
      await this.automationService.runBatch(channelId, batchSize, 'auto_cron_batch');
    } catch (err: any) {
      if (err?.message?.includes('already running') || err?.status === 409) {
        this.logger.warn(
          `Channel ${channelName} (${channelId}) is currently busy with an active batch. Entering Auto-Postpone queue (will retry every 5 minutes until 8:00 AM NY time)...`,
        );
        this.queuePostponedRetry(channelId, channelName, batchSize, Date.now());
      } else {
        this.logger.error(`Failed to dispatch daily cron batch for channel ${channelId}: ${err.message}`);
      }
    }
  }

  /**
   * Staggered retry queue for postponed morning batches
   */
  private queuePostponedRetry(
    channelId: string,
    channelName: string,
    batchSize: number,
    startTime: number,
  ) {
    const timer = setTimeout(async () => {
      const elapsed = Date.now() - startTime;
      if (elapsed > MAX_POSTPONE_DURATION_MS) {
        this.logger.warn(`Auto-postpone window expired (30 mins) for channel ${channelName}. Stopping morning retries.`);
        return;
      }

      this.logger.log(`[Postpone Retry +${Math.round(elapsed / 60000)}m] Checking if channel ${channelName} is ready...`);

      try {
        await this.automationService.runBatch(channelId, batchSize, 'auto_cron_batch');
        this.logger.log(`✅ Postponed daily batch started successfully for channel ${channelName} at +${Math.round(elapsed / 60000)}m`);
      } catch (retryErr: any) {
        if (retryErr?.message?.includes('already running') || retryErr?.status === 409) {
          this.logger.log(`Channel ${channelName} still busy. Rescheduling next check in 5 minutes...`);
          this.queuePostponedRetry(channelId, channelName, batchSize, startTime);
        } else {
          this.logger.error(`Postponed batch failed for channel ${channelName}: ${retryErr.message}`);
        }
      }
    }, POSTPONE_CHECK_INTERVAL_MS);

    // Allow node process to unref if shutting down
    if (timer.unref) timer.unref();
  }

  /**
   * Autonomous 5-minute round-robin comment auto-reply cron.
   * If 1 video active: processes every 10 min (cooldown check).
   * If 2-5 videos active: rotates 1 video per 5-minute tick.
   */
  @Cron('*/5 * * * *')
  async handleAutoCommentRepliesCron() {
    if (this.isProcessingCommentCron) {
      this.logger.debug('Comment auto-reply cron tick skipped — previous execution still in progress.');
      return;
    }

    this.isProcessingCommentCron = true;
    try {
      const channels = await this.channelModel.find({}).lean();
      for (const channel of channels) {
        const channelId = channel._id.toString();

        // 1. Quota Check: Ensure YouTube quota is safe (< 9000)
        const dailyQuota = await this.quotaService.getDailyUsage(channelId);
        if (dailyQuota.used >= YOUTUBE_HARD_CAP_CEILING) {
          this.logger.warn(
            `Channel ${channel.name} reached quota ceiling (${dailyQuota.used}/${dailyQuota.limit} units). Skipping comment auto-reply.`,
          );
          continue;
        }

        // 2. Check today's comments quota count (PT midnight reset)
        const commentStats = await this.automationService.getCommentStats(channelId);
        if (commentStats.todayAutoRepliesCount >= DEFAULT_COMMENT_DAILY_CAP) {
          this.logger.log(
            `Channel ${channel.name} reached daily comment cap (${commentStats.todayAutoRepliesCount}/${DEFAULT_COMMENT_DAILY_CAP}). Pausing until midnight PT.`,
          );
          continue;
        }

        // 3. Find active auto-reply videos
        const activeVideos = await this.videoModel
          .find({
            channelId: channel._id,
            autoReplyEnabled: true,
            deletedFromYoutube: { $ne: true },
          })
          .sort({ autoReplyLastRanAt: 1, publishedAt: -1 });

        if (!activeVideos || activeVideos.length === 0) {
          continue;
        }

        const candidateVideo = activeVideos[0];

        // 4. If only 1 video active, enforce 9-10 min cooldown
        if (activeVideos.length === 1 && candidateVideo.autoReplyLastRanAt) {
          const elapsedMs = Date.now() - new Date(candidateVideo.autoReplyLastRanAt).getTime();
          if (elapsedMs < 9 * 60 * 1000) {
            continue;
          }
        }

        const remainingDailyCap = commentStats.remainingToday;
        if (remainingDailyCap <= 0) continue;

        this.logger.log(
          `[Comment Auto-Reply] Checking video "${candidateVideo.title}" (${candidateVideo.youtubeId}) for channel ${channel.name}. Remaining daily cap: ${remainingDailyCap}`,
        );

        await this.commentsService.processSingleVideoAutoReplies(
          candidateVideo._id,
          channelId,
          remainingDailyCap,
        );
      }
    } catch (err: any) {
      this.logger.error(`Error in handleAutoCommentRepliesCron: ${err.message}`, err.stack);
    } finally {
      this.isProcessingCommentCron = false;
    }
  }
}
