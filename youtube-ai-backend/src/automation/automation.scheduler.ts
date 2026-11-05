import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Channel, ChannelDocument } from '../mongo/schemas/channel.schema';
import { Video, VideoDocument } from '../mongo/schemas/video.schema';
import { AutomationService } from './automation.service';
import { CommentsService } from '../comments/comments.service';
import { QuotaService } from '../quota/quota.service';
import { isOpenAiCreditsError, isOpenAiCreditsExhausted } from '../common/errors/openai-credits';
import {
  DEFAULT_DAILY_BATCH_SIZE,
  DEFAULT_COMMENT_DAILY_CAP,
  COMMENT_OTHER_LANE_DAILY_CAP,
  YOUTUBE_HARD_CAP_CEILING,
} from './automation.constants';
import { AutoReplyPolicyService } from '../videos/auto-reply-policy.service';
import { nextInLane, otherLaneRemaining, splitLanes } from './comment-lanes';

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
    private readonly autoReplyPolicy: AutoReplyPolicyService,
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
   * Autonomous comment auto-reply cron (every 15 minutes — quota-safe pacing).
   * Each tick takes one step in each lane: the 3 newest long videos (every 45 min each) and
   * the other long videos + Shorts (about every 4 h each). See comment-lanes.ts.
   * Pauses for the rest of the PT day if Google reports Data API quota exceeded.
   */
  @Cron('*/15 * * * *')
  async handleAutoCommentRepliesCron() {
    if (this.isProcessingCommentCron) {
      this.logger.debug('Comment auto-reply cron tick skipped — previous execution still in progress.');
      return;
    }

    if (this.quotaService.isDataApiExhausted()) {
      this.logger.warn('Comment auto-reply cron skipped — YouTube Data API quota exhausted for today.');
      return;
    }

    if (isOpenAiCreditsExhausted()) {
      this.logger.warn('Comment auto-reply cron skipped — OpenAI credits exhausted. Resumes automatically once credits are added.');
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
          this.quotaService.markDataApiExhaustedToday('hard-cap');
          continue;
        }

        // 1b. Comments sub-budget (default 4500) — keep SEO/trends alive
        if (this.quotaService.isCommentsBudgetExhausted()) {
          this.logger.warn(`Channel ${channel.name}: comments daily budget exhausted. Skipping comment auto-reply.`);
          continue;
        }
        const commentsBudget = await this.quotaService.getCommentsDailyUsage(channelId);
        if (commentsBudget.used >= commentsBudget.limit) {
          this.logger.warn(
            `Channel ${channel.name} reached comments budget (${commentsBudget.used}/${commentsBudget.limit}). Skipping comment auto-reply.`,
          );
          this.quotaService.markCommentsBudgetExhaustedToday('hard-cap');
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

        // 3. The 3 newest long videos are always on (turns on a new upload that the sync did not add).
        try {
          await this.autoReplyPolicy.ensureNewestLongEnabled(channel._id);
        } catch (err: any) {
          this.logger.warn(`Could not check the newest long videos for ${channel.name}: ${err.message}`);
        }

        // 4. Two round robins, each takes one step this tick (see comment-lanes.ts):
        //    lane A = 3 newest long videos (each every 45 min), lane B = other long videos + Shorts (each ~every 4 h).
        const activeVideos = await this.videoModel
          .find({
            channelId: channel._id,
            autoReplyEnabled: true,
            deletedFromYoutube: { $ne: true },
          })
          .select('_id title youtubeId publishedAt durationSeconds autoReplyLastRanAt')
          .lean();
        if (!activeVideos.length) continue;
        const lanes = splitLanes(activeVideos);

        let stop = false;
        for (const lane of ['top', 'other'] as const) {
          const video = nextInLane(lanes[lane]);
          if (!video) continue;
          // Re-read today's count: lane A may just have posted replies.
          const stats = lane === 'top' ? commentStats : await this.automationService.getCommentStats(channelId);
          const remaining =
            lane === 'top'
              ? stats.remainingToday
              : otherLaneRemaining(stats.todayAutoRepliesCount, DEFAULT_COMMENT_DAILY_CAP, COMMENT_OTHER_LANE_DAILY_CAP);
          if (remaining <= 0) {
            if (lane === 'other') {
              this.logger.log(
                `[Comment Auto-Reply] Lane B (other videos + Shorts) reached its ${COMMENT_OTHER_LANE_DAILY_CAP}/day share; the rest of the day is kept for the 3 newest long videos.`,
              );
            }
            continue;
          }

          this.logger.log(
            `[Comment Auto-Reply] ${lane === 'top' ? 'Lane A (newest long)' : 'Lane B (other)'}: checking "${video.title}" (${video.youtubeId}) for channel ${channel.name}. Replies left: ${remaining}`,
          );
          await this.commentsService.processSingleVideoAutoReplies(video._id, channelId, remaining);

          if (this.quotaService.isDataApiExhausted() || this.quotaService.isCommentsBudgetExhausted()) {
            this.logger.warn('Stopping comment auto-reply for the rest of the tick — quota/comments budget exhausted.');
            stop = true;
            break;
          }
          if (isOpenAiCreditsExhausted()) {
            this.logger.warn('Stopping comment auto-reply for the rest of the tick — OpenAI credits exhausted.');
            stop = true;
            break;
          }
        }
        if (stop) break;
      }
    } catch (err: any) {
      if (isOpenAiCreditsError(err)) {
        // Never mistake "OpenAI quota" for the YouTube quota walls below.
        this.logger.warn('Comment auto-reply cron stopped — OpenAI credits exhausted.');
        return;
      }
      this.logger.error(`Error in handleAutoCommentRepliesCron: ${err.message}`, err.stack);
      if (/quota/i.test(String(err?.message || ''))) {
        if (err?.scope === 'comments_budget' || /comments daily budget/i.test(String(err?.message || ''))) {
          this.quotaService.markCommentsBudgetExhaustedToday('cron');
        } else {
          this.quotaService.markDataApiExhaustedToday('cron');
        }
      }
    } finally {
      this.isProcessingCommentCron = false;
    }
  }
}
