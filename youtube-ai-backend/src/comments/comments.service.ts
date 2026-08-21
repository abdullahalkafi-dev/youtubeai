import { Injectable, Logger } from '@nestjs/common';
import { YouTubeService } from '../youtube/youtube.service';
import { QuotaService } from '../quota/quota.service';
import { OpenAIService } from '../openai/openai.service';
import { CommentCacheService } from './comment-cache.service';

const QUOTA_COST_COMMENT_THREADS = 2;
const QUOTA_COST_COMMENT_REPLIES = 2;
const QUOTA_COST_COMMENT_INSERT = 50;

export interface AiReplyOption {
  tone: 'General' | 'Humorous' | 'Thankful' | 'Witty' | 'Engaging';
  text: string;
  label: string;
}

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    private readonly youtubeService: YouTubeService,
    private readonly quotaService: QuotaService,
    private readonly openaiService: OpenAIService,
    private readonly cache: CommentCacheService,
  ) {}

  private enrichComments(comments: any[], channelYoutubeId?: string, channelName?: string) {
    return comments.map((thread) => {
      const replies = (thread.replies || []).map((r: any) => ({
        ...r,
        isCreatorReply:
          Boolean(channelYoutubeId && r.authorChannelId === channelYoutubeId) ||
          Boolean(channelName && r.authorName?.trim().toLowerCase() === channelName.trim().toLowerCase()),
      }));

      const hasCreatorReplied =
        replies.some((r: any) => r.isCreatorReply) ||
        Boolean(channelYoutubeId && thread.authorChannelId === channelYoutubeId);

      return {
        ...thread,
        replies,
        hasCreatorReplied,
      };
    });
  }

  async getComments(
    videoId: string,
    channelId: string,
    accessToken: string,
    pageToken?: string,
    order: 'relevance' | 'time' = 'relevance',
    channelYoutubeId?: string,
    channelName?: string,
  ) {
    if (!pageToken) {
      const cached = await this.cache.getThreads(videoId, order);
      const meta = await this.cache.getMeta(videoId);
      if (cached) {
        const enriched = this.enrichComments(cached, channelYoutubeId, channelName);
        return {
          comments: enriched,
          totalCount: meta?.totalCount || cached.length,
          commentsDisabled: meta?.commentsDisabled || false,
          nextPageToken: null,
        };
      }
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
    const enriched = this.enrichComments(result.comments, channelYoutubeId, channelName);
    return { comments: enriched, totalCount: result.totalResults || result.comments.length, commentsDisabled: false, nextPageToken: result.nextPageToken };
  }

  async getReplies(
    videoId: string,
    commentId: string,
    channelId: string,
    accessToken: string,
    pageToken?: string,
    channelYoutubeId?: string,
    channelName?: string,
  ) {
    if (!pageToken) {
      const cached = await this.cache.getReplies(videoId, commentId);
      if (cached) {
        const enrichedReplies = cached.map((r: any) => ({
          ...r,
          isCreatorReply:
            Boolean(channelYoutubeId && r.authorChannelId === channelYoutubeId) ||
            Boolean(channelName && r.authorName?.trim().toLowerCase() === channelName.trim().toLowerCase()),
        }));
        return { replies: enrichedReplies, nextPageToken: null };
      }
    }

    const result = await this.youtubeService.getCommentReplies(accessToken, commentId, pageToken);
    if (!pageToken) await this.cache.setReplies(videoId, commentId, result.replies);
    await this.quotaService.logCall({ channelId, endpoint: 'comments.list', quotaCost: QUOTA_COST_COMMENT_REPLIES, relatedId: commentId });
    
    const enrichedReplies = result.replies.map((r: any) => ({
      ...r,
      isCreatorReply:
        Boolean(channelYoutubeId && r.authorChannelId === channelYoutubeId) ||
        Boolean(channelName && r.authorName?.trim().toLowerCase() === channelName.trim().toLowerCase()),
    }));

    return { replies: enrichedReplies, nextPageToken: result.nextPageToken };
  }

  async syncComments(
    videoId: string,
    channelId: string,
    accessToken: string,
    order: 'relevance' | 'time' = 'relevance',
    channelYoutubeId?: string,
    channelName?: string,
  ) {
    await this.cache.invalidate(videoId);
    const result = await this.youtubeService.getCommentThreads(accessToken, videoId, undefined, 100, order);
    if (result.commentsDisabled) {
      await this.cache.setMeta(videoId, { totalCount: 0, commentsDisabled: true });
      return { comments: [], totalCount: 0, commentsDisabled: true, nextPageToken: null };
    }
    await this.cache.setThreads(videoId, result.comments, order);
    await this.cache.setMeta(videoId, { totalCount: result.totalResults || result.comments.length, commentsDisabled: false });
    await this.quotaService.logCall({ channelId, endpoint: 'commentThreads.list', quotaCost: QUOTA_COST_COMMENT_THREADS, relatedId: videoId });
    const enriched = this.enrichComments(result.comments, channelYoutubeId, channelName);
    return { comments: enriched, totalCount: result.totalResults || result.comments.length, commentsDisabled: false, nextPageToken: result.nextPageToken };
  }

  /**
   * Generates 5 distinct reply variations across different tones with counter-questions.
   */
  async generateReplies(
    commentText: string,
    videoTitle: string,
    channelName: string,
    channelId: string,
  ): Promise<AiReplyOption[]> {
    const systemPrompt = `You are an expert YouTube community manager and AI copywriter for the YouTube channel "${channelName}".
Your task is to generate exactly 5 distinct reply variations to the viewer's comment, each with a unique tone.
EVERY reply MUST end with a natural, conversational counter-question to provoke the viewer to reply back and boost YouTube algorithm engagement.

Generate responses for these 5 tones:
1. "General": Natural, friendly, polite, acknowledging the comment directly, ending with a relevant question.
2. "Humorous": Playful, witty, upbeat, with relevant emojis (e.g. 😜, 🔥, 👑, 🎬), making a funny/lighthearted observation before asking a question.
3. "Thankful": Warm, heartfelt appreciation for their support and time, with appreciative emojis (🙏, ❤️), followed by an engaging question.
4. "Witty": Clever, direct, street-wise professorial tone (Unique Mecca Audio voice), sharp insight, ending with a thought-provoking counter-question.
5. "Engaging": High-curiosity question-driven reply designed specifically to start a deeper discussion in the comments section.

Format output:
Respond with ONLY a valid JSON array of 5 objects with keys:
- "tone": (one of: "General", "Humorous", "Thankful", "Witty", "Engaging")
- "label": (human-readable tone label)
- "text": (the reply message string, 1-3 sentences max)

Do not include markdown codeblocks or extra explanations.`;

    const userMessage = `Video Title: "${videoTitle}"\nViewer Comment: "${commentText}"`;

    try {
      const raw = await this.openaiService.chatFast({
        systemPrompt,
        userMessage,
        temperature: 0.75,
        maxCompletionTokens: 600,
      });

      const parsed = this.parseJsonReplies(raw);
      if (parsed && parsed.length >= 3) {
        return parsed;
      }
    } catch (error: any) {
      this.logger.warn(`Failed to generate multi-tone replies: ${error?.message || error}`);
    }

    // High quality contextual fallback templates
    return [
      {
        tone: 'General',
        label: 'General',
        text: `Thank you so much! It's always a pleasure to create content that you find educational. Which part of "${videoTitle}" stood out to you most?`,
      },
      {
        tone: 'Humorous',
        label: 'Humorous',
        text: `My content so good it made you learn twice! 😜 Glad you're enjoying the Mecca Audio experience! What topic should we tackle next?`,
      },
      {
        tone: 'Thankful',
        label: 'Thankful',
        text: `I truly appreciate your words and support! 🙏 It means a lot to know you love the content. How long have you been following the channel?`,
      },
      {
        tone: 'Witty',
        label: 'Witty',
        text: `Phenomenal content and a pleasure to learn from? Sounds like we're doing something right! What's the #1 takeaway you got from this one?`,
      },
      {
        tone: 'Engaging',
        label: 'Engaging',
        text: `Aww, thanks! So glad you're loving the videos and finding value here. Are you applying any of these tips to your own setup?`,
      },
    ];
  }

  /**
   * Backwards compatible single-string generator.
   */
  async generateReply(commentText: string, videoTitle: string, channelName: string, channelId: string): Promise<string> {
    const replies = await this.generateReplies(commentText, videoTitle, channelName, channelId);
    return replies[0]?.text || 'Thank you for watching!';
  }

  private parseJsonReplies(raw: string): AiReplyOption[] | null {
    try {
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
          .map((item: any) => ({
            tone: item.tone || 'General',
            label: item.label || item.tone || 'General',
            text: String(item.text || '').trim(),
          }))
          .filter((i: any) => i.text.length > 0);
      }
    } catch {
      const match = raw.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (match) {
        try {
          const parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed)) {
            return parsed
              .map((item: any) => ({
                tone: item.tone || 'General',
                label: item.label || item.tone || 'General',
                text: String(item.text || '').trim(),
              }))
              .filter((i: any) => i.text.length > 0);
          }
        } catch {}
      }
    }
    return null;
  }

  async postReply(videoId: string, parentId: string, text: string, channelId: string, accessToken: string) {
    const result = await this.youtubeService.insertCommentReply(accessToken, parentId, text);
    if (!result.mock) {
      await this.quotaService.logCall({
        channelId,
        endpoint: 'comments.insert',
        quotaCost: QUOTA_COST_COMMENT_INSERT,
        relatedId: videoId,
      });
    }
    return result;
  }
}
