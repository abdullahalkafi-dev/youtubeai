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
import { QuotaExceededException } from '../quota/quota.service';

const QUOTA_COST_COMMENT_THREADS = 1; // official YouTube quota: commentThreads.list = 1 unit
const QUOTA_COST_COMMENT_REPLIES = 1; // official YouTube quota: comments.list = 1 unit

function isBudgetOrQuotaStop(err: any): boolean {
  if (err instanceof QuotaExceededException) return true;
  if (err?.name === 'QuotaExceededException' || err?.reason === 'quotaExceeded') return true;
  return /quota|comments daily budget/i.test(String(err?.message || err || ''));
}

function isCommentsBudgetOnly(err: any): boolean {
  return err?.scope === 'comments_budget' || /comments daily budget/i.test(String(err?.message || ''));
}

/** True for errors where retrying the same comment will never work. */
function isPermanentCommentFailure(err: any): boolean {
  const m = String(err?.message || err || '');
  if (isBudgetOrQuotaStop(err)) return false;
  if (/api server failed|backend error|internal error|timed? ?out|econnreset|socket hang up|temporarily|unavailable|502|503|504/i.test(m)) {
    return false;
  }
  return /commentsdisabled|comments disabled|disabled comments|comment.*disabled|comment.*deleted|forbidden|unauthorized|invalid.*parent|disabled/i.test(m);
}

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

    await this.quotaService.checkCommentsBudget(channelId, 'commentThreads.list', QUOTA_COST_COMMENT_THREADS);
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

    await this.quotaService.checkCommentsBudget(channelId, 'comments.list', QUOTA_COST_COMMENT_REPLIES);
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
    await this.quotaService.checkCommentsBudget(channelId, 'commentThreads.list', QUOTA_COST_COMMENT_THREADS);
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

    const systemPrompt = `You are the official YouTube community voice for "${channelName}" (Unique Mecca Audio).
You craft 10 authentic reply options to the viewer's specific comment as Unique Mecca Audio — a 62-year-old former federal prisoner from Harlem who spent 26 years inside (1993–2020) on a life-plus-20 sentence. You are a street psychiatrist speaking from lived experience, not a corporate debater or defense lawyer.

CRITICAL VOICE & STYLE RULES:
1. NEVER USE EM-DASHES ("—") OR EN-DASHES ("–"): Never output "—" or "–" under ANY circumstances. Use commas, periods, or ellipses ("...").
2. NO ROBOTIC DEBATE PHRASES: Never say "I hear you, but...", "I understand the analogy...", "That's the blunt version...", "legally and factually...", "criminal liability...", "assigned protection...".
3. STREET OG RHYTHM: Short, punchy sentences (under 15 words each). Use natural contractions ("don't", "ain't", "can't", "won't").
4. REAL VOCABULARY: "paperwork", "receipts", "in the feds", "salute", "facts", "stay sharp", "real talk", "5K1", "my brother".
5. HOST IDENTITY: Host is Unique (Unique Mecca Audio). NEVER use the private personal names "Wainsworth" or "Hall".

Generate exactly 10 distinct tone variations with these exact 10 types:
1. "General": Direct Harlem street OG perspective cutting straight through the noise to the consequence.
2. "Humorous": Witty, street-smart reality check with relevant emojis (e.g. 😜, 😂, 💯, 👑).
3. "Thankful": Genuine elder appreciation for their support or sharp eye (🙏, 💯, "Salute my brother").
4. "Witty": Sharp, confident breakdown cutting through street rumors vs reality.
5. "Informal": Warm, casual everyday conversation ("Salute! Appreciate you noticing that.").
6. "Thoughtful and Balanced": Deep psychological perspective contrasting street perception vs courtroom/prison reality.
7. "Sharp and Lighthearted": Crisp street wisdom with a smile (no courtroom undo buttons here).
8. "Appreciative and Reflective": Recognizing someone who really understands the lived reality of these situations.
9. "Street-Wise and Provocative": Hard-hitting reality check from 26 years inside about consequences and code.
10. "Curious and Challenging": A sharp street-level question probing whether people stand on what they say when pressure comes down.

OUTPUT FORMAT:
Respond with ONLY a valid JSON array of 10 objects with keys:
- "tone": ("General" | "Humorous" | "Thankful" | "Witty" | "Informal" | "Thoughtful and Balanced" | "Sharp and Lighthearted" | "Appreciative and Reflective" | "Street-Wise and Provocative" | "Curious and Challenging")
- "label": ("General" | "Humorous" | "Thankful" | "Witty" | "Informal" | "Thoughtful and Balanced" | "Sharp and Lighthearted" | "Appreciative and Reflective" | "Street-Wise and Provocative" | "Curious and Challenging")
- "text": (1 to 2 punchy sentences, zero em-dashes)

Do not include markdown codeblocks or extra text.`;

    try {
      const raw = await this.openaiService.chatFast({
        systemPrompt,
        userMessage: contextPrompt,
        temperature: 0.7,
        maxCompletionTokens: 2500,
      });

      const parsed = this.parseJsonReplies(raw);
      if (parsed && parsed.length >= 5) {
        return parsed;
      }
    } catch (error: any) {
      this.logger.warn(`Failed to generate multi-tone replies: ${error?.message || error}`);
    }

    // Dynamic contextual fallbacks in authentic Unique Mecca Audio voice
    const snippet = commentText.length > 50 ? `${commentText.slice(0, 45)}...` : commentText;
    return [
      {
        tone: 'General',
        label: 'General',
        text: `Streets and courtrooms speak two different languages. Respect for sharing your take on "${snippet}".`,
      },
      {
        tone: 'Humorous',
        label: 'Humorous',
        text: `Gotta laugh to keep from crying in this game! 😂 Stay sharp out here.`,
      },
      {
        tone: 'Thankful',
        label: 'Thankful',
        text: `Salute my brother! Appreciate you tapping in with the real talk. 🙏`,
      },
      {
        tone: 'Witty',
        label: 'Witty',
        text: `Paperwork don't lie, but people do every single day. Facts.`,
      },
      {
        tone: 'Informal',
        label: 'Informal',
        text: `Salute! Glad you noticed that about "${snippet}". Stay tuned, more coming.`,
      },
      {
        tone: 'Thoughtful and Balanced',
        label: 'Thoughtful and Balanced',
        text: `There's what the streets think happened, and what was signed on that 5K1 letter. Two very different worlds.`,
      },
      {
        tone: 'Sharp and Lighthearted',
        label: 'Sharp and Lighthearted',
        text: `No magic trapdoors in federal court 😜. When that gavel hits, reality sets in fast.`,
      },
      {
        tone: 'Appreciative and Reflective',
        label: 'Appreciative and Reflective',
        text: `Real recognition right there. Only people who lived through heavy pressure understand how fast things turn.`,
      },
      {
        tone: 'Street-Wise and Provocative',
        label: 'Street-Wise and Provocative',
        text: `In the feds, they don't give time off for good intentions. What's done is done. 💯`,
      },
      {
        tone: 'Curious and Challenging',
        label: 'Curious and Challenging',
        text: `Everybody claims they'll stand tall until that 30-year sentence is sitting in front of them. What you think?`,
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

  /**
   * Deterministically sanitizes AI-generated reply text:
   * - Eliminates all em-dashes (—) and en-dashes (–)
   * - Strips accidental wrapping quotes
   * - Cleans double punctuation and excessive whitespace
   */
  cleanReplyText(text: string): string {
    if (!text) return '';
    return text
      // Replace em-dash / en-dash with comma or clean punctuation
      .replace(/[\u2014\u2013—–]/g, ', ')
      // Strip outer quotes if the model wrapped the response in quotes
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
      // Fix double punctuation caused by dash replacements
      .replace(/,\s*,/g, ',')
      .replace(/,\s*\./g, '.')
      .replace(/\.\s*,/g, '.')
      .replace(/\s{2,}/g, ' ')
      .trim();
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
              text: this.cleanReplyText(String(item.text || '')),
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
                  text: this.cleanReplyText(String(item.text || '')),
                };
              })
              .filter((i: any) => i.text.length > 0);
          }
        } catch {}
      }
    }
    return null;
  }

  async postReply(
    videoId: string,
    parentId: string,
    text: string,
    channelId: string,
    accessToken: string,
    options?: { source?: 'auto' | 'manual' },
  ) {
    // 'auto' = AI auto-reply pipeline. 'manual' = creator UI reply.
    // Only manual replies may stamp batch items as Creator Manual Response.
    const source = options?.source === 'auto' ? 'auto' : 'manual';
    const replyBody = this.cleanReplyText(String(text || ''));
    if (!replyBody) {
      throw new Error('Reply text is empty');
    }
    await this.quotaService.checkCommentsBudget(channelId, 'comments.insert', QUOTA_COST_COMMENT_INSERT);
    const result = await this.youtubeService.insertCommentReply(accessToken, parentId, replyBody);
    if (!result.mock) {
      await this.quotaService.logCall({
        channelId,
        endpoint: 'comments.insert',
        quotaCost: QUOTA_COST_COMMENT_INSERT,
        relatedId: videoId,
      });
    }

    if (source === 'manual') {
      // Reconcile batch items only for true creator/manual replies
      try {
        const cId = Types.ObjectId.isValid(channelId) ? new Types.ObjectId(channelId) : channelId;
        await this.batchModel.updateMany(
          {
            channelId: cId,
            type: 'comment_reply',
            'items.commentId': parentId,
          },
          {
            $set: {
              'items.$[elem].status': 'handled_manually',
              'items.$[elem].manualReplyText': replyBody,
              'items.$[elem].processedAt': new Date(),
            },
          },
          {
            arrayFilters: [{ 'elem.commentId': parentId }],
          },
        );

        await this.markCommentReplied(videoId, parentId);
      } catch (reconcileErr: any) {
        this.logger.warn(`Failed to reconcile batch status on manual reply: ${reconcileErr.message}`);
      }
    } else {
      // AI auto-reply: mark comment as replied. Do NOT write manualReplyText / handled_manually.
      try {
        await this.markCommentReplied(videoId, parentId);
      } catch (reconcileErr: any) {
        this.logger.warn(`Failed to mark repliedCommentIds on auto reply: ${reconcileErr.message}`);
      }
    }

    return result;
  }

  /**
   * Mark a comment as answered. Accepts either the Mongo video _id (UI route)
   * or the YouTube video id (auto pipeline) — H1.
   */
  private async markCommentReplied(videoIdOrObjectId: string, parentId: string) {
    const or: any[] = [{ youtubeId: videoIdOrObjectId }];
    if (Types.ObjectId.isValid(videoIdOrObjectId)) {
      or.push({ _id: new Types.ObjectId(videoIdOrObjectId) });
    }
    await this.videoModel.findOneAndUpdate({ $or: or }, { $addToSet: { repliedCommentIds: parentId } });
  }

  /**
   * True when the comment @-mentions THIS channel (not other users).
   * Matches @handle / +handle / youtube.com/@handle.
   */
  private mentionsThisChannel(
    text: string | undefined,
    channel: { name?: string; handle?: string; youtubeChannelId?: string },
  ): boolean {
    const lower = String(text || '').toLowerCase();
    if (!lower) return false;

    const handle = String(channel.handle || '').toLowerCase().replace(/^[@+]/, '').trim();
    const needles = new Set<string>();
    if (handle) needles.add(handle);
    // Brand handle used in production comments
    needles.add('uniquemeccaaudionyc');

    for (const n of needles) {
      if (!n) continue;
      if (lower.includes(`@${n}`)) return true;
      if (lower.includes(`+${n}`)) return true;
      if (lower.includes(`youtube.com/@${n}`)) return true;
    }
    return false;
  }

  private isCreatorAuthored(
    comment: { authorChannelId?: string; authorName?: string },
    channel: { youtubeChannelId?: string; name?: string },
  ): boolean {
    if (channel.youtubeChannelId && comment.authorChannelId === channel.youtubeChannelId) return true;
    if (channel.name && comment.authorName?.trim().toLowerCase() === channel.name.trim().toLowerCase()) return true;
    return false;
  }

  /**
   * Generates batch replies for up to 10 comments in 1 OpenAI call with spam defense.
   * Supports nested mention-replies via optional parent thread context.
   */
  async generateBatchReplies(
    comments: Array<{
      commentId: string;
      authorName: string;
      text: string;
      parentAuthorName?: string;
      parentText?: string;
      kind?: 'top' | 'mention_reply';
    }>,
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

    const systemPrompt = `You are the official YouTube community voice for "${channelName}" (Unique Mecca Audio).
You speak directly as Unique Mecca Audio — a 62-year-old former federal prisoner from Harlem who spent 26 years inside (1993–2020) on a life-plus-20 sentence. You are a street psychiatrist and elder who translates crime, courtrooms, and street code into hard lessons and lived consequence. You speak from the cell, not the anchor desk or defense lawyer table.

CRITICAL VOICE & STYLE RULES:
1. NEVER USE EM-DASHES ("—") OR EN-DASHES ("–"):
   - Never output "—" or "–" under ANY circumstances. They make comments look like robotic AI. Use commas, periods, or ellipses ("...").

2. NEVER SOUND LIKE A DEBATE BOT OR DEFENSE LAWYER:
   - FORBIDDEN OPENERS: "I understand the analogy...", "I hear you, but...", "That’s the blunt version of the argument...", "That’s the common-sense expectation...", "I’m not excusing anything...".
   - FORBIDDEN BUZZWORDS: "criminal liability", "assigned protection", "established fact", "complete and authentic", "scrutiny", "legally and factually".
   - Speak naturally like an OG on the block or in the yard. Be direct, real, and authentic.

3. CLOSERS MUST VARY (DO NOT FORCE QUESTIONS ON EVERY REPLY):
   - Real creators do not interrogate viewers with debate questions on every comment.
   - 40% Street Affirmations & Hard Jewels: "Paperwork don't lie. Salute.", "Stay sharp out here.", "Facts. 💯", "That cell door don't care about excuses."
   - 30% Street Reality Checks: "In the feds, they don't give time off for good intentions.", "Streets are loud, but prison gets quiet real fast."
   - 30% Natural Short Questions: "What page of that paperwork stood out to you?", "You think he knew what was coming?"

4. HARLEM OG VERNACULAR & RHYTHM:
   - Use natural contractions: "don't", "ain't", "can't", "won't".
   - Natural street terms: "paperwork", "receipts", "in the feds", "5K1", "doing someone else's time", "salute", "facts", "real talk", "heavy game", "stay sharp", "my brother".
   - Keep replies short: 1 to 2 punchy sentences (under 15 words per sentence). Never write academic paragraphs.

5. SENSITIVE TOPICS (SNITCHING, PAPERWORK, STREET CODE):
   - Never sound like you're defending or excusing wrongdoing.
   - Distinguish allegations from signed cooperation: "An indictment is allegations. A signed 5K1 letter is cooperation. Big difference when your life is on the line."
   - Never dismiss viewer street knowledge; validate their street logic while grounding it in federal reality.

6. HOST IDENTITY:
   - Host is Unique (Unique Mecca Audio). NEVER mention or use the private personal names "Wainsworth" or "Hall".

FEW-SHOT EXAMPLES (STUDY THESE):

❌ FORBIDDEN (Robotic AI):
"I hear you, but knowing a car may be recording doesn’t automatically prove what was said, what it meant, or whether the recording is complete and authentic. Do you think the actual words on tape settle the issue, or does the surrounding context still matter?"

✅ REQUIRED (Authentic Unique):
"Real talk. When you sit in the back of that cruiser, rule number one is keep your mouth shut. Anything coming out your mouth in that car goes straight to the prosecutor. Appreciate you tapping in."

❌ FORBIDDEN (Robotic AI):
"That’s the label many people will use, but legally and factually we still have to identify what was said, to whom, and whether there was a benefit or agreement involved. Do you judge the act by the outcome, or by the actual evidence of cooperation?"

✅ REQUIRED (Authentic Unique):
"That word gets thrown around heavy online. But until that 5K1 or cooperation agreement is sitting on the table, it's all street talk. Facts gotta match the paperwork. 💯"

❌ FORBIDDEN (Robotic AI):
"I appreciate that—there’s definitely enough street history, legal questions, and hard lessons for a real Unique Mecca Audio docuseries. Would you want it focused more on the paperwork, the culture, or the consequences behind the headlines?"

✅ REQUIRED (Authentic Unique):
"Salute, my brother! 26 years inside gave me heavy lessons to pass down to the youth. Big things in motion. What era you wanna see covered first?"

THREAD CONTEXT RULES:
- kind "top" = reply to the top-level viewer comment.
- kind "mention_reply" = the viewer @-mentioned the channel inside a nested reply. ALWAYS answer THAT person and THAT specific point directly.
- When parentText / parentAuthorName are provided, reference the thread context naturally without sounding scripted.

SPAM & BOT FILTERING RULES:
- REAL VIEWERS (ALWAYS REPLY): Comments containing only emojis (e.g. "💜💜💜", "🔥🔥🔥", "💯", "👑", "🙏🙏", "❤️"), short slang, compliments, or single-word reactions ("Salute", "Facts", "Real talk", "Fire") are 100% REAL VIEWERS showing love and support. Set "action": "reply" (select "Thankful", "Appreciative and Reflective", or "Street-Wise and Provocative" tone) and reply with warmth, love, or an OG salute (e.g., "Salute! Appreciate the love 🙏", "Facts 💯 Stay sharp.", "Much love, appreciate you rocking with the channel!").
- TRUE SPAM (ONLY SKIP THESE): Skip ONLY obvious scams: promotional links (http, .com, .io), WhatsApp/Telegram contact drops, crypto scams, or repetitive link spam. Set "action": "skip" and "skipReason": "Promotional spam / scam".
- NEVER skip real viewers showing support with emojis or slang!

OUTPUT FORMAT:
Respond with ONLY a valid JSON array of objects matching each input comment:
[
  {
    "commentId": "string",
    "action": "reply" or "skip",
    "skipReason": "string (optional)",
    "tone": "string (optional)",
    "replyText": "1-2 punchy sentences in authentic Unique Mecca Audio Harlem street OG voice without em-dashes"
  }
]`;

    const userMessage = `Video Title: "${videoTitle}"
Video Summary: "${(videoDescription || '').slice(0, 500)}"

Viewer Comments to Process:
${JSON.stringify(
  comments.map((c) => ({
    commentId: c.commentId,
    kind: c.kind || 'top',
    author: c.authorName,
    text: c.text,
    parentAuthor: c.parentAuthorName,
    parentText: c.parentText ? String(c.parentText).slice(0, 280) : undefined,
  })),
  null,
  2,
)}`;

    try {
      const raw = await this.openaiService.chatFast({
        systemPrompt,
        userMessage,
        temperature: 0.7,
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
          replyText: this.cleanReplyText(String(item.replyText || '')),
        }));
      }
    } catch (err: any) {
      this.logger.warn(`Batch reply AI generation parsing failed: ${err.message}. Falling back to single-comment generator.`);
    }

    // Fallback if batch parsing fails
    const fallbackResults = [];
    for (const c of comments) {
      try {
        const contextHint = c.parentText
          ? `Thread parent (${c.parentAuthorName || 'viewer'}): ${String(c.parentText).slice(0, 200)}\nReply to this nested comment`
          : undefined;
        const replies = await this.generateReplies(
          contextHint ? `${contextHint}\n${c.text}` : c.text,
          videoTitle,
          channelName,
          '',
          videoDescription,
        );
        fallbackResults.push({
          commentId: c.commentId,
          action: 'reply' as const,
          tone: replies[0]?.tone || 'General',
          replyText: this.cleanReplyText(replies[0]?.text || `Salute for tapping in. Stay sharp out here.`),
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

    if (this.quotaService.isDataApiExhausted() || this.quotaService.isCommentsBudgetExhausted()) {
      await this.videoModel.findByIdAndUpdate(video._id, {
        $set: { autoReplyLastRanAt: new Date() },
      });
      return { processedCount: 0, skippedCount: 0, failedCount: 0 };
    }

    try {
      await this.quotaService.checkCommentsBudget(channelId, 'commentThreads.list', QUOTA_COST_COMMENT_THREADS);
    } catch (budgetErr: any) {
      this.logger.warn(`Skipping auto-reply for video ${video.youtubeId}: ${budgetErr.message}`);
      await this.videoModel.findByIdAndUpdate(video._id, {
        $set: { autoReplyLastRanAt: new Date() },
      });
      return { processedCount: 0, skippedCount: 0, failedCount: 0 };
    }

    let accessToken: string | null = null;
    try {
      accessToken = await this.youtubeService.getValidAccessToken(channel.userId.toString());
    } catch (err: any) {
      this.logger.error(`Failed to get YouTube access token for channel ${channelId}: ${err.message}`);
      await this.videoModel.findByIdAndUpdate(video._id, {
        $set: { autoReplyLastRanAt: new Date() },
      });
      return { processedCount: 0, skippedCount: 0, failedCount: 0 };
    }

    // Do NOT wipe Redis cache every cron tick — that forces full commentThreads.list every 5 min.
    // Use cache (1h TTL). Cache is refreshed when we post (invalidate at end of a successful run).

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

    type AutoTarget = {
      commentId: string;
      authorName: string;
      text: string;
      kind: 'top' | 'mention_reply';
      parentCommentId?: string;
      parentAuthorName?: string;
      parentText?: string;
    };

    const targets: AutoTarget[] = [];
    const seenTargetIds = new Set<string>();
    /**
     * Hard budget: max comments.list calls for nested crawl this run.
     * 12 is still tiny vs the 5500/day comments wall (12 × 96 runs worst-case ≈ 576 list units at 1 unit/call).
     */
    let nestedListBudget = 12;
    let quotaStalled = false;
    /** Parent comment ids that already have a creator-authored child (Studio or app). */
    const creatorRepliedTo = new Set<string>();

    /**
     * Collect @channel mention children.
     * Quota-safe: prefer embedded seed replies; list only when the thread is incomplete
     * (YouTube often embeds only a few replies). Depth-2 only while budget remains.
     * comments.list under a top-level id returns flattened thread replies (incl. reply-to-reply).
     */
    const collectMentionDescendants = async (
      parentId: string,
      depth: number,
      parentAuthorName: string,
      parentText: string,
      seedChildren?: any[],
      forceList?: boolean,
    ) => {
      if (quotaStalled || depth > 2) return;

      let children: any[] = seedChildren || [];
      const shouldList = forceList || depth > 1 || !seedChildren || seedChildren.length === 0;

      if (shouldList && nestedListBudget > 0) {
        nestedListBudget--;
        try {
          await this.quotaService.checkCommentsBudget(channelId, 'comments.list (auto-mention)', 1);
          const listed = await this.youtubeService.listAllCommentReplies(accessToken!, parentId, 40);
          await this.quotaService.logCall({
            channelId,
            endpoint: 'comments.list (auto-mention)',
            quotaCost: 1,
            relatedId: parentId,
          });
          // Merge seed + listed so embedded mentions are never lost
          const byId = new Map<string, any>();
          for (const c of [...(seedChildren || []), ...listed]) {
            if (c?.id) byId.set(c.id, c);
          }
          children = Array.from(byId.values());
        } catch (loadErr: any) {
          if (isBudgetOrQuotaStop(loadErr)) {
            quotaStalled = true;
            if (isCommentsBudgetOnly(loadErr)) {
              this.quotaService.markCommentsBudgetExhaustedToday('comments.list');
            } else {
              this.quotaService.markDataApiExhaustedToday('comments.list');
            }
          }
          this.logger.warn(`Failed to load replies under ${parentId}: ${loadErr.message}`);
          children = seedChildren || [];
        }
      }

      for (const child of children) {
        if (!child?.id || seenTargetIds.has(child.id) || repliedSet.has(child.id)) continue;

        // Track creator answers (H3 / M1) — reply parent is this thread or an intermediate id
        if (this.isCreatorAuthored(child, channel)) {
          const creatorParent = child.parentId || parentId;
          if (creatorParent) creatorRepliedTo.add(creatorParent);
          // Also treat top-level as answered when a creator child sits anywhere in the thread
          if (parentId) creatorRepliedTo.add(parentId);
          continue;
        }

        const childMentionsChannel = this.mentionsThisChannel(child.text, channel);

        // Extra level only if this child is NOT the mention (grandchild might @us)
        // and we still have list budget — never N+1 per reply.
        if (depth === 1 && !childMentionsChannel && nestedListBudget > 0 && !quotaStalled) {
          await collectMentionDescendants(
            child.id,
            depth + 1,
            child.authorName || 'Viewer',
            child.text || '',
          );
        }

        if (!childMentionsChannel) continue;

        seenTargetIds.add(child.id);
        targets.push({
          commentId: child.id,
          authorName: child.authorName || 'Viewer',
          text: child.text || '',
          kind: 'mention_reply',
          parentCommentId: parentId,
          parentAuthorName,
          parentText,
        });
      }
    };

    // Pass 1: harvest @mentions already on the thread (0 extra list calls)
    for (const thread of threadsRes.comments) {
      if (quotaStalled) break;
      const topIsCreator = this.isCreatorAuthored(thread, channel);
      if (!repliedSet.has(thread.id) && !thread.hasCreatorReplied && !topIsCreator && !seenTargetIds.has(thread.id)) {
        seenTargetIds.add(thread.id);
        targets.push({
          commentId: thread.id,
          authorName: thread.authorName || 'Viewer',
          text: thread.text || '',
          kind: 'top',
        });
      }
    }

    // Pass 2: nested @channel — list only threads that are incomplete or look alive
    for (const thread of threadsRes.comments) {
      if (quotaStalled) break;
      const seed = thread.replies || [];
      const replyCount = thread.replyCount || 0;
      const hasAllEmbedded = replyCount > 0 && seed.length >= replyCount;
      const seedHasMention = seed.some((r: any) => this.mentionsThisChannel(r?.text, channel));

      // Always scan seeds first (no API). Then list when:
      // - thread actually has replies AND the list is incomplete (YouTube embeds only a few), or
      // - many replies and no mention found yet (deep @channel might be later in the thread)
      const needsList =
        replyCount > 0 &&
        !hasAllEmbedded &&
        nestedListBudget > 0 &&
        !quotaStalled &&
        (replyCount > seed.length || (replyCount >= 3 && !seedHasMention) || seed.length === 0);

      await collectMentionDescendants(
        thread.id,
        1,
        thread.authorName || 'Viewer',
        thread.text || '',
        seed.length > 0 ? seed : undefined,
        needsList,
      );
    }

    // Drop targets that already have a creator answer (Studio or earlier run) — H3 / M1
    const finalTargets = targets.filter((t) => {
      if (t.kind === 'top') {
        return !creatorRepliedTo.has(t.commentId);
      }
      // mention_reply: skip if Unique already answered this mention
      return !creatorRepliedTo.has(t.commentId);
    });

    if (quotaStalled) {
      await this.videoModel.findByIdAndUpdate(video._id, {
        $set: { autoReplyLastRanAt: new Date() },
      });
      return { processedCount: 0, skippedCount: 0, failedCount: 0 };
    }

    if (finalTargets.length === 0) {
      await this.videoModel.findByIdAndUpdate(video._id, {
        $set: { autoReplyLastRanAt: new Date() },
      });
      return { processedCount: 0, skippedCount: 0, failedCount: 0 };
    }

    // Cap total comments by remaining daily quota
    const targetComments = finalTargets.slice(0, remainingDailyCap);

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
        commentId: t.commentId,
        authorName: t.authorName || 'Viewer',
        commentText: t.text || '',
        parentCommentId: t.parentCommentId,
        parentCommentText: t.parentText,
        commentDepth: t.kind,
        status: 'queued',
        batchLockTimestamp: new Date(),
      })),
    });

    let successfulCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const newlyRepliedIds: string[] = [];
    /** Skipped (spam) + already-settled ids — never re-queue on the next cron (C1). */
    const settledIds: string[] = [];
    // Already answered by creator in Studio — never auto-reply (H3)
    for (const t of targets) {
      if (creatorRepliedTo.has(t.commentId)) settledIds.push(t.commentId);
    }

    // Process in chunks of up to 10 comments
    for (let offset = 0; offset < targetComments.length; offset += COMMENT_CHUNK_SIZE) {
      const chunk = targetComments.slice(offset, offset + COMMENT_CHUNK_SIZE);
      const commentsForAi = chunk.map((c) => ({
        commentId: c.commentId,
        authorName: c.authorName || 'Viewer',
        text: c.text || '',
        kind: c.kind,
        parentAuthorName: c.parentAuthorName,
        parentText: c.parentText,
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
        const aiRes = aiReplies.find((r) => r.commentId === comment.commentId);

        // H2: AI omitted this comment — do NOT settle (would drop the reply forever)
        if (!aiRes) {
          batchDoc.items[batchItemIndex].status = 'failed';
          batchDoc.items[batchItemIndex].error = 'AI did not return a result for this comment';
          batchDoc.items[batchItemIndex].processedAt = new Date();
          failedCount++;
          continue;
        }

        if (aiRes.action === 'skip') {
          batchDoc.items[batchItemIndex].status = 'skipped_spam';
          batchDoc.items[batchItemIndex].skipReason = aiRes.skipReason || 'Spam/bot comment';
          batchDoc.items[batchItemIndex].processedAt = new Date();
          skippedCount++;
          // Settle forever — do not rebuild a batch for the same spam every 5 minutes
          settledIds.push(comment.commentId);
          continue;
        }

        // M3: never post blank / whitespace-only replies
        if (!String(aiRes.replyText || '').trim()) {
          batchDoc.items[batchItemIndex].status = 'failed';
          batchDoc.items[batchItemIndex].error = 'AI returned empty reply text';
          batchDoc.items[batchItemIndex].processedAt = new Date();
          failedCount++;
          continue;
        }

        // Push reply to YouTube (parentId = top-level id OR nested mention comment id)
        try {
          await this.postReply(video.youtubeId, comment.commentId, aiRes.replyText!, channelId, accessToken, {
            source: 'auto',
          });
          batchDoc.items[batchItemIndex].status = 'completed';
          batchDoc.items[batchItemIndex].generatedReply = aiRes.replyText;
          batchDoc.items[batchItemIndex].tone = aiRes.tone;
          batchDoc.items[batchItemIndex].processedAt = new Date();
          (batchDoc.items[batchItemIndex] as any).manualReplyText = undefined;
          newlyRepliedIds.push(comment.commentId);
          successfulCount++;
          batchDoc.quotaUnitsUsed += QUOTA_COST_COMMENT_INSERT;

          // 3-second safety gap
          await new Promise((resolve) => setTimeout(resolve, COMMENT_PUSH_SAFETY_GAP_MS));
        } catch (pushErr: any) {
          this.logger.error(`Failed to post auto-reply to comment ${comment.commentId} on video ${video.youtubeId}: ${pushErr.message}`);
          batchDoc.items[batchItemIndex].status = 'failed';
          batchDoc.items[batchItemIndex].error = pushErr.message;
          batchDoc.items[batchItemIndex].processedAt = new Date();
          failedCount++;

          if (isBudgetOrQuotaStop(pushErr)) {
            // Daily wall — leave remaining comments for the next PT day. Do NOT settle
            // into repliedCommentIds (that would drop the reply forever).
            if (isCommentsBudgetOnly(pushErr)) {
              this.quotaService.markCommentsBudgetExhaustedToday('comments.insert');
            } else {
              this.quotaService.markDataApiExhaustedToday('comments.insert');
              await this.quotaService.logCall({
                channelId,
                endpoint: 'comments.insert',
                quotaCost: QUOTA_COST_COMMENT_INSERT,
                success: false,
                errorMessage: pushErr.message,
              });
            }
            break;
          }

          if (isPermanentCommentFailure(pushErr)) {
            // Deleted thread / comments disabled — settle, no retry storm
            settledIds.push(comment.commentId);
          }
          // Transient Google/API errors: leave unsettled so a later run can retry
        }
      }

      if (this.quotaService.isDataApiExhausted() || this.quotaService.isCommentsBudgetExhausted()) break;
    }

    // Finalize AutomationBatch
    batchDoc.successfulItems = successfulCount;
    batchDoc.skippedItems = skippedCount;
    batchDoc.failedItems = failedCount;
    batchDoc.status = failedCount === 0 && successfulCount > 0 ? 'completed' : successfulCount > 0 ? 'partial' : 'failed';
    batchDoc.completedAt = new Date();
    await batchDoc.save();

    // Record successful replies AND settled skips so cron does not loop (C1)
    const allProcessedIds = [...new Set([...newlyRepliedIds, ...settledIds])];
    await this.videoModel.findByIdAndUpdate(video._id, {
      $addToSet: { repliedCommentIds: { $each: allProcessedIds } },
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
