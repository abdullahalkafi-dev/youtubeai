import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { YouTubeService } from './youtube.service';
import { retryWithBackoff } from '../common/utils/retry';

const MAX_RESULTS_PER_PAGE = 100;
const MAX_ITERATIONS = 50;

export interface VideoAnalytics {
  videoId: string;
  views: number;
  estimatedMinutesWatched: number;
  averageViewDuration: number;
  averageViewPercentage: number;
  estimatedRevenue: number;
}

@Injectable()
export class YoutubeAnalyticsService {
  private readonly logger = new Logger(YoutubeAnalyticsService.name);

  constructor(private readonly youtubeService: YouTubeService) {}

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
      } catch (error) { this.logger.warn(`Analytics query ended: ${error.message}`); break; }
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
      return { videoId: rows[0][0] as string, views: (rows[0][1] as number) || 0, estimatedMinutesWatched: (rows[0][2] as number) || 0, averageViewDuration: (rows[0][3] as number) || 0, averageViewPercentage: (rows[0][4] as number) || 0, estimatedRevenue: (rows[0][5] as number) || 0 };
    } catch (error) { this.logger.error(`Failed to fetch analytics: ${error.message}`); return null; }
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
    } catch (error) {
      this.logger.warn(`Failed to fetch traffic sources: ${error.message}`);
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

      return (response.data.rows || []).map((row) => ({
        source: row[0] as string,
        views: (row[1] as number) || 0,
        watchMinutes: (row[2] as number) || 0,
        subsGained: 0,
      }));
    } catch (error) {
      this.logger.warn(`Failed to fetch traffic sources: ${error.message}`);
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

      return (response.data.rows || []).map((row) => ({
        date: row[0] as string,
        retentionPercent: (row[1] as number) || 0,
        avgDuration: (row[2] as number) || 0,
      }));
    } catch (error) {
      this.logger.warn(`Failed to fetch retention: ${error.message}`);
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

      return (response.data.rows || []).map((row) => ({
        date: row[0] as string,
        revenue: (row[1] as number) || 0,
        adRevenue: (row[2] as number) || 0,
      }));
    } catch (error) {
      this.logger.warn(`Failed to fetch revenue: ${error.message}`);
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
    } catch (error) {
      this.logger.warn(`Failed to fetch top videos: ${error.message}`);
      return [];
    }
  }
}
