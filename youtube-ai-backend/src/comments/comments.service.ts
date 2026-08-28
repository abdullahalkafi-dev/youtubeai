import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Video, VideoDocument } from '../mongo/schemas/video.schema';
import { Channel, ChannelDocument } from '../mongo/schemas/channel.schema';
import { AutomationBatch, AutomationBatchDocument } from '../mongo/schemas/automation-batch.schema';
import { YouTubeService } from '../youtube/youtube.service';
import { QuotaService } from '../quota/quota.service';
import { OpenAIService } from '../openai/openai.service';
import { CommentCacheService } from './comment-cache.service';
import {
  COMMENT_CHUNK_SIZE,
  COMMENT_PUSH_SAFETY_GAP_MS,
  DEFAULT_COMMENT_DAILY_CAP,
  QUOTA_COST_COMMENT_INSERT,
} from '../automation/automation.constants';

const QUOTA_COST_COMMENT_THREADS = 2;
const QUOTA_COST_COMMENT_REPLIES = 2;

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
    @InjectModel(Video.name) private readonly videoModel: Model<VideoDocument>,
    @InjectModel(Channel.name) private readonly channelModel: Model<ChannelDocument>,
    @InjectModel(AutomationBatch.name) private readonly batchModel: Model<AutomationBatchDocument>,
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

  /**
   * Generates batch replies for up to 10 comments in 1 OpenAI call with spam defense.
   */
  async generateBatchReplies(
    comments: Array<{ commentId: string; authorName: string; text: string }>,
    videoTitle: string,
    channelName: string,
    videoDescription?: string,
  ): Promise<Array<{
    commentId: string;
    action: 'reply' | 'skip';
    skipReason?: string;
    tone?: string;
    replyText?: string;
  }>> {
    if (!comments || comments.length === 0) return [];

    const systemPrompt = `You are the official YouTube community engagement agent for "${channelName}" (Unique Mecca Audio).
Your mission is to craft authentic, contextual replies for each viewer comment or determine if a comment is spam/promotional bot and should be skipped.

CORE PERSONA & VOICE:
- Direct, thoughtful, street-wise professorial perspective (Unique Mecca Audio style).
- Authentic, intelligent, grounded in real-life consequences, street reality, legal accountability, and personal growth.
- Host: Wainsworth "Unique" Hall.
- Every reply MUST conclude with a natural, conversational counter-question on the topic to provoke the viewer to reply back and boost YouTube algorithm engagement.
- Tone Variety: Adaptively select one of: "Street-Wise and Provocative", "Thoughtful and Balanced", "Witty", "Appreciative and Reflective", "General", "Thankful".

SPAM & BOT FILTERING:
- If a comment is spam, crypto scam, promotional link, whatsapp number, or bot copypasta, set "action": "skip" and "skipReason": "spam".
- If it is a real viewer question, reaction, or statement, set "action": "reply".

OUTPUT FORMAT:
Respond with ONLY a valid JSON array of objects matching each input comment:
[
  {
    "commentId": "string",
    "action": "reply" or "skip",
    "skipReason": "string (optional)",
    "tone": "string (optional)",
    "replyText": "1-3 sentences in Unique Mecca Audio voice ending with an engagement counter-question"
  }
]`;

    const userMessage = `Video Title: "${videoTitle}"
Video Summary: "${(videoDescription || '').slice(0, 400)}"

Viewer Comments to Process:
${JSON.stringify(comments.map((c) => ({ commentId: c.commentId, author: c.authorName, text: c.text })), null, 2)}`;

    try {
      const raw = await this.openaiService.chatFast({
        systemPrompt,
        userMessage,
        maxCompletionTokens: 3000,
      });

      const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((item: any) => ({
          commentId: String(item.commentId || ''),
          action: item.action === 'skip' ? 'skip' : 'reply',
          skipReason: item.skipReason,
          tone: this.normalizeTone(item.tone),
          replyText: String(item.replyText || '').trim(),
        }));
      }
    } catch (err: any) {
      this.logger.warn(`Batch reply AI generation parsing failed: ${err.message}. Falling back to single-comment generator.`);
    }

    // Fallback if batch parsing fails
    const fallbackResults = [];
    for (const c of comments) {
      try {
        const replies = await this.generateReplies(c.text, videoTitle, channelName, '', videoDescription);
        fallbackResults.push({
          commentId: c.commentId,
          action: 'reply' as const,
          tone: replies[0]?.tone || 'General',
          replyText: replies[0]?.text || `Appreciate your perspective on "${videoTitle}". How do you see this playing out?`,
        });
      } catch {
        fallbackResults.push({
          commentId: c.commentId,
          action: 'skip' as const,
          skipReason: 'AI generation error',
        });
      }
    }
    return fallbackResults;
  }

  /**
   * Processes all unreplied comments for a single video in 10-comment chunks until complete.
   */
  async processSingleVideoAutoReplies(
    videoId: string | Types.ObjectId,
    channelId: string,
    remainingDailyCap: number = DEFAULT_COMMENT_DAILY_CAP,
  ): Promise<{
    processedCount: number;
    skippedCount: number;
    failedCount: number;
    batchId?: string;
  }> {
    const video = await this.videoModel.findById(videoId);
    if (!video || !video.youtubeId) {
      return { processedCount: 0, skippedCount: 0, failedCount: 0 };
    }

    const channel = await this.channelModel.findById(channelId).lean();
    if (!channel?.userId) {
      return { processedCount: 0, skippedCount: 0, failedCount: 0 };
    }

    let accessToken: string | null = null;
    try {
      accessToken = await this.youtubeService.getValidAccessToken(channel.userId.toString());
    } catch (err: any) {
      this.logger.error(`Failed to get YouTube access token for channel ${channelId}: ${err.message}`);
      return { processedCount: 0, skippedCount: 0, failedCount: 0 };
    }

    // Fetch top-level comments with order: 'time' (newest first)
    const threadsRes = await this.getComments(
      video.youtubeId,
      channelId,
      accessToken,
      undefined,
      'time',
      channel.youtubeChannelId,
      channel.name,
    );

    if (threadsRes.commentsDisabled || !threadsRes.comments || threadsRes.comments.length === 0) {
      await this.videoModel.findByIdAndUpdate(video._id, {
        $set: { autoReplyLastRanAt: new Date() },
      });
      return { processedCount: 0, skippedCount: 0, failedCount: 0 };
    }

    const repliedSet = new Set(video.repliedCommentIds || []);
    const unresponded = threadsRes.comments.filter(
      (t) => !t.hasCreatorReplied && !repliedSet.has(t.id),
    );

    if (unresponded.length === 0) {
      await this.videoModel.findByIdAndUpdate(video._id, {
        $set: { autoReplyLastRanAt: new Date() },
      });
      return { processedCount: 0, skippedCount: 0, failedCount: 0 };
    }

    // Cap total comments by remaining daily quota
    const targetComments = unresponded.slice(0, remainingDailyCap);

    // Create 1 unified AutomationBatch document for this video run
    const batchDoc = await this.batchModel.create({
      channelId: new Types.ObjectId(channelId),
      type: 'comment_reply',
      source: 'auto_cron_batch',
      status: 'generating',
      totalItems: targetComments.length,
      successfulItems: 0,
      failedItems: 0,
      skippedItems: 0,
      quotaUnitsUsed: 0,
      startedAt: new Date(),
      lastHeartbeatAt: new Date(),
      items: targetComments.map((t) => ({
        videoId: video._id,
        youtubeId: video.youtubeId,
        originalTitle: video.title,
        commentId: t.id,
        authorName: t.authorName || 'Viewer',
        commentText: t.text || '',
        status: 'queued',
        batchLockTimestamp: new Date(),
      })),
    });

    let successfulCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const newlyRepliedIds: string[] = [];

    // Process in chunks of up to 10 comments
    for (let offset = 0; offset < targetComments.length; offset += COMMENT_CHUNK_SIZE) {
      const chunk = targetComments.slice(offset, offset + COMMENT_CHUNK_SIZE);
      const commentsForAi = chunk.map((c) => ({
        commentId: c.id,
        authorName: c.authorName || 'Viewer',
        text: c.text || '',
      }));

      const aiReplies = await this.generateBatchReplies(
        commentsForAi,
        video.title,
        channel.name,
        video.description,
      );

      for (let i = 0; i < chunk.length; i++) {
        const comment = chunk[i];
        const batchItemIndex = offset + i;
        const aiRes = aiReplies.find((r) => r.commentId === comment.id);

        if (!aiRes || aiRes.action === 'skip') {
          batchDoc.items[batchItemIndex].status = 'skipped_spam';
          batchDoc.items[batchItemIndex].skipReason = aiRes?.skipReason || 'Spam/bot comment';
          batchDoc.items[batchItemIndex].processedAt = new Date();
          skippedCount++;
          continue;
        }

        // Push reply to YouTube
        try {
          await this.postReply(video.youtubeId, comment.id, aiRes.replyText!, channelId, accessToken);
          batchDoc.items[batchItemIndex].status = 'completed';
          batchDoc.items[batchItemIndex].generatedReply = aiRes.replyText;
          batchDoc.items[batchItemIndex].tone = aiRes.tone;
          batchDoc.items[batchItemIndex].processedAt = new Date();
          newlyRepliedIds.push(comment.id);
          successfulCount++;
          batchDoc.quotaUnitsUsed += QUOTA_COST_COMMENT_INSERT;

          // 3-second safety gap
          await new Promise((resolve) => setTimeout(resolve, COMMENT_PUSH_SAFETY_GAP_MS));
        } catch (pushErr: any) {
          this.logger.error(`Failed to post auto-reply to comment ${comment.id} on video ${video.youtubeId}: ${pushErr.message}`);
          batchDoc.items[batchItemIndex].status = 'failed';
          batchDoc.items[batchItemIndex].error = pushErr.message;
          batchDoc.items[batchItemIndex].processedAt = new Date();
          failedCount++;
        }
      }
    }

    // Finalize AutomationBatch
    batchDoc.successfulItems = successfulCount;
    batchDoc.skippedItems = skippedCount;
    batchDoc.failedItems = failedCount;
    batchDoc.status = failedCount === 0 && successfulCount > 0 ? 'completed' : successfulCount > 0 ? 'partial' : 'failed';
    batchDoc.completedAt = new Date();
    await batchDoc.save();

    // Atomically update Video document
    await this.videoModel.findByIdAndUpdate(video._id, {
      $addToSet: { repliedCommentIds: { $each: newlyRepliedIds } },
      $inc: { autoReplyTotalCount: newlyRepliedIds.length },
      $set: { autoReplyLastRanAt: new Date() },
    });

    // Invalidate comment cache for video
    await this.cache.invalidate(video.youtubeId);

    this.logger.log(`[Auto-Comment Batch ${batchDoc._id}] Video ${video.youtubeId}: ${successfulCount} replies posted, ${skippedCount} skipped, ${failedCount} failed.`);

    return {
      processedCount: successfulCount,
      skippedCount,
      failedCount,
      batchId: batchDoc._id.toString(),
    };
  }
}
