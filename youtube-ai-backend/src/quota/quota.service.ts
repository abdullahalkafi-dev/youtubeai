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
  }): Promise<void> {
    try {
      const model = this.channelModel.db.model('ApiQuotaLog') as any;
      await model.create({
        channelId: params.channelId,
        endpoint: params.endpoint,
        quotaCost: params.quotaCost,
        relatedId: params.relatedId,
        success: params.success ?? true,
        errorMessage: params.errorMessage,
      });
    } catch (error) {
      this.logger.error(`Failed to log quota call: ${error.message}`);
    }
  }

  async getDailyUsage(channelId: string) {
    const ptMidnight = this.getPTMidnight();
    const model = this.channelModel.db.model('ApiQuotaLog') as any;
    const cId = Types.ObjectId.isValid(channelId) ? new Types.ObjectId(channelId) : channelId;

    const breakdown = await model.aggregate([
      { $match: { $or: [{ channelId: cId }, { channelId }], calledAt: { $gte: ptMidnight } } },
      { $group: { _id: '$endpoint', total: { $sum: '$quotaCost' } } },
    ]);

    const used = breakdown.reduce((sum: number, b: any) => sum + (b.total || 0), 0);
    const breakdownMap: Record<string, number> = {};
    for (const b of breakdown) {
      breakdownMap[b._id] = b.total || 0;
    }

    return { used, limit: this.YOUTUBE_DAILY_LIMIT, breakdown: breakdownMap };
  }

  async getRecentLogs(channelId: string, limit = 50) {
    const model = this.channelModel.db.model('ApiQuotaLog') as any;
    const cId = Types.ObjectId.isValid(channelId) ? new Types.ObjectId(channelId) : channelId;
    return model.find({ $or: [{ channelId: cId }, { channelId }] }).sort({ calledAt: -1 }).limit(limit).lean();
  }

  private getPTMidnight(): Date {
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
