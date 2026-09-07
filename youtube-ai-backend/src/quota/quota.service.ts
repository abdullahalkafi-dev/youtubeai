import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Channel, ChannelDocument } from '../mongo/schemas/channel.schema';

export class QuotaExceededException extends Error {
  public readonly reason = 'quotaExceeded';

  constructor(used: number, limit: number, endpoint: string, cost: number) {
    super(`YouTube API quota exceeded: ${used}/${limit} used. Cannot call ${endpoint} (cost: ${cost}).`);
    this.name = 'QuotaExceededException';
  }
}

@Injectable()
export class QuotaService {
  private readonly logger = new Logger(QuotaService.name);
  private readonly YOUTUBE_DAILY_LIMIT = 10000;

  constructor(
    @InjectModel(Channel.name) private readonly channelModel: Model<ChannelDocument>,
  ) {}

  /**
   * Pre-check: verify quota is available before making a YouTube API call.
   * Throws QuotaExceededException if over limit.
   */
  async checkQuota(channelId: string, endpoint: string, cost: number): Promise<void> {
    const { used } = await this.getDailyUsage(channelId);
    if (used + cost > this.YOUTUBE_DAILY_LIMIT) {
      this.logger.warn(`Quota check failed: ${used}/${this.YOUTUBE_DAILY_LIMIT} used, ${endpoint} needs ${cost}`);
      throw new QuotaExceededException(used, this.YOUTUBE_DAILY_LIMIT, endpoint, cost);
    }
  }

  async logCall(params: {
    channelId: string;
    endpoint: string;
    quotaCost: number;
    relatedId?: string;
    success?: boolean;
    errorMessage?: string;
    apiType?: 'youtube_data' | 'youtube_analytics';
  }): Promise<void> {
    try {
      const model = this.channelModel.db.model('ApiQuotaLog') as any;
      let targetChannelId: any = undefined;
      let targetYoutubeChannelId: string | undefined = undefined;

      if (params.channelId) {
        if (Types.ObjectId.isValid(params.channelId)) {
          targetChannelId = new Types.ObjectId(params.channelId);
        } else {
          targetYoutubeChannelId = params.channelId;
          const ch = await this.channelModel
            .findOne({ youtubeChannelId: params.channelId })
            .select('_id')
            .lean();
          if (ch?._id) {
            targetChannelId = ch._id;
          }
        }
      }

      await model.create({
        channelId: targetChannelId,
        youtubeChannelId: targetYoutubeChannelId,
        endpoint: params.endpoint,
        quotaCost: params.quotaCost,
        relatedId: params.relatedId,
        success: params.success ?? true,
        errorMessage: params.errorMessage,
        apiType: params.apiType || 'youtube_data',
      });
    } catch (error) {
      this.logger.error(`Failed to log quota call: ${error.message}`);
    }
  }

  async logAnalyticsCall(params: {
    channelId: string;
    endpoint: string;
    relatedId?: string;
    success?: boolean;
    errorMessage?: string;
  }): Promise<void> {
    await this.logCall({
      channelId: params.channelId,
      endpoint: params.endpoint,
      quotaCost: 1,
      apiType: 'youtube_analytics',
      relatedId: params.relatedId,
      success: params.success ?? true,
      errorMessage: params.errorMessage,
    });
    this.logger.log(`[YouTube Analytics Quota] 1 query logged for ${params.relatedId || 'video'} on channel ${params.channelId} (apiType: youtube_analytics, 0 Data units)`);
  }

  /**
   * Pre-check: verify analytics quota is available before making a YouTube Analytics API call.
   */
  async checkAnalyticsQuota(channelId: string, endpoint: string): Promise<void> {
    const { used, limit } = await this.getAnalyticsDailyUsage(channelId);
    if (used + 1 > limit) {
      this.logger.warn(`Analytics quota check failed: ${used}/${limit} used, cannot call ${endpoint}`);
      throw new QuotaExceededException(used, limit, endpoint, 1);
    }
  }

  async getDailyUsage(channelId: string) {
    const ptMidnight = this.getPTMidnight();
    const model = this.channelModel.db.model('ApiQuotaLog') as any;
    const isObjId = Types.ObjectId.isValid(channelId);
    const cId = isObjId ? new Types.ObjectId(channelId) : null;
    const channelMatch = cId
      ? { $or: [{ channelId: cId }, { channelId }] }
      : { $or: [{ youtubeChannelId: channelId }, { channelId }] };

    // Strictly exclude 'youtube_analytics' so Analytics queries NEVER count against the 10,000 Data API daily limit!
    const breakdown = await model.aggregate([
      {
        $match: {
          ...channelMatch,
          calledAt: { $gte: ptMidnight },
          apiType: { $ne: 'youtube_analytics' },
        },
      },
      { $group: { _id: '$endpoint', total: { $sum: '$quotaCost' } } },
    ]);

    const used = breakdown.reduce((sum: number, b: any) => sum + (b.total || 0), 0);
    const breakdownMap: Record<string, number> = {};
    for (const b of breakdown) {
      breakdownMap[b._id] = b.total || 0;
    }

    return { used, limit: this.YOUTUBE_DAILY_LIMIT, breakdown: breakdownMap };
  }

  async getAnalyticsDailyUsage(channelId: string) {
    const ptMidnight = this.getPTMidnight();
    const model = this.channelModel.db.model('ApiQuotaLog') as any;
    const isObjId = Types.ObjectId.isValid(channelId);
    const cId = isObjId ? new Types.ObjectId(channelId) : null;
    const channelMatch = cId
      ? { $or: [{ channelId: cId }, { channelId }] }
      : { $or: [{ youtubeChannelId: channelId }, { channelId }] };

    const breakdown = await model.aggregate([
      {
        $match: {
          ...channelMatch,
          calledAt: { $gte: ptMidnight },
          apiType: 'youtube_analytics',
        },
      },
      { $group: { _id: '$endpoint', total: { $sum: { $ifNull: ['$quotaCost', 1] } } } },
    ]);

    const used = breakdown.reduce((sum: number, b: any) => sum + (b.total || 0), 0);
    const breakdownMap: Record<string, number> = {};
    for (const b of breakdown) {
      breakdownMap[b._id] = b.total || 0;
    }

    return { used, limit: 100000, breakdown: breakdownMap };
  }

  async getTodayEndpointCount(channelId: string, endpoint: string): Promise<number> {
    const ptMidnight = this.getPTMidnight();
    const model = this.channelModel.db.model('ApiQuotaLog') as any;
    const cId = Types.ObjectId.isValid(channelId) ? new Types.ObjectId(channelId) : channelId;
    return model.countDocuments({
      $or: [{ channelId: cId }, { channelId }],
      endpoint,
      calledAt: { $gte: ptMidnight },
      success: { $ne: false },
    });
  }

  async getRecentLogs(channelId: string, limit = 50) {
    const model = this.channelModel.db.model('ApiQuotaLog') as any;
    const cId = Types.ObjectId.isValid(channelId) ? new Types.ObjectId(channelId) : channelId;
    return model.find({ $or: [{ channelId: cId }, { channelId }] }).sort({ calledAt: -1 }).limit(limit).lean();
  }

  getPTMidnight(): Date {
    const now = new Date();
    // Get current calendar date in America/Los_Angeles (format YYYY-MM-DD)
    const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now);
    const [year, month, day] = dateStr.split('-').map(Number);

    // Calculate minute difference between UTC and PT at current instant
    const ptDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const diffMinutes = Math.round((utcDate.getTime() - ptDate.getTime()) / 60000);

    // Midnight PT in UTC is [YYYY-MM-DD 00:00:00 UTC] + diffMinutes
    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0) + diffMinutes * 60000);
  }
}
