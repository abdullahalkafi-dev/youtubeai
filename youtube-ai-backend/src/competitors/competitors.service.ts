import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Channel, ChannelDocument } from '../mongo/schemas/channel.schema';
import { Video, VideoDocument } from '../mongo/schemas/video.schema';
import {
  CompetitorChannel,
  CompetitorChannelDocument,
} from '../mongo/schemas/competitor-channel.schema';
import { YouTubeService } from '../youtube/youtube.service';
import { YouTubeSuggestionsService } from '../youtube/youtube-suggestions.service';
import { QuotaService } from '../quota/quota.service';

export interface CompetitorVideo {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  viewCount: number;
  publishedAt: string;
  channelTitle: string;
}

export interface ContentGap {
  topic: string;
  competitorChannel: string;
  competitorVideoTitle: string;
  competitorViews: number;
  searchDemand: number;
}

@Injectable()
export class CompetitorsService {
  private readonly logger = new Logger(CompetitorsService.name);

  constructor(
    @InjectModel(Channel.name)
    private readonly channelModel: Model<ChannelDocument>,
    @InjectModel(Video.name)
    private readonly videoModel: Model<VideoDocument>,
    @InjectModel(CompetitorChannel.name)
    private readonly competitorModel: Model<CompetitorChannelDocument>,
    private readonly youtubeService: YouTubeService,
    private readonly suggestionsService: YouTubeSuggestionsService,
    private readonly quotaService: QuotaService,
  ) {}

  /**
   * List saved competitors for a channel.
   */
  async listCompetitors(channelId: string): Promise<CompetitorChannel[]> {
    return this.competitorModel
      .find({ channelId: new Types.ObjectId(channelId) })
      .sort({ subscriberCount: -1 })
      .lean();
  }

  /**
   * Auto-detect competitors by searching for niche keywords on YouTube.
   * Finds channels in the same niche with similar subscriber counts.
   */
  async discoverCompetitors(channelId: string): Promise<CompetitorChannel[]> {
    const channel = await this.channelModel.findById(channelId).lean();
    if (!channel?.userId) throw new Error('Channel not found');

    // Pre-check quota: 4 search.list calls = 400 units
    await this.quotaService.checkQuota(channelId, 'search.list (discover)', 400);

    const accessToken = await this.youtubeService.getValidAccessToken(
      channel.userId.toString(),
    );

    // Search for niche channels
    const searchQueries = [
      'criminal psychology youtube channel',
      'prison stories channel',
      'courtroom analysis channel',
      'true crime psychology channel',
    ];

    const foundChannels = new Map<
      string,
      { title: string; channelId: string; thumbnailUrl: string }
    >();

    for (const query of searchQueries) {
      try {
        const results = await this.youtubeService.searchVideos({
          userId: channel.userId.toString(),
          query,
          publishedAfter: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
          maxResults: 5,
        });

        for (const result of results) {
          // Get channel info from video result
          if (result.channelTitle && result.channelId && !foundChannels.has(result.channelTitle)) {
            foundChannels.set(result.channelTitle, {
              title: result.channelTitle,
              channelId: result.channelId,
              thumbnailUrl: result.thumbnailUrl || '',
            });
          }
        }
      } catch (error) {
        this.logger.warn(`Search failed for "${query}": ${error.message}`);
      }
    }

    const existing = await this.competitorModel
      .find({ channelId: new Types.ObjectId(channelId) })
      .lean();
    const existingTitles = new Set(existing.map((c) => c.title.toLowerCase()));

    const newCompetitors: CompetitorChannel[] = [];
    for (const [title, data] of foundChannels) {
      if (!data.channelId) continue;
      if (existingTitles.has(title.toLowerCase())) continue;
      if (title.toLowerCase() === channel.name?.toLowerCase()) continue;

      try {
        const competitor = await this.competitorModel.create({
          channelId: new Types.ObjectId(channelId),
          youtubeChannelId: data.channelId,
          title,
          thumbnailUrl: data.thumbnailUrl,
          subscriberCount: 0,
          videoCount: 0,
          viewCount: 0,
          isAutoDetected: true,
          discoveredAt: new Date(),
          lastChecked: new Date(),
        });
        newCompetitors.push(competitor);
      } catch (error) {
        this.logger.warn(`Failed to save competitor "${title}": ${error.message}`);
      }
    }

    this.logger.log(
      `Discovered ${newCompetitors.length} new competitors for channel ${channelId}`,
    );

    await this.quotaService.logCall({
      channelId,
      endpoint: 'search.list (discoverCompetitors)',
      quotaCost: 400,
      success: true,
    });

    return newCompetitors;
  }

  /**
   * Manually add a competitor by YouTube channel ID.
   */
  async addCompetitor(
    channelId: string,
    youtubeChannelId: string,
  ): Promise<CompetitorChannel> {
    const channel = await this.channelModel.findById(channelId).lean();
    if (!channel?.userId) throw new Error('Channel not found');

    // Pre-check quota: 1 unit for channels.list
    await this.quotaService.checkQuota(channelId, 'channels.list (addCompetitor)', 1);

    const accessToken = await this.youtubeService.getValidAccessToken(
      channel.userId.toString(),
    );

    const ytChannel = await this.youtubeService.getChannelDetails(accessToken, youtubeChannelId);
    if (!ytChannel) throw new Error('YouTube channel not found');

    await this.quotaService.logCall({
      channelId,
      endpoint: 'channels.list',
      quotaCost: 1,
      relatedId: youtubeChannelId,
    });

    const competitor = await this.competitorModel.create({
      channelId: new Types.ObjectId(channelId),
      youtubeChannelId: ytChannel.channelId || youtubeChannelId,
      title: ytChannel.title,
      thumbnailUrl: ytChannel.thumbnailUrl,
      subscriberCount: ytChannel.subscriberCount,
      videoCount: ytChannel.videoCount,
      viewCount: ytChannel.viewCount,
      isAutoDetected: false,
      discoveredAt: new Date(),
      lastChecked: new Date(),
    });

    return competitor;
  }

  /**
   * Remove a competitor.
   */
  async removeCompetitor(
    channelId: string,
    competitorId: string,
  ): Promise<void> {
    await this.competitorModel.findOneAndDelete({
      _id: new Types.ObjectId(competitorId),
      channelId: new Types.ObjectId(channelId),
    });
  }

  /**
   * Get recent uploads from all competitors.
   */
  async getCompetitorUploads(
    channelId: string,
    days: number = 30,
  ): Promise<CompetitorVideo[]> {
    const competitors = await this.competitorModel
      .find({ channelId: new Types.ObjectId(channelId) })
      .lean();

    if (competitors.length === 0) return [];

    const channel = await this.channelModel.findById(channelId).lean();
    if (!channel?.userId) return [];

    const accessToken = await this.youtubeService.getValidAccessToken(
      channel.userId.toString(),
    );

    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const allVideos: CompetitorVideo[] = [];

    for (const competitor of competitors) {
      if (!competitor.youtubeChannelId) continue;
      const uploadsPlaylistId = competitor.youtubeChannelId.startsWith('UC')
        ? competitor.youtubeChannelId.replace(/^UC/, 'UU')
        : competitor.youtubeChannelId;

      try {
        const videos = await this.youtubeService.getPlaylistVideos(
          accessToken,
          uploadsPlaylistId,
          10,
        );

        await this.quotaService.logCall({
          channelId,
          endpoint: 'playlistItems.list (competitorUploads)',
          quotaCost: 1,
          relatedId: competitor.youtubeChannelId,
          success: true,
        });

        for (const v of videos) {
          if (v.publishedAt && new Date(v.publishedAt).getTime() < cutoffDate.getTime()) {
            continue; // In-memory cutoff date filter
          }
          allVideos.push({
            videoId: v.videoId,
            title: v.title,
            thumbnailUrl: v.thumbnailUrl,
            viewCount: 0,
            publishedAt: v.publishedAt,
            channelTitle: v.channelTitle || competitor.title,
          });
        }
      } catch (error: any) {
        this.logger.warn(
          `Failed to fetch uploads for ${competitor.title}: ${error.message}`,
        );
      }
    }

    return allVideos;
  }

  /**
   * Find content gaps: topics competitors covered that we haven't.
   */
  async findContentGaps(channelId: string): Promise<ContentGap[]> {
    const competitorUploads = await this.getCompetitorUploads(channelId, 30);
    if (competitorUploads.length === 0) return [];

    // Get our video titles
    const ourVideos = await this.videoModel
      .find({ channelId: new Types.ObjectId(channelId) })
      .select('title')
      .lean();
    const ourTitles = ourVideos.map((v) => v.title.toLowerCase());

    // Find gaps: competitor videos whose topic isn't in our catalog
    const gaps: ContentGap[] = [];

    for (const video of competitorUploads) {
      const titleLower = video.title.toLowerCase();
      const isOurs = ourTitles.some(
        (our) =>
          our.includes(titleLower.substring(0, 30)) ||
          titleLower.includes(our.substring(0, 30)),
      );

      if (!isOurs) {
        // Get search demand for this topic
        let searchDemand = 0;
        try {
          const demandMap =
            await this.suggestionsService.getSearchDemand([video.title]);
          searchDemand = demandMap.get(video.title) || 0;
        } catch {
          searchDemand = 0;
        }

        gaps.push({
          topic: video.title,
          competitorChannel: video.channelTitle,
          competitorVideoTitle: video.title,
          competitorViews: video.viewCount,
          searchDemand,
        });
      }
    }

    // Sort by search demand
    gaps.sort((a, b) => b.searchDemand - a.searchDemand);

    return gaps.slice(0, 20);
  }

  /**
   * Daily cron: check competitor uploads for all channels.
   * Runs at 6 AM daily. Logs quota usage to api_quota_logs.
   */
  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async dailyCompetitorCheck() {
    this.logger.log('Daily competitor check started');
    const channels = await this.channelModel.find({}).lean();
    let checked = 0;
    let failed = 0;

    for (const channel of channels) {
      try {
        await this.getCompetitorUploads(channel._id.toString(), 1);
        checked++;
      } catch (error) {
        this.logger.warn(`Daily competitor check failed for channel ${channel._id}: ${error.message}`);
        failed++;
      }
    }

    this.logger.log(`Daily competitor check complete: ${checked} checked, ${failed} failed`);
  }
}
