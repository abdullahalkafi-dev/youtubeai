import { Injectable, Logger } from '@nestjs/common';
import { google, youtube_v3 } from 'googleapis';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../mongo/schemas/user.schema';
import { retryWithBackoff } from '../common/utils/retry';

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

@Injectable()
export class YouTubeService {
  private readonly logger = new Logger(YouTubeService.name);

  // Mutex: one refresh per user at a time. Others wait for the result.
  private refreshLocks = new Map<string, Promise<string>>();

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async getValidAccessToken(userId: string): Promise<string> {
    const user = await this.userModel.findById(userId);
    if (!user?.accessToken) {
      const error = new Error('OAUTH_NO_TOKEN: No OAuth token available. Please reconnect via Google OAuth.');
      (error as any).code = 'OAUTH_NO_TOKEN';
      throw error;
    }

    const nowWithBuffer = new Date(Date.now() + TOKEN_REFRESH_BUFFER_MS);
    if (!user.refreshToken || !user.tokenExpiresAt || nowWithBuffer < user.tokenExpiresAt) {
      return user.accessToken;
    }

    // If another request is already refreshing this user's token, wait for it
    const existingLock = this.refreshLocks.get(userId);
    if (existingLock) {
      this.logger.log(`Waiting for existing token refresh for user ${userId}...`);
      return existingLock;
    }

    // Create a new refresh lock
    const refreshPromise = this.doTokenRefresh(userId, user.refreshToken);
    this.refreshLocks.set(userId, refreshPromise);

    try {
      const token = await refreshPromise;
      return token;
    } finally {
      this.refreshLocks.delete(userId);
    }
  }

  private async doTokenRefresh(userId: string, refreshToken: string): Promise<string> {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 5000;
    this.logger.log(`Access token expired for user ${userId}, refreshing...`);

    const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        const newAccessToken = credentials.access_token;
        const newExpiryDate = credentials.expiry_date ? new Date(credentials.expiry_date) : new Date(Date.now() + 3600 * 1000);

        // Update access token, expiry, AND refresh token (Google may rotate it)
        const update: any = { accessToken: newAccessToken, tokenExpiresAt: newExpiryDate };
        if (credentials.refresh_token) {
          update.refreshToken = credentials.refresh_token;
        }

        await this.userModel.findByIdAndUpdate(userId, { $set: update });

        this.logger.log(`Token refreshed for user ${userId}`);
        return newAccessToken!;
      } catch (error: any) {
        this.logger.error(`Token refresh attempt ${attempt}/${MAX_RETRIES} failed: ${error.message}`);

        const isInvalidGrant =
          error.message?.includes('invalid_grant') ||
          error.message?.includes('invalid_request') ||
          error.response?.data?.error === 'invalid_grant';

        if (isInvalidGrant || attempt >= MAX_RETRIES) {
          const refreshError = new Error('OAUTH_REFRESH_FAILED: YouTube token expired. Please re-login with Google.');
          (refreshError as any).code = 'OAUTH_REFRESH_FAILED';
          throw refreshError;
        }

        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }

    throw new Error('OAUTH_REFRESH_FAILED');
  }

  private getClient(accessToken: string): youtube_v3.Youtube {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    return google.youtube({ version: 'v3', auth: oauth2Client });
  }

  async getChannelInfo(accessToken: string) {
    const youtube = this.getClient(accessToken);
    const response = await retryWithBackoff(() => youtube.channels.list({ part: ['snippet', 'statistics', 'contentDetails'], mine: true }), { operationName: 'YouTube Get Channel Info' });
    const channel = response.data.items?.[0];
    if (!channel) return null;
    return {
      channelId: channel.id || '', title: channel.snippet?.title || '', description: channel.snippet?.description || '',
      thumbnailUrl: channel.snippet?.thumbnails?.default?.url || '', subscriberCount: parseInt(channel.statistics?.subscriberCount || '0', 10),
      videoCount: parseInt(channel.statistics?.videoCount || '0', 10), viewCount: channel.statistics?.viewCount || '0',
      hiddenSubscriberCount: channel.statistics?.hiddenSubscriberCount || false,
    };
  }

  async getChannelContentDetails(accessToken: string) {
    const youtube = this.getClient(accessToken);
    const response = await retryWithBackoff(() => youtube.channels.list({ part: ['contentDetails'], mine: true }), { operationName: 'YouTube Channel Content Details' });
    return { uploadsPlaylistId: response.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads || '' };
  }

  async getPlaylistItems(accessToken: string, playlistId: string, pageToken?: string, maxResults = 50) {
    const youtube = this.getClient(accessToken);
    const response = await retryWithBackoff(() => youtube.playlistItems.list({ part: ['contentDetails'], playlistId, maxResults, pageToken }), { operationName: 'YouTube Playlist Items' });
    return { videoIds: (response.data.items || []).map(i => i.contentDetails?.videoId).filter((id): id is string => !!id), nextPageToken: response.data.nextPageToken || undefined, totalResults: response.data.pageInfo?.totalResults || 0 };
  }

  async getVideoDetails(accessToken: string, videoIds: string[]) {
    const youtube = this.getClient(accessToken);
    const results: any[] = [];
    const BATCH_SIZE = 50;
    for (let i = 0; i < videoIds.length; i += BATCH_SIZE) {
      const batch = videoIds.slice(i, i + BATCH_SIZE);
      try {
        const response = await retryWithBackoff(() => youtube.videos.list({ part: ['snippet', 'statistics', 'contentDetails', 'status'], id: [batch.join(',')] }), { operationName: `YouTube Video Details batch ${Math.floor(i / BATCH_SIZE) + 1}` });
        for (const item of response.data.items || []) {
          const thumbs = item.snippet?.thumbnails;
          results.push({
            videoId: item.id || '', title: item.snippet?.title || '', description: item.snippet?.description || '',
            thumbnailUrl: thumbs?.maxres?.url || thumbs?.high?.url || thumbs?.medium?.url || thumbs?.default?.url || '',
            publishedAt: item.snippet?.publishedAt || '', duration: item.contentDetails?.duration || 'PT0S',
            durationSeconds: this.parseDuration(item.contentDetails?.duration || 'PT0S'),
            viewCount: parseInt(item.statistics?.viewCount || '0', 10), likeCount: parseInt(item.statistics?.likeCount || '0', 10),
            commentCount: parseInt(item.statistics?.commentCount || '0', 10), videoUrl: `https://www.youtube.com/watch?v=${item.id}`,
            tags: (item.snippet?.tags as string[]) || [], definition: item.contentDetails?.definition || '',
            caption: item.contentDetails?.caption === 'true', categoryId: item.snippet?.categoryId || '',
            favoriteCount: parseInt(item.statistics?.favoriteCount || '0', 10), privacyStatus: item.status?.privacyStatus || '',
            embeddable: item.status?.embeddable ?? true, publicStatsViewable: item.status?.publicStatsViewable ?? true,
            license: item.status?.license || 'youtube', defaultLanguage: item.snippet?.defaultLanguage || '',
            defaultAudioLanguage: item.snippet?.defaultAudioLanguage || '', liveBroadcastContent: item.snippet?.liveBroadcastContent || 'none',
            projection: item.contentDetails?.projection || 'rectangular',
          });
        }
      } catch (error) {
        this.logger.error(`Failed to fetch video batch at offset ${i} (${batch.length} videos): ${error.message}`);
      }
    }
    return results;
  }

  private parseDuration(duration: string): number {
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;
    return (parseInt(match[1] || '0', 10) * 3600) + (parseInt(match[2] || '0', 10) * 60) + parseInt(match[3] || '0', 10);
  }

  async getCommentThreads(accessToken: string, videoId: string, pageToken?: string, maxResults = 100, order: 'relevance' | 'time' = 'relevance') {
    const youtube = this.getClient(accessToken);
    try {
      const response = await retryWithBackoff(() => youtube.commentThreads.list({ part: ['snippet', 'replies'], videoId, order, maxResults, pageToken }), { operationName: 'YouTube Comment Threads' });
      const comments = (response.data.items || []).map(item => {
        const snippet = item.snippet?.topLevelComment?.snippet;
        return {
          id: item.id || '', authorName: snippet?.authorDisplayName || '', authorAvatar: snippet?.authorProfileImageUrl || null,
          text: snippet?.textDisplay || '', likeCount: snippet?.likeCount || 0, replyCount: item.snippet?.totalReplyCount || 0,
          publishedAt: snippet?.publishedAt || '', updatedAt: snippet?.updatedAt || '',
          replies: (item.replies?.comments || []).map(r => ({ id: r.id || '', authorName: r.snippet?.authorDisplayName || '', authorAvatar: r.snippet?.authorProfileImageUrl || null, text: r.snippet?.textDisplay || '', likeCount: r.snippet?.likeCount || 0, publishedAt: r.snippet?.publishedAt || '' })),
        };
      });
      return { comments, nextPageToken: response.data.nextPageToken || undefined, totalResults: response.data.pageInfo?.totalResults || 0 };
    } catch (error: any) {
      if (error?.errors?.[0]?.reason === 'commentsDisabled' || error?.message?.includes('disabled')) return { comments: [], commentsDisabled: true };
      throw error;
    }
  }

  async getCommentReplies(accessToken: string, parentId: string, pageToken?: string, maxResults = 20) {
    const youtube = this.getClient(accessToken);
    const response = await retryWithBackoff(() => youtube.comments.list({ part: ['snippet'], parentId, maxResults, pageToken }), { operationName: 'YouTube Comment Replies' });
    return { replies: (response.data.items || []).map(i => ({ id: i.id || '', authorName: i.snippet?.authorDisplayName || '', authorAvatar: i.snippet?.authorProfileImageUrl || null, text: i.snippet?.textDisplay || '', likeCount: i.snippet?.likeCount || 0, publishedAt: i.snippet?.publishedAt || '' })), nextPageToken: response.data.nextPageToken || undefined };
  }

  async insertCommentReply(accessToken: string, parentId: string, text: string) {
    const youtube = this.getClient(accessToken);
    try {
      const response = await retryWithBackoff(() => youtube.comments.insert({ part: ['snippet'], requestBody: { snippet: { parentId, textOriginal: text } } }), { operationName: 'YouTube Insert Comment Reply' });
      const comment = response.data;
      return { success: true, mock: false, commentId: comment.id || '', authorName: comment.snippet?.authorDisplayName || '', text: comment.snippet?.textDisplay || '' };
    } catch (error: any) {
      this.logger.error(`Failed to post reply to parent ${parentId}: ${error?.message || error}`);
      throw error;
    }
  }

  async searchVideos(params: { userId: string; query: string; publishedAfter: Date; regionCode?: string; maxResults?: number }) {
    const accessToken = await this.getValidAccessToken(params.userId);
    const youtube = this.getClient(accessToken);
    const response = await retryWithBackoff(() => youtube.search.list({ part: ['snippet'], q: params.query, type: ['video'], publishedAfter: params.publishedAfter.toISOString(), regionCode: params.regionCode || 'US', order: 'relevance', maxResults: params.maxResults || 3 }), { operationName: 'YouTube Search Videos (Trends)' });
    return (response.data.items || []).map(i => ({
      videoId: i.id?.videoId || '',
      title: i.snippet?.title || '',
      thumbnailUrl: i.snippet?.thumbnails?.medium?.url || i.snippet?.thumbnails?.default?.url || '',
      channelTitle: i.snippet?.channelTitle || '',
      channelId: i.snippet?.channelId || '',
    })).filter(v => v.videoId);
  }

  async getChannelDetails(accessToken: string, youtubeChannelId: string) {
    const youtube = this.getClient(accessToken);
    const response = await retryWithBackoff(
      () => youtube.channels.list({ part: ['snippet', 'statistics'], id: [youtubeChannelId] }),
      { operationName: 'YouTube Get Channel Details' },
    );
    const channel = response.data.items?.[0];
    if (!channel) return null;
    return {
      channelId: channel.id || '',
      title: channel.snippet?.title || 'Unknown',
      thumbnailUrl: channel.snippet?.thumbnails?.default?.url || '',
      subscriberCount: parseInt(channel.statistics?.subscriberCount || '0', 10),
      videoCount: parseInt(channel.statistics?.videoCount || '0', 10),
      viewCount: parseInt(channel.statistics?.viewCount || '0', 10),
    };
  }

  async updateVideo(accessToken: string, videoId: string, title: string, description: string, tags: string[]) {
    const youtube = this.getClient(accessToken);
    const sanitizedTags = this.sanitizeTags(tags);
    const current = await retryWithBackoff(() => youtube.videos.list({ part: ['snippet'], id: [videoId] }), { operationName: 'YouTube Fetch Current Snippet' });
    const currentSnippet = current.data.items?.[0]?.snippet;
    if (!currentSnippet) throw new Error('Video not found on YouTube');
    await retryWithBackoff(() => youtube.videos.update({ part: ['snippet'], requestBody: { id: videoId, snippet: { ...currentSnippet, title, description, tags: sanitizedTags } } }), { operationName: 'YouTube Update Video' });
    return { success: true };
  }

  /**
   * Get YouTube's most popular (trending) videos.
   * No regionCode filter — pull globally, post-filter by keyword match.
   * Cost: 1 unit per call.
   */
  async getMostPopularVideos(
    accessToken: string,
    maxResults: number = 50,
  ): Promise<Array<{
    videoId: string;
    title: string;
    channelTitle: string;
    viewCount: number;
    tags: string[];
    publishedAt: string;
  }>> {
    const youtube = this.getClient(accessToken);
    try {
      const response = await retryWithBackoff(
        () =>
          youtube.videos.list({
            part: ['snippet', 'statistics'],
            chart: 'mostPopular',
            maxResults,
          }),
        { operationName: 'YouTube Most Popular Videos' },
      );

      return (response.data.items || []).map((item) => ({
        videoId: item.id || '',
        title: item.snippet?.title || '',
        channelTitle: item.snippet?.channelTitle || '',
        viewCount: parseInt(item.statistics?.viewCount || '0', 10),
        tags: (item.snippet?.tags as string[]) || [],
        publishedAt: item.snippet?.publishedAt || '',
      }));
    } catch (error) {
      this.logger.error(`Failed to fetch most popular videos: ${error.message}`);
      return [];
    }
  }

  private sanitizeTags(tags: string[]): string[] {
    if (!tags || !Array.isArray(tags)) return [];
    const cleaned = tags.map(t => (typeof t === 'string' ? t.trim().replace(/[#@\n\r]/g, '').replace(/[^\w\s\-]/g, '').substring(0, 30).trim() : '')).filter(t => t.length > 0);
    const result: string[] = [];
    let total = 0;
    for (const tag of cleaned) {
      if (total + tag.length + (result.length > 0 ? 2 : 0) <= 500) { result.push(tag); total += tag.length + (result.length > 1 ? 2 : 0); }
    }
    return result;
  }

  /**
   * Fetch official captions track for owned videos using YouTube Data API (OAuth fallback).
   * 100% immune to CAPTCHA/IP rate-limiting. Works for unlisted and private videos.
   */
  async getOfficialVideoCaptions(accessToken: string, videoId: string): Promise<string | null> {
    const youtube = this.getClient(accessToken);
    try {
      this.logger.log(`[Tier 2 Fallback] Fetching official captions API for video: ${videoId}`);
      const listRes = await youtube.captions.list({
        part: ['snippet'],
        videoId,
      });

      const items = listRes.data.items || [];
      if (items.length === 0) {
        this.logger.log(`No official caption tracks found for video ${videoId}`);
        return null;
      }

      // Prioritize English or auto-generated ('asr') tracks
      const englishTrack = items.find(i => i.snippet?.language?.startsWith('en'));
      const chosenTrack = englishTrack || items[0];

      if (!chosenTrack?.id) return null;

      const downloadRes = await youtube.captions.download(
        {
          id: chosenTrack.id,
          tfmt: 'vtt',
        },
        { responseType: 'text' },
      );

      if (downloadRes.data && typeof downloadRes.data === 'string') {
        this.logger.log(`[Tier 2 Success] Downloaded official VTT caption track for video ${videoId}`);
        return downloadRes.data;
      }
      return null;
    } catch (error: any) {
      this.logger.warn(`Failed to fetch official YouTube captions for video ${videoId}: ${error.message}`);
      return null;
    }
  }
}
