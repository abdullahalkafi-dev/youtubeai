import { Process, Processor, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Video, VideoDocument } from '../mongo/schemas/video.schema';
import { Channel, ChannelDocument } from '../mongo/schemas/channel.schema';
import { SeoSuggestion, SeoSuggestionDocument } from '../mongo/schemas/seo-suggestion.schema';
import { QueueItem, QueueItemDocument } from '../mongo/schemas/queue-item.schema';
import { TrendingTopic, TrendingTopicDocument } from '../mongo/schemas/trending-topic.schema';
import { OpenAIService } from '../openai/openai.service';
import { buildChannelContext } from '../openai/prompts/context';

interface SeoJobData {
  queueItemId: string;
  videoId: string;
  channelId: string;
}

/**
 * Queue Processor — processes SEO generation for queued videos.
 * NOTE: Currently not dispatched by any code. The QueueService creates
 * queue items in MongoDB but never adds Bull jobs. This processor
 * is kept for future use when a cron-based queue processor is added.
 */
@Processor('seo-generation')
export class QueueProcessor {
  private readonly logger = new Logger(QueueProcessor.name);

  constructor(
    @InjectModel(Video.name) private readonly videoModel: Model<VideoDocument>,
    @InjectModel(Channel.name) private readonly channelModel: Model<ChannelDocument>,
    @InjectModel(SeoSuggestion.name) private readonly seoSuggestionModel: Model<SeoSuggestionDocument>,
    @InjectModel(QueueItem.name) private readonly queueItemModel: Model<QueueItemDocument>,
    @InjectModel(TrendingTopic.name) private readonly trendingTopicModel: Model<TrendingTopicDocument>,
    private readonly openaiService: OpenAIService,
  ) {}

  @Process('process-video')
  async handleSeoGeneration(job: Job<SeoJobData>) {
    const { queueItemId, videoId, channelId } = job.data;
    this.logger.log(`Processing SEO for video ${videoId}`);

    await this.queueItemModel.findByIdAndUpdate(queueItemId, { $set: { status: 'processing' } });

    try {
      const video = await this.videoModel.findById(videoId);
      if (!video) throw new Error(`Video ${videoId} not found`);
      if (video.deletedFromYoutube) throw new Error(`Video ${videoId} was deleted from YouTube`);

      const channel = await this.channelModel.findById(channelId);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const topVideos = await this.videoModel.find({
        channelId, publishedAt: { $gte: thirtyDaysAgo }, _id: { $ne: videoId },
      }).sort({ viewCount: -1 }).limit(8).select('title viewCount tags').lean();

      const channelStats = channel ? buildChannelContext({
        name: channel.name, handle: channel.handle, subscriberCount: channel.subscriberCount,
        totalVideos: channel.totalVideos, totalViews: channel.totalViews,
        totalWatchHours: channel.totalWatchHours, estimatedRevenue: channel.estimatedRevenue,
      }) : undefined;

      const trendingTopics = await this.trendingTopicModel.find({
        channelId, fetchedAt: { $gte: sevenDaysAgo },
      }).sort({ opportunityScore: -1 }).limit(5).select('title').lean();

      const result = await this.openaiService.generateSeo({
        videoTitle: video.title, videoDescription: video.description || undefined,
        showType: video.showType || undefined, channelStats,
        topPerformingVideos: topVideos.map(v => ({ title: v.title, views: v.viewCount, tags: v.tags })),
        trendingTopics: trendingTopics.map(t => t.title),
        videoPerformance: {
          views: video.viewCount,
          watchTimeHours: video.avgWatchTime ? video.avgWatchTime / 3600 : undefined,
          publishedDaysAgo: video.publishedAt ? Math.round((Date.now() - video.publishedAt.getTime()) / (1000 * 60 * 60 * 24)) : undefined,
        },
      });

      const { usage: _usage, ...seoData } = result;

      await this.seoSuggestionModel.create({
        videoId, channelId, title: result.title, description: result.description,
        tags: result.tags, hashtags: result.hashtags, showType: video.showType, tone: 'dark_direct',
      });

      await this.videoModel.findByIdAndUpdate(videoId, { $set: { seoStatus: 'pending', suggestedSeo: seoData } });
      await this.queueItemModel.findByIdAndUpdate(queueItemId, { $set: { status: 'done', processedAt: new Date() } });

      this.logger.log(`SEO completed for video ${videoId}`);
      return result;
    } catch (error) {
      await this.queueItemModel.findByIdAndUpdate(queueItemId, { $set: { status: 'failed', error: error.message } });
      throw error;
    }
  }

  @OnQueueFailed()
  onFailed(job: Job<SeoJobData>, error: Error) {
    this.logger.error(`Job ${job.id} failed: ${error.message}`);
  }

  @OnQueueCompleted()
  onCompleted(job: Job<SeoJobData>) {
    this.logger.log(`Job ${job.id} completed for video ${job.data.videoId}`);
  }
}
