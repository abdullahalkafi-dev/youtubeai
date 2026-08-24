import { Injectable, Logger } from '@nestjs/common';
import { YouTubeService } from '../youtube/youtube.service';
import { QuotaService } from '../quota/quota.service';
import { OpenAIService } from '../openai/openai.service';
import { CommentCacheService } from './comment-cache.service';

const QUOTA_COST_COMMENT_THREADS = 2;
const QUOTA_COST_COMMENT_REPLIES = 2;
const QUOTA_COST_COMMENT_INSERT = 50;

export type ReplyTone =
  | 'General'
  | 'Humorous'
  | 'Thankful'
  | 'Witty'
  | 'Informal'
  | 'Thoughtful and Balanced'
  | 'Sharp and Lighthearted'
  | 'Appreciative and Reflective'
  | 'Street-Wise and Provocative'
  | 'Curious and Challenging';

export interface AiReplyOption {
  tone: ReplyTone | string;
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
   * Generates 10 distinct, highly-contextual reply variations matching standard tone types:
   * General, Humorous, Thankful, Witty, Informal, Thoughtful and Balanced, Sharp and Lighthearted,
   * Appreciative and Reflective, Street-Wise and Provocative, Curious and Challenging
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
Your mission is to craft 10 authentic, contextual replies to the viewer's specific comment.

CRITICAL GUIDELINES:
1. SPECIFICITY: Directly analyze and address the specific point, argument, or question in the viewer's comment. If they discuss legal rights, trials, prison systems, specific people, or quotes, engage directly on that topic.
2. NO GENERIC FLUFF: Do not use generic phrases like "thanks for watching", "enjoying the experience", or "applying tips to your setup" unless the comment is specifically about that.
3. COUNTER-QUESTION: Every single reply MUST conclude with a natural, conversational counter-question on the topic to provoke the viewer to reply back and boost YouTube algorithm engagement.
4. Channel Voice: Direct, thoughtful, authentic, intelligent, street-wise professorial tone (Unique Mecca Audio style).

Generate exactly 10 distinct tone variations with these exact 10 types:
1. "General": Thoughtful, direct, balanced perspective on their comment + relevant discussion question.
2. "Humorous": Clever, witty, lighthearted with relevant emojis (e.g. 😜, 🔥, 👑, 🎬) while staying focused on the topic + a funny/sharp question.
3. "Thankful": Genuine appreciation for their specific perspective or deep point (🙏, ❤️) + an insightful follow-up question.
4. "Witty": Sharp, street-wise, confident analysis of their statement + a provocative counter-question.
5. "Informal": Casual, friendly, warm, conversational everyday chat tone (e.g. "Aww thanks!", "Appreciate you!", "Super cool you noticed that!") + an engaging conversational question.
6. "Thoughtful and Balanced": Deeply analytical, empathetic to nuances, balancing multiple sides (e.g. justice vs. rehabilitation, legal realities vs. human impact) + a balanced reflective counter-question.
7. "Sharp and Lighthearted": Crisp, witty, playful metaphor/reality check (e.g. "no magic courtroom trapdoor labeled 'undo'") with emojis + a thought-provoking boundary question.
8. "Appreciative and Reflective": Empathetic recognition of key distinctions made by the commenter (🙏) + a deep condition/perspective question.
9. "Street-Wise and Provocative": Hard-hitting, raw, street-smart reality check cutting straight through legal and societal tensions + a provocative systemic question.
10. "Curious and Challenging": Intellectually probing, teasing apart two questions people often collapse together + a challenging prioritization/weight counter-question.

OUTPUT FORMAT:
Respond with ONLY a valid JSON array of 10 objects with keys:
- "tone": ("General" | "Humorous" | "Thankful" | "Witty" | "Informal" | "Thoughtful and Balanced" | "Sharp and Lighthearted" | "Appreciative and Reflective" | "Street-Wise and Provocative" | "Curious and Challenging")
- "label": ("General" | "Humorous" | "Thankful" | "Witty" | "Informal" | "Thoughtful and Balanced" | "Sharp and Lighthearted" | "Appreciative and Reflective" | "Street-Wise and Provocative" | "Curious and Challenging")
- "text": (1 to 3 concise sentences)

Do not include markdown codeblocks or extra text.`;

    try {
      const raw = await this.openaiService.chatFast({
        systemPrompt,
        userMessage: contextPrompt,
        maxCompletionTokens: 2500,
      });

      const parsed = this.parseJsonReplies(raw);
      if (parsed && parsed.length >= 5) {
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
        tone: 'Informal',
        label: 'Informal',
        text: `Aww, thanks! So glad you noticed that about "${snippet}". What stood out to you the most?`,
      },
      {
        tone: 'Thoughtful and Balanced',
        label: 'Thoughtful and Balanced',
        text: `That captures the psychological weight of this situation regarding "${snippet}". What kind of outcome would you consider accountable while still fair?`,
      },
      {
        tone: 'Sharp and Lighthearted',
        label: 'Sharp and Lighthearted',
        text: `There's no magic button labeled "undo" here 😜. If things change moving forward, where would you draw the line between justice and retribution?`,
      },
      {
        tone: 'Appreciative and Reflective',
        label: 'Appreciative and Reflective',
        text: `You made an important distinction regarding "${snippet}" 🙏. What conditions do you believe would best reflect true accountability?`,
      },
      {
        tone: 'Street-Wise and Provocative',
        label: 'Street-Wise and Provocative',
        text: `Real consequences don't disappear just because circumstances shift. Is this the exact balance the system keeps failing to find?`,
      },
      {
        tone: 'Curious and Challenging',
        label: 'Curious and Challenging',
        text: `Your position separates two questions people often collapse together. When looking at all the details, which factor should carry the most weight?`,
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

  private normalizeTone(rawTone?: string): ReplyTone {
    const t = String(rawTone || '').trim().toLowerCase();

    // Check composite tones first
    if (t.includes('thoughtful') || (t.includes('balanced') && !t.includes('general'))) return 'Thoughtful and Balanced';
    if (t.includes('sharp') || (t.includes('light') && t.includes('heart'))) return 'Sharp and Lighthearted';
    if (t.includes('appreciat') || (t.includes('reflect') && !t.includes('thankful'))) return 'Appreciative and Reflective';
    if (t.includes('street') || t.includes('provoc')) return 'Street-Wise and Provocative';
    if (t.includes('curious') || t.includes('challeng')) return 'Curious and Challenging';

    // Standard 5 tones
    if (t.includes('humor') || t.includes('funny') || t.includes('joke')) return 'Humorous';
    if (t.includes('thank') || t.includes('grat')) return 'Thankful';
    if (t.includes('wit')) return 'Witty';
    if (t.includes('informal') || t.includes('casual') || t.includes('friend')) return 'Informal';

    return 'General';
  }

  private parseJsonReplies(raw: string): AiReplyOption[] | null {
    try {
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
          .map((item: any) => {
            const canonicalTone = this.normalizeTone(item.tone || item.label);
            return {
              tone: canonicalTone,
              label: canonicalTone,
              text: String(item.text || '').trim(),
            };
          })
          .filter((i: any) => i.text.length > 0);
      }
    } catch {
      const match = raw.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (match) {
        try {
          const parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed)) {
            return parsed
              .map((item: any) => {
                const canonicalTone = this.normalizeTone(item.tone || item.label);
                return {
                  tone: canonicalTone,
                  label: canonicalTone,
                  text: String(item.text || '').trim(),
                };
              })
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
