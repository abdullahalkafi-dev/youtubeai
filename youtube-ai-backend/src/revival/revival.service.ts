import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Video, VideoDocument } from '../mongo/schemas/video.schema';
import { Channel, ChannelDocument } from '../mongo/schemas/channel.schema';
import { YoutubeAnalyticsService } from '../youtube/youtube-analytics.service';
import { YouTubeSuggestionsService } from '../youtube/youtube-suggestions.service';

export interface RevivalVideo {
  videoId: string;
  title: string;
  viewCount: number;
  searchDemand: number;
  matchCount: number;
  publishedAt: string;
  thumbnailUrl: string;
}

export interface SearchTermData {
  term: string;
  views: number;
  watchMinutes: number;
}

/**
 * Revival Service
 *
 * Uses YouTube autocomplete API to estimate search demand for each video.
 * Videos with high search demand but older publish dates = highest revival priority.
 *
 * The autocomplete API is free, no quota cost, and returns what people
 * actually search for on YouTube.
 */
@Injectable()
export class RevivalService {
  private readonly logger = new Logger(RevivalService.name);

  constructor(
    @InjectModel(Video.name) private readonly videoModel: Model<VideoDocument>,
    @InjectModel(Channel.name)
    private readonly channelModel: Model<ChannelDocument>,
    private readonly analyticsService: YoutubeAnalyticsService,
    private readonly suggestionsService: YouTubeSuggestionsService,
  ) {}

  /**
   * Get videos ranked by revival priority.
   * Uses autocomplete API to estimate search demand for each video title.
   * Older videos with high autocomplete demand = highest priority.
   */
  async getRevivalPriority(
    channelId: string,
    period: number = 90,
  ): Promise<RevivalVideo[]> {
    // 1. Get videos from catalog (limit to those published within period)
    const cutoffDate = new Date(Date.now() - period * 24 * 60 * 60 * 1000);
    const videos = await this.videoModel
      .find({
        channelId: new Types.ObjectId(channelId),
        publishedAt: { $lte: cutoffDate }, // Only old videos worth reviving
      })
      .sort({ publishedAt: 1 }) // Oldest first
      .limit(200)
      .lean();

    if (videos.length === 0) return [];

    // 2. Extract search phrases from video titles
    // Use first 3-5 words of each title as a search query
    const videoPhrases = videos.map((v) => ({
      videoId: v._id.toString(),
      title: v.title,
      phrase: this.extractSearchPhrase(v.title),
      viewCount: v.viewCount || 0,
      publishedAt: v.publishedAt?.toString() || '',
      thumbnailUrl: v.thumbnailUrl || '',
    }));

    // 3. Batch autocomplete queries (limit to 10 at a time to avoid rate limiting)
    const demandMap = new Map<string, number>();
    const batchSize = 10;
    for (let i = 0; i < videoPhrases.length; i += batchSize) {
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      const batch = videoPhrases.slice(i, i + batchSize);
      const phrases = batch.map((v) => v.phrase);
      try {
        const results = await this.suggestionsService.getBulkSuggestions(phrases);
        for (const [phrase, suggestions] of results) {
          // Score = number of suggestions that contain the phrase (higher = more demand)
          const matchCount = suggestions.filter((s) =>
            s.toLowerCase().includes(phrase.toLowerCase())
          ).length;
          demandMap.set(phrase, matchCount);
        }
      } catch (error) {
        this.logger.warn(`Autocomplete batch failed: ${error.message}`);
      }
    }

    // 4. Build ranked results
    const results: RevivalVideo[] = [];
    for (const video of videoPhrases) {
      const matchCount = demandMap.get(video.phrase) || 0;
      if (matchCount === 0) continue; // Skip videos with no search demand

      // Search demand score: normalize to 0-100 scale
      // Most autocomplete queries return 0-10 suggestions
      const searchDemand = Math.min(100, matchCount * 10);

      results.push({
        videoId: video.videoId,
        title: video.title,
        viewCount: video.viewCount,
        searchDemand,
        matchCount,
        publishedAt: video.publishedAt,
        thumbnailUrl: video.thumbnailUrl,
      });
    }

    // 5. Sort by search demand (highest first)
    results.sort((a, b) => b.searchDemand - a.searchDemand);

    return results.slice(0, 50);
  }

  /**
   * Extract a search-friendly phrase from a video title.
   * Takes the first 3-5 meaningful words, removes special characters.
   */
  private extractSearchPhrase(title: string): string {
    // Remove common prefixes/suffixes and special chars
    const cleaned = title
      .replace(/[|–—\-:!?#@\[\](){}]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const words = cleaned.split(' ').filter((w) => w.length > 2);
    // Take first 3-5 words
    return words.slice(0, Math.min(5, words.length)).join(' ');
  }

  /**
   * Get raw search terms with views and watch time.
   * For the analytics dashboard.
   * Returns aggregated traffic source data (not individual terms).
   */
  async getSearchTermsSummary(
    channelId: string,
    period: number = 90,
  ): Promise<SearchTermData[]> {
    const channel = await this.channelModel.findById(channelId).lean();
    if (!channel?.userId || !channel?.youtubeChannelId) return [];

    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - period * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    try {
      return await this.analyticsService.getSearchTerms(
        channel.userId.toString(),
        channel.youtubeChannelId,
        startDate,
        endDate,
      );
    } catch (error) {
      this.logger.warn(`Failed to fetch search terms: ${error.message}`);
      return [];
    }
  }

  /**
   * Daily cron: scan revival opportunities for all channels.
   * Runs at 6 AM daily. Uses autocomplete (free, no quota cost).
   */
  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async dailyRevivalScan() {
    this.logger.log('Daily revival scan started');
    const channels = await this.channelModel.find({}).lean();
    let scanned = 0;
    let failed = 0;

    for (const channel of channels) {
      try {
        await this.getRevivalPriority(channel._id.toString(), 365);
        scanned++;
      } catch (error) {
        this.logger.warn(`Daily revival scan failed for channel ${channel._id}: ${error.message}`);
        failed++;
      }
    }

    this.logger.log(`Daily revival scan complete: ${scanned} scanned, ${failed} failed`);
  }
}
