import { Injectable, Logger } from '@nestjs/common';
import { YouTubeService } from '../youtube/youtube.service';
import { QuotaService } from '../quota/quota.service';
import { OpenAIService } from '../openai/openai.service';
import { CommentCacheService } from './comment-cache.service';

const QUOTA_COST_COMMENT_THREADS = 2;
const QUOTA_COST_COMMENT_REPLIES = 2;
const QUOTA_COST_COMMENT_INSERT = 50;

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    private readonly youtubeService: YouTubeService,
    private readonly quotaService: QuotaService,
    private readonly openaiService: OpenAIService,
    private readonly cache: CommentCacheService,
  ) {}

  async getComments(videoId: string, channelId: string, accessToken: string, pageToken?: string, order: 'relevance' | 'time' = 'relevance') {
    if (!pageToken) {
      const cached = await this.cache.getThreads(videoId, order);
      const meta = await this.cache.getMeta(videoId);
      if (cached) return { comments: cached, totalCount: meta?.totalCount || cached.length, commentsDisabled: meta?.commentsDisabled || false, nextPageToken: null };
    }

    const result = await this.youtubeService.getCommentThreads(accessToken, videoId, pageToken, 100, order);
    if (result.commentsDisabled) {
      await this.cache.setMeta(videoId, { totalCount: 0, commentsDisabled: true });
      return { comments: [], totalCount: 0, commentsDisabled: true, nextPageToken: null };
    }

    if (!pageToken) {
      await this.cache.setThreads(videoId, result.comments, order);
      await this.cache.setMeta(videoId, { totalCount: result.totalResults || result.comments.length, commentsDisabled: false });
    }

    await this.quotaService.logCall({ channelId, endpoint: 'commentThreads.list', quotaCost: QUOTA_COST_COMMENT_THREADS, relatedId: videoId });
    return { comments: result.comments, totalCount: result.totalResults || result.comments.length, commentsDisabled: false, nextPageToken: result.nextPageToken };
  }

  async getReplies(videoId: string, commentId: string, channelId: string, accessToken: string, pageToken?: string) {
    if (!pageToken) {
      const cached = await this.cache.getReplies(videoId, commentId);
      if (cached) return { replies: cached, nextPageToken: null };
    }

    const result = await this.youtubeService.getCommentReplies(accessToken, commentId, pageToken);
    if (!pageToken) await this.cache.setReplies(videoId, commentId, result.replies);
    await this.quotaService.logCall({ channelId, endpoint: 'comments.list', quotaCost: QUOTA_COST_COMMENT_REPLIES, relatedId: commentId });
    return { replies: result.replies, nextPageToken: result.nextPageToken };
  }

  async syncComments(videoId: string, channelId: string, accessToken: string, order: 'relevance' | 'time' = 'relevance') {
    await this.cache.invalidate(videoId);
    const result = await this.youtubeService.getCommentThreads(accessToken, videoId, undefined, 100, order);
    if (result.commentsDisabled) {
      await this.cache.setMeta(videoId, { totalCount: 0, commentsDisabled: true });
      return { comments: [], totalCount: 0, commentsDisabled: true, nextPageToken: null };
    }
    await this.cache.setThreads(videoId, result.comments, order);
    await this.cache.setMeta(videoId, { totalCount: result.totalResults || result.comments.length, commentsDisabled: false });
    await this.quotaService.logCall({ channelId, endpoint: 'commentThreads.list', quotaCost: QUOTA_COST_COMMENT_THREADS, relatedId: videoId });
    return { comments: result.comments, totalCount: result.totalResults || result.comments.length, commentsDisabled: false, nextPageToken: result.nextPageToken };
  }

  async generateReply(commentText: string, videoTitle: string, channelName: string, channelId: string): Promise<string> {
    const systemPrompt = `You are replying to a YouTube comment on the channel "${channelName}".\n\nWrite a brief, engaging reply (2 sentences) in the voice of Unique Mecca Audio — dark, direct, street-wise, professorial. Acknowledge their point directly, then end your reply with an engaging, relevant follow-up question to spark further discussion with the commenter. Do not use emoji. Do not glorify crime or prison.`;
    const userMessage = `Video: ${videoTitle}\nComment: "${commentText}"`;
    return this.openaiService.chatFast({
      systemPrompt,
      userMessage,
      temperature: 0.7,
      maxCompletionTokens: 200,
    });
  }

  async postReply(videoId: string, parentId: string, text: string, channelId: string, accessToken: string) {
    const result = await this.youtubeService.insertCommentReply(accessToken, parentId, text);
    if (!result.mock) await this.quotaService.logCall({ channelId, endpoint: 'comments.insert', quotaCost: QUOTA_COST_COMMENT_INSERT, relatedId: videoId });
    return result;
  }
}
