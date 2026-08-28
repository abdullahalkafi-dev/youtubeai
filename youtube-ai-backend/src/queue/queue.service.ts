import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Channel, ChannelDocument } from '../mongo/schemas/channel.schema';
import { QueueItem, QueueItemDocument } from '../mongo/schemas/queue-item.schema';
import { SeoService } from '../seo/seo.service';
import { QuotaService } from '../quota/quota.service';
import { DEFAULT_DAILY_BATCH_SIZE } from '../automation/automation.constants';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectModel(Channel.name) private readonly channelModel: Model<ChannelDocument>,
    @InjectModel(QueueItem.name) private readonly queueItemModel: Model<QueueItemDocument>,
    private readonly seoService: SeoService,
    private readonly quotaService: QuotaService,
  ) {}

  async addToQueue(channelId: string, videoId: string, videoTitle: string) {
    const channel = await this.channelModel.findById(channelId).lean();
    const settings: any = channel?.seoSettings || {};
    const dailyCap = settings.dailyUpdateCap || DEFAULT_DAILY_BATCH_SIZE;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayCount = await this.queueItemModel.countDocuments({ channelId, queuedAt: { $gte: today } });

    if (todayCount >= dailyCap) {
      this.logger.warn(`Daily cap reached for channel ${channelId}: ${todayCount}/${dailyCap}`);
      return { message: 'Daily cap reached. Queue paused.', queued: false };
    }

    const item = await this.queueItemModel.create({ channelId, videoId, videoTitle, status: 'queued' });
    this.logger.log(`Added video ${videoId} to queue`);
    return { item, queued: true };
  }

  async findAll(channelId: string) {
    const items = await this.queueItemModel.find({ channelId: new Types.ObjectId(channelId) }).sort({ queuedAt: -1 }).lean();
    return items.map((item: any) => {
      const { _id, __v, ...rest } = item;
      return { id: _id.toString(), ...rest };
    });
  }

  async removeFromQueue(id: string) {
    const item = await this.queueItemModel.findById(id);
    if (!item) return null;
    return this.queueItemModel.findByIdAndDelete(id).lean();
  }

  async toggleQueue(channelId: string) {
    const channel = await this.channelModel.findById(channelId).lean();
    const settings: any = channel?.seoSettings || {};
    const newActive = settings.autoPauseAtLimit !== true;
    await this.channelModel.findByIdAndUpdate(channelId, { $set: { 'seoSettings.autoPauseAtLimit': newActive } });
    return { isActive: !newActive };
  }

  async getStats(channelId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [dailyUsed, queued, processing, failed] = await Promise.all([
      this.queueItemModel.countDocuments({ channelId, queuedAt: { $gte: today } }),
      this.queueItemModel.countDocuments({ channelId, status: 'queued' }),
      this.queueItemModel.countDocuments({ channelId, status: 'processing' }),
      this.queueItemModel.countDocuments({ channelId, status: 'failed' }),
    ]);

    const channel = await this.channelModel.findById(channelId).lean();
    const settings: any = channel?.seoSettings || {};

    return {
      dailyUsed,
      dailyCap: settings.dailyUpdateCap || DEFAULT_DAILY_BATCH_SIZE,
      queued,
      processing,
      failed,
      cronInterval: settings.cronInterval || 5,
      isActive: settings.autoPauseAtLimit !== false,
    };
  }
}

