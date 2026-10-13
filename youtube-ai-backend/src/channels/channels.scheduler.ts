import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Channel, ChannelDocument } from '../mongo/schemas/channel.schema';
import { ChannelsService } from './channels.service';
import { QuotaService } from '../quota/quota.service';

@Injectable()
export class ChannelsScheduler {
  private readonly logger = new Logger(ChannelsScheduler.name);
  private readonly activeSyncs = new Set<string>();
  private isHourlySyncRunning = false;
  private isDailySyncRunning = false;

  constructor(
    @InjectModel(Channel.name)
    private readonly channelModel: Model<ChannelDocument>,
    private readonly channelsService: ChannelsService,
    private readonly quotaService: QuotaService,
  ) {}

  /**
   * Hourly Quick Sync: Runs every 1 hour at minute 0 (0 * * * *).
   * Fetches the latest 150 videos + CTR & performance metrics for all connected channels.
   * Auto-promotes genuine new uploads to comment auto-replies and refreshes Chat AI RAG metadata.
   */
  @Cron('0 * * * *')
  async handleHourlyQuickSync() {
    if (this.isHourlySyncRunning) {
      this.logger.debug('Hourly quick sync tick skipped — previous execution still running.');
      return;
    }

    if (this.quotaService.isDataApiExhausted()) {
      this.logger.warn('Hourly quick sync skipped — YouTube Data API quota exhausted today.');
      return;
    }

    this.isHourlySyncRunning = true;
    try {
      const channels = await this.channelModel
        .find({ youtubeChannelId: { $exists: true, $ne: null } })
        .lean();

      if (!channels.length) return;

      this.logger.log(`⏰ Starting Hourly Quick Sync (latest 150 videos + CTR) for ${channels.length} channel(s)...`);

      for (const channel of channels) {
        const channelId = channel._id.toString();
        const userId = channel.userId?.toString();
        if (!userId) continue;

        if (this.activeSyncs.has(channelId)) {
          this.logger.debug(`Channel ${channel.name} (${channelId}) is already syncing. Skipping hourly tick.`);
          continue;
        }

        if (this.quotaService.isDataApiExhausted()) {
          this.logger.warn('Stopping hourly sync early — YouTube Data API quota exhausted.');
          break;
        }

        this.activeSyncs.add(channelId);
        try {
          const startedAt = Date.now();
          const result = await this.channelsService.syncChannel(channelId, userId, {
            mode: 'quick',
            maxVideos: 150,
            syncPerformance: true,
          });
          const duration = Date.now() - startedAt;
          this.logger.log(
            `✅ Hourly quick sync completed for "${channel.name}": synced=${result.synced} (new=${result.new}, updated=${result.updated}) in ${duration}ms`,
          );
        } catch (err: any) {
          this.logger.error(`Hourly quick sync failed for channel "${channel.name}" (${channelId}): ${err?.message || err}`);
        } finally {
          this.activeSyncs.delete(channelId);
        }
      }
    } catch (err: any) {
      this.logger.error(`Error in handleHourlyQuickSync: ${err?.message || err}`, err.stack);
    } finally {
      this.isHourlySyncRunning = false;
    }
  }

  /**
   * Daily Full Deep Sync: Runs once every 24 hours at 4:00 AM NY time.
   * Paginates all videos (up to 3000 cap), reconciles deleted videos, and updates full analytics.
   */
  @Cron('0 4 * * *', { timeZone: 'America/New_York' })
  async handleDailyFullSync() {
    if (this.isDailySyncRunning) {
      this.logger.debug('Daily full sync tick skipped — previous execution still running.');
      return;
    }

    if (this.quotaService.isDataApiExhausted()) {
      this.logger.warn('Daily full sync skipped — YouTube Data API quota exhausted today.');
      return;
    }

    this.isDailySyncRunning = true;
    try {
      const channels = await this.channelModel
        .find({ youtubeChannelId: { $exists: true, $ne: null } })
        .lean();

      if (!channels.length) return;

      this.logger.log(`⏰ Starting Daily Full Deep Sync (all videos) for ${channels.length} channel(s)...`);

      for (const channel of channels) {
        const channelId = channel._id.toString();
        const userId = channel.userId?.toString();
        if (!userId) continue;

        if (this.activeSyncs.has(channelId)) {
          this.logger.debug(`Channel ${channel.name} (${channelId}) is busy. Skipping daily tick.`);
          continue;
        }

        if (this.quotaService.isDataApiExhausted()) {
          this.logger.warn('Stopping daily full sync early — quota exhausted.');
          break;
        }

        this.activeSyncs.add(channelId);
        try {
          const startedAt = Date.now();
          const result = await this.channelsService.syncChannel(channelId, userId, {
            mode: 'full',
            maxVideos: 3000,
            syncPerformance: true,
          });
          const duration = Date.now() - startedAt;
          this.logger.log(
            `✅ Daily full sync completed for "${channel.name}": synced=${result.synced}, deleted=${result.deleted} in ${duration}ms`,
          );
        } catch (err: any) {
          this.logger.error(`Daily full sync failed for channel "${channel.name}" (${channelId}): ${err?.message || err}`);
        } finally {
          this.activeSyncs.delete(channelId);
        }
      }
    } catch (err: any) {
      this.logger.error(`Error in handleDailyFullSync: ${err?.message || err}`, err.stack);
    } finally {
      this.isDailySyncRunning = false;
    }
  }
}
