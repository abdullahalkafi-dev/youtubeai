import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Channel, ChannelDocument } from '../mongo/schemas/channel.schema';
import { YouTubeService } from '../youtube/youtube.service';
import { YouTubeSuggestionsService } from '../youtube/youtube-suggestions.service';
import { QuotaService } from '../quota/quota.service';

export interface KeywordResearch {
  keyword: string;
  suggestions: string[];
  expanded: string[];
  searchDemand: number;     // 0-100
  competition: number;      // 0-100 (lower = less competition)
  overallScore: number;     // 0-100
  topVideos: Array<{
    title: string;
    views: number;
    channel: string;
    tags: string[];
  }>;
}

@Injectable()
export class KeywordsService {
  private readonly logger = new Logger(KeywordsService.name);

  constructor(
    @InjectModel(Channel.name)
    private readonly channelModel: Model<ChannelDocument>,
    private readonly youtubeService: YouTubeService,
    private readonly suggestionsService: YouTubeSuggestionsService,
    private readonly quotaService: QuotaService,
  ) {}

  async researchKeyword(
    channelId: string,
    keyword: string,
  ): Promise<KeywordResearch> {
    // 1. Autocomplete suggestions (free)
    const suggestions = await this.suggestionsService.getSuggestions(keyword);

    // 2. Expanded suggestions for top 5
    const expandedMap = await this.suggestionsService.getBulkSuggestions(
      suggestions.slice(0, 5),
    );
    const expanded = this.flattenExpanded(expandedMap);

    // 3. YouTube search for competition (100 units from shared pool)
    const channel = await this.channelModel.findById(channelId).lean();
    let topVideos: Array<{ title: string; views: number; channel: string; tags: string[] }> = [];

    if (channel?.userId) {
      // Pre-check quota: search.list (100) + videos.list (1) = 101 units
      await this.quotaService.checkQuota(channelId, 'search.list (keywords)', 101);

      try {
        const searchResults = await this.youtubeService.searchVideos({
          userId: channel.userId.toString(),
          query: keyword,
          publishedAfter: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
          maxResults: 10,
        });

        if (searchResults.length > 0) {
          const accessToken = await this.youtubeService.getValidAccessToken(
            channel.userId.toString(),
          );
          const details = await this.youtubeService.getVideoDetails(
            accessToken,
            searchResults.map((r) => r.videoId),
          );
          topVideos = details.map((v) => ({
            title: v.title,
            views: v.viewCount,
            channel: v.channelTitle || '',
            tags: v.tags || [],
          }));
          await this.quotaService.logCall({
            channelId,
            endpoint: 'search.list + videos.list (keywords)',
            quotaCost: 101,
            success: true,
          });
        }
      } catch (error) {
        this.logger.warn(`YouTube search failed: ${error.message}`);
      }
    }

    // 4. Calculate scores
    const searchDemand = this.calculateSearchDemand(
      keyword,
      suggestions,
      expandedMap,
    );
    const competition = this.calculateCompetition(topVideos);
    const overallScore = Math.round(
      searchDemand * 0.5 + (100 - competition) * 0.5,
    );

    return {
      keyword,
      suggestions,
      expanded,
      searchDemand,
      competition,
      overallScore,
      topVideos,
    };
  }

  async getRelatedKeywords(keyword: string): Promise<string[]> {
    const prefixes = [
      keyword,
      `${keyword} `,
      `how ${keyword}`,
      `why ${keyword}`,
      `what happened with ${keyword}`,
      `${keyword} explained`,
    ];
    const all = await this.suggestionsService.getBulkSuggestions(prefixes);
    return this.deduplicateAndRank(all);
  }

  private flattenExpanded(map: Map<string, string[]>): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const suggestions of map.values()) {
      for (const s of suggestions) {
        const lower = s.toLowerCase();
        if (!seen.has(lower)) {
          seen.add(lower);
          result.push(s);
        }
      }
    }
    return result.slice(0, 30);
  }

  private calculateSearchDemand(
    keyword: string,
    suggestions: string[],
    expanded: Map<string, string[]>,
  ): number {
    const lowerKeyword = keyword.toLowerCase();
    let count = 0;

    // Count appearances in own suggestions
    for (const s of suggestions) {
      if (s.toLowerCase().includes(lowerKeyword)) count++;
    }

    // Count appearances in expanded suggestions
    for (const otherSuggestions of expanded.values()) {
      for (const s of otherSuggestions) {
        if (s.toLowerCase().includes(lowerKeyword)) count++;
      }
    }

    // Normalize: 0 suggestions = 0, 10+ = 100
    return Math.min(100, Math.round((count / 10) * 100));
  }

  private calculateCompetition(
    videos: Array<{ views: number }>,
  ): number {
    if (videos.length === 0) return 0;

    const avgViews =
      videos.reduce((sum, v) => sum + v.views, 0) / videos.length;

    // High avg views = high competition
    // 1M+ avg views = 100, <1K avg views = 0
    if (avgViews >= 1_000_000) return 100;
    if (avgViews <= 1_000) return 0;
    return Math.round(
      (Math.log10(avgViews) - 3) / 3 * 100,
    );
  }

  private deduplicateAndRank(map: Map<string, string[]>): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const suggestions of map.values()) {
      for (const s of suggestions) {
        const lower = s.toLowerCase();
        if (!seen.has(lower)) {
          seen.add(lower);
          result.push(s);
        }
      }
    }
    return result.slice(0, 20);
  }
}
