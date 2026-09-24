import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { YouTubeService } from './youtube.service';
import { retryWithBackoff } from '../common/utils/retry';
import { QuotaService } from '../quota/quota.service';

const MAX_RESULTS_PER_PAGE = 100;
const MAX_ITERATIONS = 50;

export interface VideoAnalytics {
  videoId: string;
  views: number;
  estimatedMinutesWatched: number;
  averageViewDuration: number;
  averageViewPercentage: number;
  estimatedRevenue: number;
  impressions?: number;
  /** Click-through rate as 0–100 (e.g. 5.2 = 5.2%). */
  impressionsClickThroughRate?: number;
}

export interface ChannelPackagingBaseline {
  views: number;
  impressions: number;
  /** 0–100 */
  impressionsClickThroughRate: number;
  averageViewPercentage: number;
  estimatedMinutesWatched: number;
}

export interface VideoPackagingRow {
  videoId: string;
  title: string;
  views: number;
  impressions: number;
  /** 0–100 */
  ctr: number;
  averageViewPercentage: number;
  estimatedMinutesWatched: number;
  estimatedRevenue: number;
}

@Injectable()
export class YoutubeAnalyticsService {
  private readonly logger = new Logger(YoutubeAnalyticsService.name);

  constructor(
    private readonly youtubeService: YouTubeService,
    private readonly quotaService: QuotaService,
  ) {}

  async getChannelVideoAnalytics(userId: string, youtubeChannelId: string): Promise<Map<string, VideoAnalytics>> {
    const accessToken = await this.youtubeService.getValidAccessToken(userId);
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const youtubeAnalytics = google.youtubeAnalytics('v2');

    const startDate = '2005-01-01';
    const endDate = new Date().toISOString().split('T')[0];
    const analyticsMap = new Map<string, VideoAnalytics>();
    let startIndex = 1;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      try {
        const startTime = Date.now();
        const response = await retryWithBackoff(() => youtubeAnalytics.reports.query({
          auth: oauth2Client, ids: `channel==${youtubeChannelId}`, startDate, endDate,
          metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,estimatedRevenue',
          dimensions: 'video', sort: '-views', maxResults: MAX_RESULTS_PER_PAGE, startIndex,
        }), { operationName: 'YouTube Analytics Query' });

        const elapsed = Date.now() - startTime;
        const rows = response.data.rows;
        this.logger.log(`Analytics query iteration ${i + 1} (startIndex=${startIndex}): returned ${rows?.length || 0} rows in ${elapsed}ms`);

        await this.quotaService.logAnalyticsCall({
          channelId: youtubeChannelId,
          endpoint: 'analytics.reports.query (channel-videos)',
          success: true,
        });

        if (!rows || rows.length === 0) break;
        for (const row of rows) {
          analyticsMap.set(row[0] as string, {
            videoId: row[0] as string, views: (row[1] as number) || 0,
            estimatedMinutesWatched: (row[2] as number) || 0, averageViewDuration: (row[3] as number) || 0,
            averageViewPercentage: (row[4] as number) || 0, estimatedRevenue: (row[5] as number) || 0,
          });
        }
        if (rows.length < MAX_RESULTS_PER_PAGE || startIndex + MAX_RESULTS_PER_PAGE > 200) break;
        startIndex += MAX_RESULTS_PER_PAGE;
      } catch (error: any) {
        this.logger.warn(`Analytics query ended: ${error.message}`);
        await this.quotaService.logAnalyticsCall({
          channelId: youtubeChannelId,
          endpoint: 'analytics.reports.query (channel-videos)',
          success: false,
          errorMessage: error.message,
        });
        break;
      }
    }
    return analyticsMap;
  }

  async getSingleVideoAnalytics(userId: string, youtubeChannelId: string, youtubeVideoId: string): Promise<VideoAnalytics | null> {
    const accessToken = await this.youtubeService.getValidAccessToken(userId);
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const youtubeAnalytics = google.youtubeAnalytics('v2');

    try {
      const response = await retryWithBackoff(() => youtubeAnalytics.reports.query({
        auth: oauth2Client, ids: `channel==${youtubeChannelId}`, startDate: '2005-01-01', endDate: new Date().toISOString().split('T')[0],
        metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,estimatedRevenue',
        dimensions: 'video', filters: `video==${youtubeVideoId}`,
      }), { operationName: 'YouTube Analytics Single Video' });

      const rows = response.data.rows;
      if (!rows || rows.length === 0) return null;

      await this.quotaService.logAnalyticsCall({
        channelId: youtubeChannelId,
        endpoint: 'analytics.reports.query (single-video)',
        relatedId: youtubeVideoId,
        success: true,
      });

      return {
        videoId: rows[0][0] as string,
        views: (rows[0][1] as number) || 0,
        estimatedMinutesWatched: (rows[0][2] as number) || 0,
        averageViewDuration: (rows[0][3] as number) || 0,
        averageViewPercentage: (rows[0][4] as number) || 0,
        estimatedRevenue: (rows[0][5] as number) || 0,
      };
    } catch (error) { 
      this.logger.error(`Failed to fetch analytics: ${error.message}`); 
      await this.quotaService.logAnalyticsCall({
        channelId: youtubeChannelId,
        endpoint: 'analytics.reports.query (single-video)',
        relatedId: youtubeVideoId,
        success: false,
        errorMessage: error.message,
      });
      return null; 
    }
  }

  async getVideoDailyTimeseries(
    userId: string,
    youtubeChannelId: string,
    youtubeVideoId: string,
    startDate: string,
    endDate: string,
  ): Promise<Array<{ date: string; views: number; watchMinutes: number; avgDurationSeconds: number }>> {
    const accessToken = await this.youtubeService.getValidAccessToken(userId);
    if (!accessToken) return [];

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const youtubeAnalytics = google.youtubeAnalytics('v2');

    try {
      const response = await retryWithBackoff(() => youtubeAnalytics.reports.query({
        auth: oauth2Client,
        ids: `channel==${youtubeChannelId}`,
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched,averageViewDuration',
        dimensions: 'day',
        filters: `video==${youtubeVideoId}`,
        sort: 'day',
        maxResults: 5000,
      }), { operationName: 'YouTube Analytics Video Daily Timeseries' });

      const rows = response.data?.rows;
      if (!rows || !Array.isArray(rows) || rows.length === 0) return [];

      await this.quotaService.logAnalyticsCall({
        channelId: youtubeChannelId,
        endpoint: 'analytics.reports.query (daily-timeseries)',
        relatedId: youtubeVideoId,
        success: true,
      });

      return rows.map((row: any[]) => ({
        date: String(row?.[0] || ''),
        views: Number(row?.[1]) || 0,
        watchMinutes: Number(row?.[2]) || 0,
        avgDurationSeconds: Number(row?.[3]) || 0,
      }));
    } catch (error: any) {
      this.logger.error(`Failed to fetch daily timeseries for ${youtubeVideoId}: ${error?.message || error}`);
      await this.quotaService.logAnalyticsCall({
        channelId: youtubeChannelId,
        endpoint: 'analytics.reports.query (daily-timeseries)',
        relatedId: youtubeVideoId,
        success: false,
        errorMessage: error?.message || String(error),
      });
      return [];
    }
  }

  /**
   * Get traffic source breakdown showing where views come from.
   * Uses insightTrafficSourceType dimension to show aggregated traffic data.
   * Returns traffic sources like YT_SEARCH, YT_SUBSCRIBE, DIRECT, etc.
   */
  async getSearchTerms(
    userId: string,
    youtubeChannelId: string,
    startDate: string,
    endDate: string,
  ): Promise<Array<{ term: string; views: number; watchMinutes: number }>> {
    const accessToken = await this.youtubeService.getValidAccessToken(userId);
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const youtubeAnalytics = google.youtubeAnalytics('v2');

    try {
      const response = await retryWithBackoff(
        () =>
          youtubeAnalytics.reports.query({
            auth: oauth2Client,
            ids: `channel==${youtubeChannelId}`,
            startDate,
            endDate,
            metrics: 'views,estimatedMinutesWatched',
            dimensions: 'insightTrafficSourceType',
            sort: '-views',
            maxResults: 50,
          }),
        { operationName: 'YouTube Analytics Traffic Sources' },
      );

      await this.quotaService.logAnalyticsCall({
        channelId: youtubeChannelId,
        endpoint: 'analytics.reports.query (traffic-breakdown)',
        success: true,
      });

      const rows = response.data.rows;
      if (!rows || rows.length === 0) return [];

      // Map traffic source codes to human-readable names
      const sourceNames: Record<string, string> = {
        'YT_SEARCH': 'YouTube Search',
        'YT_SUBSCRIBE': 'Subscriptions',
        'YT_CHANNEL': 'Channel Pages',
        'YT_RELATED': 'Suggested Videos',
        'NO_LINK_OTHER': 'Direct / Unknown',
        'EXT_URL': 'External Websites',
        'PLAYLIST': 'Playlists',
        'NOTIFICATION': 'Notifications',
        'YT_OTHER': 'YouTube Other',
        'END_SCREEN': 'End Screen',
        'ANNOTATION': 'Cards / Annotations',
        'HASHTAG': 'Hashtags',
      };

      return rows.map((row) => ({
        term: sourceNames[row[0] as string] || (row[0] as string),
        views: (row[1] as number) || 0,
        watchMinutes: (row[2] as number) || 0,
      }));
    } catch (error: any) {
      this.logger.warn(`Failed to fetch traffic sources: ${error.message}`);
      await this.quotaService.logAnalyticsCall({
        channelId: youtubeChannelId,
        endpoint: 'analytics.reports.query (traffic-breakdown)',
        success: false,
        errorMessage: error.message,
      });
      return [];
    }
  }

  async getTrafficSources(
    userId: string,
    youtubeChannelId: string,
    startDate: string,
    endDate: string,
  ): Promise<Array<{ source: string; views: number; watchMinutes: number; subsGained: number }>> {
    const accessToken = await this.youtubeService.getValidAccessToken(userId);
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const youtubeAnalytics = google.youtubeAnalytics('v2');

    try {
      const response = await retryWithBackoff(
        () =>
          youtubeAnalytics.reports.query({
            auth: oauth2Client,
            ids: `channel==${youtubeChannelId}`,
            startDate,
            endDate,
            metrics: 'views,estimatedMinutesWatched',
            dimensions: 'insightTrafficSourceType',
            sort: '-views',
          }),
        { operationName: 'YouTube Analytics Traffic Sources' },
      );

      await this.quotaService.logAnalyticsCall({
        channelId: youtubeChannelId,
        endpoint: 'analytics.reports.query (traffic-sources)',
        success: true,
      });

      return (response.data.rows || []).map((row) => ({
        source: row[0] as string,
        views: (row[1] as number) || 0,
        watchMinutes: (row[2] as number) || 0,
        subsGained: 0,
      }));
    } catch (error: any) {
      this.logger.warn(`Failed to fetch traffic sources: ${error.message}`);
      await this.quotaService.logAnalyticsCall({
        channelId: youtubeChannelId,
        endpoint: 'analytics.reports.query (traffic-sources)',
        success: false,
        errorMessage: error.message,
      });
      return [];
    }
  }

  async getRetentionOverTime(
    userId: string,
    youtubeChannelId: string,
    startDate: string,
    endDate: string,
  ): Promise<Array<{ date: string; retentionPercent: number; avgDuration: number }>> {
    const accessToken = await this.youtubeService.getValidAccessToken(userId);
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const youtubeAnalytics = google.youtubeAnalytics('v2');

    try {
      const response = await retryWithBackoff(
        () =>
          youtubeAnalytics.reports.query({
            auth: oauth2Client,
            ids: `channel==${youtubeChannelId}`,
            startDate,
            endDate,
            metrics: 'averageViewPercentage,averageViewDuration',
            dimensions: 'day',
            sort: 'day',
          }),
        { operationName: 'YouTube Analytics Retention' },
      );

      await this.quotaService.logAnalyticsCall({
        channelId: youtubeChannelId,
        endpoint: 'analytics.reports.query (retention-over-time)',
        success: true,
      });

      return (response.data.rows || []).map((row) => ({
        date: row[0] as string,
        retentionPercent: (row[1] as number) || 0,
        avgDuration: (row[2] as number) || 0,
      }));
    } catch (error: any) {
      this.logger.warn(`Failed to fetch retention: ${error.message}`);
      await this.quotaService.logAnalyticsCall({
        channelId: youtubeChannelId,
        endpoint: 'analytics.reports.query (retention-over-time)',
        success: false,
        errorMessage: error.message,
      });
      return [];
    }
  }

  async getRevenueOverTime(
    userId: string,
    youtubeChannelId: string,
    startDate: string,
    endDate: string,
  ): Promise<Array<{ date: string; revenue: number; adRevenue: number }>> {
    const accessToken = await this.youtubeService.getValidAccessToken(userId);
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const youtubeAnalytics = google.youtubeAnalytics('v2');

    try {
      const response = await retryWithBackoff(
        () =>
          youtubeAnalytics.reports.query({
            auth: oauth2Client,
            ids: `channel==${youtubeChannelId}`,
            startDate,
            endDate,
            metrics: 'estimatedRevenue,estimatedAdRevenue',
            dimensions: 'day',
            sort: 'day',
          }),
        { operationName: 'YouTube Analytics Revenue' },
      );

      await this.quotaService.logAnalyticsCall({
        channelId: youtubeChannelId,
        endpoint: 'analytics.reports.query (revenue-over-time)',
        success: true,
      });

      return (response.data.rows || []).map((row) => ({
        date: row[0] as string,
        revenue: (row[1] as number) || 0,
        adRevenue: (row[2] as number) || 0,
      }));
    } catch (error: any) {
      this.logger.warn(`Failed to fetch revenue: ${error.message}`);
      await this.quotaService.logAnalyticsCall({
        channelId: youtubeChannelId,
        endpoint: 'analytics.reports.query (revenue-over-time)',
        success: false,
        errorMessage: error.message,
      });
      return [];
    }
  }

  async getTopVideosByWatchTime(
    userId: string,
    youtubeChannelId: string,
    startDate: string,
    endDate: string,
    maxResults: number = 10,
  ): Promise<Array<{ videoId: string; title: string; views: number; watchMinutes: number; retentionPercent: number; revenue: number }>> {
    const accessToken = await this.youtubeService.getValidAccessToken(userId);
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const youtubeAnalytics = google.youtubeAnalytics('v2');

    try {
      const response = await retryWithBackoff(
        () =>
          youtubeAnalytics.reports.query({
            auth: oauth2Client,
            ids: `channel==${youtubeChannelId}`,
            startDate,
            endDate,
            metrics: 'views,estimatedMinutesWatched,averageViewPercentage,estimatedRevenue',
            dimensions: 'video',
            sort: '-estimatedMinutesWatched',
            maxResults,
          }),
        { operationName: 'YouTube Analytics Top Videos' },
      );

      await this.quotaService.logAnalyticsCall({
        channelId: youtubeChannelId,
        endpoint: 'analytics.reports.query (top-videos)',
        success: true,
      });

      const rows = response.data.rows || [];
      if (rows.length === 0) return [];

      // Batch-fetch video titles using YouTube Data API
      const videoIds = rows.map((row) => row[0] as string);
      const titleMap = new Map<string, string>();
      try {
        const details = await this.youtubeService.getVideoDetails(accessToken, videoIds);
        for (const detail of details) {
          titleMap.set(detail.videoId, detail.title);
        }
      } catch (error) {
        this.logger.warn(`Failed to fetch video titles: ${error.message}`);
      }

      return rows.map((row) => ({
        videoId: row[0] as string,
        title: titleMap.get(row[0] as string) || `Video ${row[0]}`,
        views: (row[1] as number) || 0,
        watchMinutes: (row[2] as number) || 0,
        retentionPercent: (row[3] as number) || 0,
        revenue: (row[4] as number) || 0,
      }));
    } catch (error: any) {
      this.logger.warn(`Failed to fetch top videos: ${error.message}`);
      await this.quotaService.logAnalyticsCall({
        channelId: youtubeChannelId,
        endpoint: 'analytics.reports.query (top-videos)',
        success: false,
        errorMessage: error.message,
      });
      return [];
    }
  }

  /** Top YouTube search terms that send traffic (cheap Analytics query). */
  async getTopSearchTerms(
    userId: string,
    youtubeChannelId: string,
    startDate: string,
    endDate: string,
    maxResults = 8,
  ): Promise<Array<{ term: string; views: number; watchMinutes: number }>> {
    const accessToken = await this.youtubeService.getValidAccessToken(userId);
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const youtubeAnalytics = google.youtubeAnalytics('v2');

    try {
      const response = await retryWithBackoff(
        () =>
          youtubeAnalytics.reports.query({
            auth: oauth2Client,
            ids: `channel==${youtubeChannelId}`,
            startDate,
            endDate,
            metrics: 'views,estimatedMinutesWatched',
            dimensions: 'insightTrafficSourceDetail',
            filters: 'insightTrafficSourceType==YT_SEARCH',
            sort: '-views',
            maxResults,
          }),
        { operationName: 'YouTube Analytics Search Terms' },
      );
      await this.quotaService.logAnalyticsCall({
        channelId: youtubeChannelId,
        endpoint: 'analytics.reports.query (search-terms)',
        success: true,
      });
      return (response.data.rows || []).map((row) => ({
        term: String(row[0] || ''),
        views: (row[1] as number) || 0,
        watchMinutes: (row[2] as number) || 0,
      }));
    } catch (error: any) {
      this.logger.warn(`Failed to fetch search terms: ${error.message}`);
      await this.quotaService.logAnalyticsCall({
        channelId: youtubeChannelId,
        endpoint: 'analytics.reports.query (search-terms)',
        success: false,
        errorMessage: error.message,
      });
      return [];
    }
  }

  /** Age + gender + top countries + subscribed split — who is watching. */
  async getAudienceBreakdown(
    userId: string,
    youtubeChannelId: string,
    startDate: string,
    endDate: string,
  ): Promise<{
    ageGroups: Array<{ group: string; views: number }>;
    genders: Array<{ gender: string; views: number }>;
    countries: Array<{ country: string; views: number; watchMinutes: number }>;
    subscribed: Array<{ status: string; views: number; watchMinutes: number }>;
  }> {
    const result = {
      ageGroups: [] as Array<{ group: string; views: number }>,
      genders: [] as Array<{ gender: string; views: number }>,
      countries: [] as Array<{ country: string; views: number; watchMinutes: number }>,
      subscribed: [] as Array<{ status: string; views: number; watchMinutes: number }>,
    };

    const accessToken = await this.youtubeService.getValidAccessToken(userId);
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const youtubeAnalytics = google.youtubeAnalytics('v2');

    const run = async (label: string, params: Record<string, any>) => {
      try {
        const response = await retryWithBackoff(
          () =>
            youtubeAnalytics.reports.query({
              auth: oauth2Client,
              ids: `channel==${youtubeChannelId}`,
              startDate,
              endDate,
              ...params,
            }),
          { operationName: `YouTube Analytics ${label}` },
        );
        await this.quotaService.logAnalyticsCall({
          channelId: youtubeChannelId,
          endpoint: `analytics.reports.query (${label})`,
          success: true,
        });
        return response.data.rows || [];
      } catch (error: any) {
        this.logger.warn(`Failed to fetch ${label}: ${error.message}`);
        await this.quotaService.logAnalyticsCall({
          channelId: youtubeChannelId,
          endpoint: `analytics.reports.query (${label})`,
          success: false,
          errorMessage: error.message,
        });
        return [];
      }
    };

    // ageGroup/gender reports are not supported for this channel (API: "query is not supported")
    result.ageGroups = [];
    result.genders = [];

    const countryRows = await run('audience-country', {
      metrics: 'views,estimatedMinutesWatched',
      dimensions: 'country',
      sort: '-views',
      maxResults: 6,
    });
    result.countries = countryRows.map((r) => ({
      country: String(r[0] || ''),
      views: (r[1] as number) || 0,
      watchMinutes: (r[2] as number) || 0,
    }));

    const subRows = await run('audience-subscribed', {
      metrics: 'views,estimatedMinutesWatched',
      dimensions: 'subscribedStatus',
      sort: '-views',
      maxResults: 5,
    });
    result.subscribed = subRows.map((r) => ({
      status: String(r[0] || ''),
      views: (r[1] as number) || 0,
      watchMinutes: (r[2] as number) || 0,
    }));

    return result;
  }

  /** Normalize CTR API value (0–1 or already %) to 0–100. */
  private normalizeCtr(...values: Array<number | undefined>): number {
    for (const v of values) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        return v <= 1 ? Math.round(v * 10000) / 100 : Math.round(v * 100) / 100;
      }
    }
    return 0;
  }

  /**
   * Channel packaging baseline over a date window (impressions + CTR + retention).
   * Cheap Analytics query — use for "is this video below baseline?".
   */
  async getChannelPackagingBaseline(
    userId: string,
    youtubeChannelId: string,
    startDate: string,
    endDate: string,
  ): Promise<ChannelPackagingBaseline> {
    const accessToken = await this.youtubeService.getValidAccessToken(userId);
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const youtubeAnalytics = google.youtubeAnalytics('v2');

    try {
      const response = await retryWithBackoff(
        () =>
          youtubeAnalytics.reports.query({
            auth: oauth2Client,
            ids: `channel==${youtubeChannelId}`,
            startDate,
            endDate,
            metrics:
              'views,averageViewPercentage,estimatedMinutesWatched',
          }),
        { operationName: 'YouTube Analytics Packaging Baseline' },
      );

      await this.quotaService.logAnalyticsCall({
        channelId: youtubeChannelId,
        endpoint: 'analytics.reports.query (packaging-baseline)',
        success: true,
      });

      const row = response.data.rows?.[0];
      return {
        views: (row?.[0] as number) || 0,
        impressions: 0,
        impressionsClickThroughRate: 0,
        averageViewPercentage: (row?.[1] as number) || 0,
        estimatedMinutesWatched: (row?.[2] as number) || 0,
      };
    } catch (error: any) {
      this.logger.warn(`Failed to fetch packaging baseline: ${error.message}`);
      await this.quotaService.logAnalyticsCall({
        channelId: youtubeChannelId,
        endpoint: 'analytics.reports.query (packaging-baseline)',
        success: false,
        errorMessage: error.message,
      });
      // Fallback: core metrics only (CTR metric may be unsupported)
      try {
        const fallback = await retryWithBackoff(
          () =>
            youtubeAnalytics.reports.query({
              auth: oauth2Client,
              ids: `channel==${youtubeChannelId}`,
              startDate,
              endDate,
              metrics: 'views,estimatedMinutesWatched,averageViewPercentage',
            }),
          { operationName: 'YouTube Analytics Packaging Baseline Fallback' },
        );
        await this.quotaService.logAnalyticsCall({
          channelId: youtubeChannelId,
          endpoint: 'analytics.reports.query (packaging-baseline-fallback)',
          success: true,
        });
        const row = fallback.data.rows?.[0];
        return {
          views: (row?.[0] as number) || 0,
          impressions: 0,
          impressionsClickThroughRate: 0,
          averageViewPercentage: (row?.[2] as number) || 0,
          estimatedMinutesWatched: (row?.[1] as number) || 0,
        };
      } catch (fallbackErr: any) {
        this.logger.warn(`Packaging baseline fallback failed: ${fallbackErr?.message || fallbackErr}`);
        return {
          views: 0,
          impressions: 0,
          impressionsClickThroughRate: 0,
          averageViewPercentage: 0,
          estimatedMinutesWatched: 0,
        };
      }
    }
  }

  /**
   * Per-video packaging rows (views, impressions, CTR, retention) sorted by views.
   * Used for winners/misses and peer compare. Titles filled via Data API when possible.
   */
  async getVideoPackagingRows(
    userId: string,
    youtubeChannelId: string,
    startDate: string,
    endDate: string,
    maxResults = 30,
  ): Promise<VideoPackagingRow[]> {
    const accessToken = await this.youtubeService.getValidAccessToken(userId);
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const youtubeAnalytics = google.youtubeAnalytics('v2');

    try {
      const response = await retryWithBackoff(
        () =>
          youtubeAnalytics.reports.query({
            auth: oauth2Client,
            ids: `channel==${youtubeChannelId}`,
            startDate,
            endDate,
            metrics:
              'views,estimatedMinutesWatched,averageViewPercentage',
            dimensions: 'video',
            sort: '-views',
            maxResults,
          }),
        { operationName: 'YouTube Analytics Packaging Rows' },
      );

      await this.quotaService.logAnalyticsCall({
        channelId: youtubeChannelId,
        endpoint: 'analytics.reports.query (packaging-rows)',
        success: true,
      });

      const rows = response.data.rows || [];
      if (rows.length === 0) return [];

      const videoIds = rows.map((r) => r[0] as string);
      const titleMap = new Map<string, string>();
      try {
        const details = await this.youtubeService.getVideoDetails(accessToken, videoIds);
        for (const d of details) titleMap.set(d.videoId, d.title);
      } catch (err: any) {
        this.logger.warn(`Packaging row titles failed: ${err?.message || err}`);
      }

      return rows.map((row) => ({
        videoId: row[0] as string,
        title: titleMap.get(row[0] as string) || `Video ${row[0]}`,
        views: (row[1] as number) || 0,
        impressions: 0,
        ctr: 0,
        estimatedMinutesWatched: (row[2] as number) || 0,
        averageViewPercentage: (row[3] as number) || 0,
        estimatedRevenue: 0,
      }));
    } catch (error: any) {
      this.logger.warn(`Failed to fetch packaging rows: ${error.message}`);
      await this.quotaService.logAnalyticsCall({
        channelId: youtubeChannelId,
        endpoint: 'analytics.reports.query (packaging-rows)',
        success: false,
        errorMessage: error.message,
      });
      // Fallback without impressions/CTR
      try {
        const fb = await retryWithBackoff(
          () =>
            youtubeAnalytics.reports.query({
              auth: oauth2Client,
              ids: `channel==${youtubeChannelId}`,
              startDate,
              endDate,
              metrics: 'views,estimatedMinutesWatched,averageViewPercentage',
              dimensions: 'video',
              sort: '-views',
              maxResults,
            }),
          { operationName: 'YouTube Analytics Packaging Rows Fallback' },
        );
        await this.quotaService.logAnalyticsCall({
          channelId: youtubeChannelId,
          endpoint: 'analytics.reports.query (packaging-rows-fallback)',
          success: true,
        });
        const fbRows = fb.data.rows || [];
        if (!fbRows.length) return [];
        const videoIds = fbRows.map((r) => r[0] as string);
        const titleMap = new Map<string, string>();
        try {
          const details = await this.youtubeService.getVideoDetails(accessToken, videoIds);
          for (const d of details) titleMap.set(d.videoId, d.title);
        } catch { /* titles optional */ }
        return fbRows.map((row) => ({
          videoId: row[0] as string,
          title: titleMap.get(row[0] as string) || `Video ${row[0]}`,
          views: (row[1] as number) || 0,
          impressions: 0,
          ctr: 0,
          averageViewPercentage: (row[3] as number) || 0,
          estimatedMinutesWatched: (row[2] as number) || 0,
          estimatedRevenue: 0,
        }));
      } catch (fbErr: any) {
        this.logger.warn(`Packaging rows fallback failed: ${fbErr?.message || fbErr}`);
        return [];
      }
    }
  }

  /** Single-video packaging metrics in a date window (defaults lifetime-ish caller-supplied). */
  async getVideoPackagingMetrics(
    userId: string,
    youtubeChannelId: string,
    youtubeVideoId: string,
    startDate = '2005-01-01',
    endDate = new Date().toISOString().split('T')[0],
  ): Promise<VideoAnalytics | null> {
    const accessToken = await this.youtubeService.getValidAccessToken(userId);
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const youtubeAnalytics = google.youtubeAnalytics('v2');

    try {
      const response = await retryWithBackoff(
        () =>
          youtubeAnalytics.reports.query({
            auth: oauth2Client,
            ids: `channel==${youtubeChannelId}`,
            startDate,
            endDate,
            metrics:
              'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,estimatedRevenue',
            dimensions: 'video',
            filters: `video==${youtubeVideoId}`,
          }),
        { operationName: 'YouTube Analytics Video Packaging' },
      );

      const rows = response.data.rows;
      if (!rows || rows.length === 0) return null;

      await this.quotaService.logAnalyticsCall({
        channelId: youtubeChannelId,
        endpoint: 'analytics.reports.query (video-packaging)',
        relatedId: youtubeVideoId,
        success: true,
      });

      return {
        videoId: rows[0][0] as string,
        views: (rows[0][1] as number) || 0,
        estimatedMinutesWatched: (rows[0][2] as number) || 0,
        averageViewDuration: (rows[0][3] as number) || 0,
        averageViewPercentage: (rows[0][4] as number) || 0,
        estimatedRevenue: (rows[0][5] as number) || 0,
        impressions: 0,
        impressionsClickThroughRate: 0,
      };
    } catch (error: any) {
      this.logger.warn(`Failed to fetch video packaging for ${youtubeVideoId}: ${error.message}`);
      await this.quotaService.logAnalyticsCall({
        channelId: youtubeChannelId,
        endpoint: 'analytics.reports.query (video-packaging)',
        relatedId: youtubeVideoId,
        success: false,
        errorMessage: error.message,
      });
      try {
        const fb = await retryWithBackoff(
          () =>
            youtubeAnalytics.reports.query({
              auth: oauth2Client,
              ids: `channel==${youtubeChannelId}`,
              startDate,
              endDate,
              metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,estimatedRevenue',
              dimensions: 'video',
              filters: `video==${youtubeVideoId}`,
            }),
          { operationName: 'YouTube Analytics Video Packaging Fallback' },
        );
        const rows = fb.data.rows;
        if (!rows || rows.length === 0) return null;
        await this.quotaService.logAnalyticsCall({
          channelId: youtubeChannelId,
          endpoint: 'analytics.reports.query (video-packaging-fallback)',
          relatedId: youtubeVideoId,
          success: true,
        });
        return {
          videoId: rows[0][0] as string,
          views: (rows[0][1] as number) || 0,
          estimatedMinutesWatched: (rows[0][2] as number) || 0,
          averageViewDuration: (rows[0][3] as number) || 0,
          averageViewPercentage: (rows[0][4] as number) || 0,
          estimatedRevenue: (rows[0][5] as number) || 0,
          impressions: 0,
          impressionsClickThroughRate: 0,
        };
      } catch (fbErr: any) {
        this.logger.warn(`Video packaging fallback failed for ${youtubeVideoId}: ${fbErr?.message || fbErr}`);
        return null;
      }
    }
  }
}
