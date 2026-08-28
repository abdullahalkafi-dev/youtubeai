import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Channel, ChannelDocument } from '../mongo/schemas/channel.schema';
import { AutomationService } from './automation.service';
import { DEFAULT_DAILY_BATCH_SIZE } from './automation.constants';

const POSTPONE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_POSTPONE_DURATION_MS = 30 * 60 * 1000; // Up to 30 minutes (7:30 AM -> 8:00 AM NY time)

@Injectable()
export class AutomationScheduler {
  private readonly logger = new Logger(AutomationScheduler.name);

  constructor(
    @InjectModel(Channel.name)
    private readonly channelModel: Model<ChannelDocument>,
    private readonly automationService: AutomationService,
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
}
