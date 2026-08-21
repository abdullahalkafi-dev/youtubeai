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
   * Generates 5 distinct, highly-contextual reply variations with counter-questions.
   */
  async generateReplies(
    commentText: string,
    videoTitle: string,
    channelName: string,
    channelId: string,
    videoDescription?: string,
  ): Promise<AiReplyOption[]> {
    const contextPrompt = videoDescription
      ? `Video Title: "${videoTitle}"\nVideo Summary: "${videoDescription.slice(0, 300)}"\nViewer Comment: "${commentText}"`
      : `Video Title: "${videoTitle}"\nViewer Comment: "${commentText}"`;

    const systemPrompt = `You are an expert YouTube community manager and content creator for "${channelName}".
Your mission is to craft 5 authentic, contextual replies to the viewer's specific comment.

CRITICAL GUIDELINES:
1. SPECIFICITY: Directly analyze and address the specific point, argument, or question in the viewer's comment. If they discuss legal rights, trials, prison systems, specific people, or quotes, engage directly on that topic.
2. NO GENERIC FLUFF: Do not use generic phrases like "thanks for watching", "enjoying the experience", or "applying tips to your setup" unless the comment is specifically about that.
3. COUNTER-QUESTION: Every single reply MUST conclude with a natural, conversational counter-question on the topic to provoke the viewer to reply back and boost YouTube algorithm engagement.
4. Channel Voice: Direct, thoughtful, authentic, intelligent, street-wise professorial tone (Unique Mecca Audio style).

Generate exactly 5 distinct tone variations:
1. "General": Thoughtful, direct, balanced perspective on their comment + relevant discussion question.
2. "Humorous": Clever, witty, lighthearted with relevant emojis (e.g. 😜, 🔥, 👑, 🎬) while staying focused on the topic + a funny/sharp question.
3. "Thankful": Genuine appreciation for their specific perspective or deep point (🙏, ❤️) + an insightful follow-up question.
4. "Witty": Sharp, street-wise, confident analysis of their statement + a provocative counter-question.
5. "Engaging": High-curiosity question specifically exploring or challenging their viewpoint further.

OUTPUT FORMAT:
Respond with ONLY a valid JSON array of 5 objects with keys:
- "tone": ("General" | "Humorous" | "Thankful" | "Witty" | "Engaging")
- "label": (human readable tone name)
- "text": (1 to 3 concise sentences)

Do not include markdown codeblocks or extra text.`;

    try {
      const raw = await this.openaiService.chatFast({
        systemPrompt,
        userMessage: contextPrompt,
        maxCompletionTokens: 1200,
      });

      const parsed = this.parseJsonReplies(raw);
      if (parsed && parsed.length >= 3) {
        return parsed;
      }
    } catch (error: any) {
      this.logger.warn(`Failed to generate multi-tone replies: ${error?.message || error}`);
    }

    // Dynamic contextual fallbacks that reference the comment text
    const snippet = commentText.length > 50 ? `${commentText.slice(0, 45)}...` : commentText;
    return [
      {
        tone: 'General',
        label: 'General',
        text: `You bring up an important point regarding "${snippet}". What do you think is the biggest factor at play here?`,
      },
      {
        tone: 'Humorous',
        label: 'Humorous',
        text: `That's one way to look at it! 😜 Do you think others seeing this situation would agree with your take?`,
      },
      {
        tone: 'Thankful',
        label: 'Thankful',
        text: `Appreciate you sharing your perspective on this! 🙏 What specific part of this story stood out most to you?`,
      },
      {
        tone: 'Witty',
        label: 'Witty',
        text: `Real talk right there. When you look at the deeper facts, how do you see this playing out next?`,
      },
      {
        tone: 'Engaging',
        label: 'Engaging',
        text: `That's a crucial angle. If you were in their shoes, what decision would you have made differently?`,
      },
    ];
  }

  /**
   * Backwards compatible single-string generator.
   */
  async generateReply(
    commentText: string,
    videoTitle: string,
    channelName: string,
    channelId: string,
    videoDescription?: string,
  ): Promise<string> {
    const replies = await this.generateReplies(commentText, videoTitle, channelName, channelId, videoDescription);
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
