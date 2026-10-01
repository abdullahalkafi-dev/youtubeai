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

/** Studio → "Channels your audience watches" (client screenshots). */
export const AUDIENCE_WATCHES_NAMES = [
  'Ceddy Nash',
  'End Of Sentence',
  'Trap More Ross',
  'djvlad',
  'Hood Educated',
  'TRENCHES NEWS',
  'CUFBOYS',
  'King Akademiks',
  'AI Profit',
  'BOSS TALK 101',
  'The Art Of Dialogue',
  'Poetik Flakko',
  '1800WTF',
  'URBAN POLITICIANS TV',
  'SAY CHEESE!',
] as const;

export interface AudienceWatchBrief {
  title: string;
  subscriberCount: number;
  lifetimeViews: number;
  recentUploads: Array<{
    title: string;
    publishedAt: string;
    viewCount: number;
  }>;
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

  /** Auto-seed on boot (deferred so OAuth/quota services settle first). */
  async onModuleInit(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 15_000));
    try {
      const channel = await this.channelModel.findOne({}).lean();
      if (channel) await this.autoSeedIfIncomplete(channel._id.toString(), 'startup');
    } catch (err: any) {
      this.logger.warn(`[AudienceWatches] startup seed failed: ${err?.message || err}`);
    }
  }

  /**
   * Seed the audience-watches list when incomplete (idempotent, quota-guarded).
   * Safe to call from startup, the daily cron, or lazily from chat — it skips
   * when the list is full or today's quota has no headroom left.
   */
  async autoSeedIfIncomplete(channelId: string, trigger: string): Promise<void> {
    try {
      const count = await this.competitorModel.countDocuments({
        channelId: new Types.ObjectId(channelId),
      });
      if (count >= AUDIENCE_WATCHES_NAMES.length) return;

      const channel = await this.channelModel.findById(channelId).lean();
      if (!channel?.userId) return;

      const { used } = await this.quotaService.getDailyUsage(channelId);
      if (used > 6500) {
        this.logger.warn(
          `[AudienceWatches] seed (${trigger}) skipped — quota headroom too low (${used} used)`,
        );
        return;
      }

      this.logger.log(
        `[AudienceWatches] seed (${trigger}) starting — count=${count}/${AUDIENCE_WATCHES_NAMES.length}`,
      );
      await this.seedAudienceWatches(channelId);
    } catch (err: any) {
      this.logger.warn(`[AudienceWatches] seed (${trigger}) failed: ${err?.message || err}`);
    }
  }

  /**
   * Seed Studio "Channels your audience watches" (idempotent).
   * At most 1 search.list per missing name (only when not already in DB).
   */
  async seedAudienceWatches(channelId: string): Promise<{ added: number; skipped: number; missing: string[] }> {
    const channel = await this.channelModel.findById(channelId).lean();
    if (!channel?.userId) throw new Error('Channel not found');

    const existing = await this.competitorModel
      .find({ channelId: new Types.ObjectId(channelId) })
      .lean();
    const have = new Set(existing.map((c) => (c.title || '').toLowerCase().trim()));

    let added = 0;
    let skipped = 0;
    const missing: string[] = [];

    for (const name of AUDIENCE_WATCHES_NAMES) {
      const key = name.toLowerCase().trim();
      if (have.has(key) || existing.some((c) => key.includes((c.title || '').toLowerCase()) || (c.title || '').toLowerCase().includes(key))) {
        skipped++;
        continue;
      }
      try {
        const hits = await this.youtubeService.searchChannels({
          userId: channel.userId.toString(),
          query: name,
          maxResults: 3,
        });
        await this.quotaService.logCall({
          channelId,
          endpoint: 'search.list (seedAudienceWatches)',
          quotaCost: 100,
          success: true,
          relatedId: name,
        });
        const hit =
          hits.find((h) => (h.title || '').toLowerCase().trim() === key) ||
          hits.find((h) => {
            const t = (h.title || '').toLowerCase().trim();
            // Close match only — do not accept random top hit (avoids "AI Profit" wrong channel)
            return t === key || t.replace(/[^a-z0-9]/g, '') === key.replace(/[^a-z0-9]/g, '');
          });
        if (!hit?.channelId) {
          missing.push(name);
          continue;
        }
        const yt = await this.youtubeService.getChannelDetails(
          await this.youtubeService.getValidAccessToken(channel.userId.toString()),
          hit.channelId,
        );
        await this.quotaService.logCall({
          channelId,
          endpoint: 'channels.list (seedAudienceWatches)',
          quotaCost: 1,
          success: true,
          relatedId: hit.channelId,
        });
        await this.competitorModel.create({
          channelId: new Types.ObjectId(channelId),
          youtubeChannelId: hit.channelId,
          title: yt?.title || hit.title || name,
          thumbnailUrl: yt?.thumbnailUrl || hit.thumbnailUrl || '',
          subscriberCount: yt?.subscriberCount || 0,
          videoCount: yt?.videoCount || 0,
          viewCount: yt?.viewCount || 0,
          isAutoDetected: false,
          source: 'audience_watches',
          discoveredAt: new Date(),
          lastChecked: new Date(),
        });
        have.add((yt?.title || name).toLowerCase().trim());
        added++;
      } catch (err: any) {
        this.logger.warn(`seedAudienceWatches "${name}" failed: ${err?.message || err}`);
        missing.push(name);
      }
    }

    this.logger.log(
      `[AudienceWatches] seed channel=${channelId} added=${added} skipped=${skipped} missing=${missing.length}`,
    );
    return { added, skipped, missing };
  }

  /**
   * Compact demand brief for AI context (subs + lifetime + 2 recent uploads with views).
   * Caches nothing — caller should only use this for ideas/trends/script, not every message.
   */
  async getAudienceWatchBrief(channelId: string, maxChannels = 8): Promise<AudienceWatchBrief[]> {
    const competitors = await this.competitorModel
      .find({ channelId: new Types.ObjectId(channelId) })
      .sort({ subscriberCount: -1 })
      .limit(maxChannels)
      .lean();
    if (competitors.length === 0) return [];

    const channel = await this.channelModel.findById(channelId).lean();
    if (!channel?.userId) return [];

    // Only scan the same N channels as the brief (quota-safe)
    const onlyIds = competitors
      .map((c) => c.youtubeChannelId)
      .filter(Boolean);
    const uploads = await this.getCompetitorUploads(channelId, 45, onlyIds);
    const byChannel = new Map<string, CompetitorVideo[]>();
    for (const v of uploads) {
      const key = (v.channelTitle || '').toLowerCase();
      const list = byChannel.get(key) || [];
      list.push(v);
      byChannel.set(key, list);
    }

    return competitors.map((c) => {
      const key = (c.title || '').toLowerCase();
      const list = (byChannel.get(key) || []).slice(0, 2);
      return {
        title: c.title,
        subscriberCount: c.subscriberCount || 0,
        lifetimeViews: c.viewCount || 0,
        recentUploads: list.map((v) => ({
          title: v.title,
          publishedAt: v.publishedAt,
          viewCount: v.viewCount || 0,
        })),
      };
    });
  }

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
        // One log row PER search.list query — the "x/100 calls" counter must count
        // calls, not saved competitors (queries returning nothing still bill Google).
        await this.quotaService.logCall({
          channelId,
          endpoint: 'search.list (discoverCompetitors)',
          quotaCost: 100,
          success: true,
          relatedId: query,
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
        await this.quotaService.logCall({
          channelId,
          endpoint: 'search.list (discoverCompetitors)',
          quotaCost: 100,
          success: false,
          errorMessage: error.message,
          relatedId: query,
        });
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
   * Get recent uploads from competitors.
   * @param onlyYoutubeIds optional — limit scan to these competitor channel IDs (quota).
   */
  async getCompetitorUploads(
    channelId: string,
    days: number = 30,
    onlyYoutubeIds?: string[],
  ): Promise<CompetitorVideo[]> {
    const query: any = { channelId: new Types.ObjectId(channelId) };
    if (onlyYoutubeIds?.length) {
      query.youtubeChannelId = { $in: onlyYoutubeIds };
    }
    const competitors = await this.competitorModel.find(query).lean();

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

    // Real view counts (was hardcoded 0) — one videos.list batch
    if (allVideos.length > 0) {
      try {
        const ids = allVideos.map((v) => v.videoId).filter(Boolean);
        const details = await this.youtubeService.getVideoDetails(accessToken, ids);
        const viewMap = new Map(details.map((d) => [d.videoId, d.viewCount || 0]));
        for (const v of allVideos) {
          v.viewCount = viewMap.get(v.videoId) || 0;
        }
        await this.quotaService.logCall({
          channelId,
          endpoint: 'videos.list (competitorUploads views)',
          quotaCost: Math.max(1, Math.ceil(ids.length / 50)),
          success: true,
        });
      } catch (err: any) {
        this.logger.warn(`competitor viewCount fetch failed: ${err?.message || err}`);
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
    const candidates = competitorUploads.filter((video) => {
      const titleLower = video.title.toLowerCase();
      return !ourTitles.some(
        (our) =>
          our.includes(titleLower.substring(0, 30)) ||
          titleLower.includes(our.substring(0, 30)),
      );
    });

    // Proven-demand first: top 25 by views, then ONE batched suggest call.
    // (Per-video sequential getSearchDemand here caused ~100 fetches = 30-60s
    // freezes on first ideas/script message + Google 429 rate-limits.)
    candidates.sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));
    const capped = candidates.slice(0, 25);

    let demandMap = new Map<string, number>();
    try {
      demandMap = await this.suggestionsService.getSearchDemand(
        capped.map((v) => v.title),
      );
    } catch {
      demandMap = new Map<string, number>();
    }

    const gaps: ContentGap[] = capped.map((video) => ({
      topic: video.title,
      competitorChannel: video.channelTitle,
      competitorVideoTitle: video.title,
      competitorViews: video.viewCount,
      searchDemand: demandMap.get(video.title) || 0,
    }));

    // Sort by search demand, views as tiebreak
    gaps.sort(
      (a, b) => b.searchDemand - a.searchDemand || b.competitorViews - a.competitorViews,
    );

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
        // Self-healing seed: retries any missing audience-watches names after the quota reset
        await this.autoSeedIfIncomplete(channel._id.toString(), 'daily-cron');
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
