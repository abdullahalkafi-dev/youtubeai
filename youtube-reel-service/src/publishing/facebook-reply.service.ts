import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AiService } from '../ai/ai.service';
import { errMsg } from '../common/errors';
import { nyDate } from '../common/time';
import { AppConfig, CONFIG } from '../config/config';
import { ReelCommentReply, ReelCommentReplyDocument, ReplyDecision } from '../db/schemas/reel-comment-reply.schema';
import { ReelSetting, ReelSettingDocument } from '../db/schemas/reel-misc.schema';
import { ReelPost, ReelPostDocument } from '../db/schemas/reel-post.schema';
import { nyDayRange } from '../pipeline/ops-report';
import { classifyFacebookError, META_GRAPH_VERSION } from './facebook.publisher';
import { FacebookPublisher } from './facebook.publisher';
import { ReplyBatchSchema, REPLY_SYSTEM, replyUserMessage } from './facebook-reply.prompt';
import {
  cleanReply,
  dailyRemaining,
  FbComment,
  gapMs,
  hardSkipReason,
  isOwnComment,
  MAX_POST_ATTEMPTS,
  QUEUE_STALE_MS,
  replyPause,
  skipReasonOf,
  STORED_COMMENT_MAX,
  validateReply,
} from './facebook-reply-rules';
import { MetaTokenProvider } from './meta-token.provider';
import { PublishError } from './types';

const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const stateKey = (channelId: string) => `facebook-reply:${channelId}`;
/** Reels whose comments are read per pass (the ones read longest ago first). */
const REELS_PER_PASS = 3;
/** Comments sent to the model in one call, and replies waiting in the queue at most. */
const AI_BATCH = 8;
const QUEUE_MAX = 6;
/** The model's replies that the next one must differ from. */
const RECENT_REPLIES = 40;
/** Three failed attempts in a row (any comments) stop the lane for a while. */
const FAILURES_BEFORE_PAUSE = 3;

export interface ReplyState {
  pausedReason: string | null;
  pausedAt: Date | null;
  pausedUntil: Date | null;
  consecutiveFailures: number;
}

/**
 * Automatic replies to the comments on the Page's Facebook reels (client ask 2026-11-26). Everything about how it decides, what it never
 * answers, when it posts and how to audit it is in FACEBOOK-COMMENT-REPLIES.md. Short version:
 *   every 10 minutes: (1) post at most ONE queued reply (random 2-6 min after the previous one, checked every minute, all day, daily cap),
 *   then (2) read the comments of the 3 reels read longest ago, drop what the rules forbid, let the model reply-or-skip the rest,
 *   check its text with the rules again, and queue what passes.
 * FACEBOOK_REPLY_AUTO: off = nothing runs; dry = decisions are made and stored but nothing is posted; on = replies are posted.
 */
@Injectable()
export class FacebookReplyService {
  private readonly logger = new Logger(FacebookReplyService.name);

  /** Overridable in tests. */
  fetchFn: typeof fetch = (input, init) => fetch(input, init);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @InjectModel(ReelCommentReply.name) private readonly replies: Model<ReelCommentReplyDocument>,
    @InjectModel(ReelPost.name) private readonly posts: Model<ReelPostDocument>,
    @InjectModel(ReelSetting.name) private readonly settings: Model<ReelSettingDocument>,
    private readonly tokens: MetaTokenProvider,
    private readonly facebook: FacebookPublisher,
    private readonly ai: AiService,
  ) {}

  get mode(): 'off' | 'dry' | 'on' {
    return this.cfg.FACEBOOK_REPLY_AUTO;
  }

  // ------------------------------------------------------------------ state (pause / resume)

  async state(channelId: string): Promise<ReplyState> {
    const v = ((await this.settings.findOne({ key: stateKey(channelId) }).lean())?.value ?? {}) as Partial<ReplyState>;
    return {
      pausedReason: v.pausedReason ?? null,
      pausedAt: v.pausedAt ? new Date(v.pausedAt) : null,
      pausedUntil: v.pausedUntil ? new Date(v.pausedUntil) : null,
      consecutiveFailures: v.consecutiveFailures ?? 0,
    };
  }

  private async setState(channelId: string, patch: Partial<ReplyState>) {
    const $set = Object.fromEntries(Object.entries(patch).map(([k, v]) => [`value.${k}`, v]));
    await this.settings.updateOne({ key: stateKey(channelId) }, { $set }, { upsert: true });
  }

  async pause(channelId: string, reason: string, until: Date | null = null) {
    await this.setState(channelId, { pausedReason: reason, pausedAt: new Date(), pausedUntil: until });
    this.logger.warn(`Facebook comment replies paused for ${channelId}: ${reason}`); // developer-only: shown in the ops log, never to the client
  }

  async resume(channelId: string) {
    await this.setState(channelId, { pausedReason: null, pausedAt: null, pausedUntil: null, consecutiveFailures: 0 });
  }

  /** The reason the lane is stopped now, or null. A timed pause that has run out clears itself. */
  private async pausedReason(channelId: string, now: Date): Promise<string | null> {
    const st = await this.state(channelId);
    if (!st.pausedReason) return null;
    if (st.pausedUntil && st.pausedUntil.getTime() <= now.getTime()) {
      await this.resume(channelId);
      return null;
    }
    return st.pausedReason;
  }

  // ------------------------------------------------------------------ the periodic job

  /** Every 10 minutes (maintenance task 'facebook-reply'). Does nothing with FACEBOOK_REPLY_AUTO=off. */
  async runDue(now = new Date()) {
    if (this.mode === 'off') return;
    const ids = ((await this.posts.distinct('channelId', { platform: 'facebook' })) as Types.ObjectId[]).map(String);
    for (const channelId of ids) {
      try {
        await this.tick(channelId, now);
      } catch (err) {
        this.logger.warn(`Facebook replies for channel ${channelId}: ${errMsg(err)}`);
      }
    }
  }

  /** Every minute (maintenance task 'facebook-reply-post'): only posts, so the 2-6 minute gap is real. The 10-minute pass reads and decides comments. */
  async runPostDue(now = new Date()) {
    if (this.mode !== 'on') return;
    const ids = ((await this.posts.distinct('channelId', { platform: 'facebook' })) as Types.ObjectId[]).map(String);
    for (const channelId of ids) {
      try {
        if (await this.pausedReason(channelId, now)) continue;
        await this.postNext(channelId, now);
      } catch (err) {
        this.logger.warn(`Facebook reply post for channel ${channelId}: ${errMsg(err)}`);
      }
    }
  }

  async tick(channelId: string, now = new Date()) {
    if (this.mode === 'off') return { status: 'off' as const };
    const paused = await this.pausedReason(channelId, now);
    if (paused) return { status: 'paused' as const, reason: paused };
    const account = await this.facebook.getAccountStatus(channelId);
    if (account.state !== 'ok') return { status: 'facebook-not-connected' as const };
    const posted = this.mode === 'on' ? await this.postNext(channelId, now) : 0;
    const found = await this.discover(channelId, now);
    return { status: 'ok' as const, posted, ...found };
  }

  // ------------------------------------------------------------------ step 1: post the next queued reply

  private async repliedToday(channelId: string, now: Date): Promise<number> {
    const { start, end } = nyDayRange(nyDate(now));
    return this.replies.countDocuments({ channelId: new Types.ObjectId(channelId), platform: 'facebook', decision: 'replied', repliedAt: { $gte: start, $lt: end } });
  }

  private posting = false;

  /** Posts at most one reply. Returns 1 when one was posted. */
  async postNext(channelId: string, now = new Date()): Promise<number> {
    if (this.posting) return 0; // two passes must never send the same reply twice
    this.posting = true;
    try {
      return await this.postNextInner(channelId, now);
    } finally {
      this.posting = false;
    }
  }

  private async postNextInner(channelId: string, now: Date): Promise<number> {
    const cid = new Types.ObjectId(channelId);
    const lastRows = await this.replies.find({ channelId: cid, platform: 'facebook', decision: 'replied' }).sort({ repliedAt: -1 }).limit(1).select('repliedAt').lean();
    const last = lastRows[0]?.repliedAt ? new Date(lastRows[0].repliedAt) : null;
    if (last && now.getTime() - last.getTime() < gapMs(String(last.getTime()))) return 0;
    if (dailyRemaining(await this.repliedToday(channelId, now), this.cfg.FACEBOOK_REPLY_DAILY_CAP) <= 0) return 0;

    await this.replies.updateMany(
      { channelId: cid, platform: 'facebook', decision: 'queued', queuedAt: { $lt: new Date(now.getTime() - QUEUE_STALE_MS) } },
      { $set: { decision: 'skipped', skipReason: 'stale' } },
    );
    const next = (await this.replies.find({ channelId: cid, platform: 'facebook', decision: 'queued' }).sort({ queuedAt: 1 }).limit(1).lean())[0];
    if (!next) return 0;

    let token: string;
    try {
      token = (await this.tokens.page(channelId)).accessToken;
    } catch (err) {
      await this.onPostError(channelId, next.commentId, err, now);
      return 0;
    }
    try {
      // The last look at Facebook before anything is sent: the comment must still exist, and nobody (a person on the Page, an earlier
      // run that lost its answer) may have replied to it already.
      const c = await this.graph('GET', `${GRAPH}/${encodeURIComponent(next.commentId)}`, { fields: 'id,message,comment_count', access_token: token }).catch((err) => {
        if (err instanceof PublishError && err.code === 'not_found') return null;
        throw err;
      });
      if (!c) return this.finish(next.commentId, 'skipped', { skipReason: 'comment_gone' });
      if (Number(c.comment_count ?? 0) > 0) return this.finish(next.commentId, 'skipped', { skipReason: 'has_replies' });
      const done = await this.graph('POST', `${GRAPH}/${encodeURIComponent(next.commentId)}/comments`, { message: next.replyText ?? '', access_token: token });
      await this.finish(next.commentId, 'replied', { replyId: String(done.id ?? ''), repliedAt: now });
      await this.setState(channelId, { consecutiveFailures: 0 });
      this.logger.log(`Facebook reply posted for channel ${channelId} (comment ${next.commentId})`);
      return 1;
    } catch (err) {
      await this.onPostError(channelId, next.commentId, err, now);
      return 0;
    }
  }

  private async finish(commentId: string, decision: ReplyDecision, extra: Record<string, unknown> = {}): Promise<0> {
    await this.replies.updateOne({ platform: 'facebook', commentId }, { $set: { decision, ...extra } });
    return 0;
  }

  /** A failed attempt: a login/permission/rate problem pauses the lane; anything else counts against the comment (3 tries) and the streak. */
  private async onPostError(channelId: string, commentId: string, err: unknown, now: Date) {
    const pe = err instanceof PublishError ? err : new PublishError('transient', errMsg(err));
    const stop = replyPause(pe, now);
    if (stop) {
      await this.pause(channelId, stop.reason, stop.until);
      return;
    }
    if (commentId) {
      const row = (await this.replies.find({ platform: 'facebook', commentId }).limit(1).lean())[0];
      const attempts = (row?.attempts ?? 0) + 1;
      await this.replies.updateOne(
        { platform: 'facebook', commentId },
        { $set: { attempts, error: pe.message.slice(0, 200), errorCode: pe.code ?? pe.kind, ...(attempts >= MAX_POST_ATTEMPTS ? { decision: 'failed' } : {}) } },
      );
    }
    const streak = (await this.state(channelId)).consecutiveFailures + 1;
    await this.setState(channelId, { consecutiveFailures: streak });
    if (streak >= FAILURES_BEFORE_PAUSE) await this.pause(channelId, `${streak} reply attempts failed in a row (last: ${pe.message.slice(0, 100)}): paused for 3 hours`, new Date(now.getTime() + 3 * 3_600_000));
  }

  // ------------------------------------------------------------------ step 2: read comments, decide, queue

  private async recentReplyTexts(channelId: string): Promise<string[]> {
    const rows = await this.replies
      .find({ channelId: new Types.ObjectId(channelId), platform: 'facebook', decision: { $in: ['replied', 'queued', 'dry_run'] } })
      .sort({ updatedAt: -1 })
      .limit(RECENT_REPLIES)
      .select('replyText')
      .lean();
    return rows.map((r) => String(r.replyText ?? '')).filter(Boolean);
  }

  private async record(
    channelId: string,
    post: { _id: unknown; reelId?: unknown; externalId?: string },
    c: FbComment,
    decision: ReplyDecision,
    extra: Record<string, unknown> = {},
  ) {
    await this.replies.updateOne(
      { platform: 'facebook', commentId: c.id },
      {
        $set: {
          channelId: new Types.ObjectId(channelId),
          postId: post._id,
          ...(post.reelId ? { reelId: post.reelId } : {}),
          externalPostId: post.externalId,
          commentText: String(c.message ?? '').slice(0, STORED_COMMENT_MAX),
          commentCreatedAt: c.created_time ? new Date(c.created_time) : undefined,
          decision,
          mode: this.mode,
          attempts: 0,
          ...extra,
        },
      },
      { upsert: true },
    );
  }

  /** A comment is "handled" (never looked at again) once it has a row; in live mode a dry-run row does not count (the dry run was only a rehearsal). */
  private handledDecisions(): ReplyDecision[] {
    return this.mode === 'on' ? ['queued', 'replied', 'skipped', 'failed'] : ['queued', 'replied', 'dry_run', 'skipped', 'failed'];
  }

  async discover(channelId: string, now = new Date()) {
    const cid = new Types.ObjectId(channelId);
    const cap = this.cfg.FACEBOOK_REPLY_DAILY_CAP;
    const { start, end } = nyDayRange(nyDate(now));
    let remaining: number;
    if (this.mode === 'on') {
      const queued = await this.replies.countDocuments({ channelId: cid, platform: 'facebook', decision: 'queued' });
      if (queued >= QUEUE_MAX) return { candidates: 0, queued: 0, skipped: 0, note: 'queue full' };
      remaining = Math.min(dailyRemaining((await this.repliedToday(channelId, now)) + queued, cap), QUEUE_MAX - queued);
    } else {
      remaining = dailyRemaining(await this.replies.countDocuments({ channelId: cid, platform: 'facebook', decision: 'dry_run', queuedAt: { $gte: start, $lt: end } }), cap);
    }
    if (remaining <= 0) return { candidates: 0, queued: 0, skipped: 0, note: 'daily cap reached' };

    let token: string;
    let pageId: string;
    try {
      ({ accessToken: token, pageId } = await this.tokens.page(channelId));
    } catch (err) {
      await this.onPostError(channelId, '', err, now);
      return { candidates: 0, queued: 0, skipped: 0, note: 'no Facebook login' };
    }

    const since = new Date(now.getTime() - this.cfg.FACEBOOK_REPLY_REEL_DAYS * 86_400_000);
    const reels = await this.posts
      .find({ channelId: cid, platform: 'facebook', status: 'published', externalId: { $exists: true }, publishedAt: { $gte: since } })
      .sort({ commentsCheckedAt: 1 })
      .limit(REELS_PER_PASS)
      .select('externalId reelId metadata.title commentsCheckedAt')
      .lean();

    type Item = { post: (typeof reels)[number]; comment: FbComment };
    const items: Item[] = [];
    for (const post of reels) {
      try {
        const data = await this.graph('GET', `${GRAPH}/${encodeURIComponent(String(post.externalId))}/comments`, {
          fields: 'id,message,created_time,comment_count,from{id}',
          filter: 'toplevel',
          order: 'reverse_chronological',
          limit: '50',
          access_token: token,
        });
        for (const comment of (data.data ?? []) as FbComment[]) if (comment?.id) items.push({ post, comment });
      } catch (err) {
        if (err instanceof PublishError && (err.kind === 'auth' || err.kind === 'quota')) {
          await this.onPostError(channelId, '', err, now);
          return { candidates: 0, queued: 0, skipped: 0, note: 'Facebook refused the read' };
        }
        // a reel that cannot be read (deleted, transient): try again on a later pass
      }
      await this.posts.updateOne({ _id: post._id }, { $set: { commentsCheckedAt: now } });
    }
    if (!items.length) return { candidates: 0, queued: 0, skipped: 0 };

    const known = await this.replies.find({ platform: 'facebook', commentId: { $in: items.map((i) => i.comment.id) }, decision: { $in: this.handledDecisions() } }).select('commentId').lean();
    const handled = new Set(known.map((r) => r.commentId));

    const candidates: Item[] = [];
    let skipped = 0;
    for (const it of items) {
      const c = it.comment;
      if (handled.has(c.id)) continue;
      if (c.created_time && new Date(c.created_time).getTime() < since.getTime()) continue; // too old to answer, and not worth a row
      const rule = isOwnComment(c, pageId) ? 'own_comment' : Number(c.comment_count ?? 0) > 0 ? 'has_replies' : hardSkipReason(c.message);
      if (rule) {
        await this.record(channelId, it.post, c, 'skipped', { skipReason: rule });
        skipped++;
        continue;
      }
      candidates.push(it);
    }
    candidates.sort((a, b) => new Date(b.comment.created_time ?? 0).getTime() - new Date(a.comment.created_time ?? 0).getTime());
    const batch = candidates.slice(0, AI_BATCH);
    if (!batch.length) return { candidates: 0, queued: 0, skipped };

    const recent = await this.recentReplyTexts(channelId);
    let out: Awaited<ReturnType<AiService['generateJson']>>;
    try {
      out = await this.ai.generateJson({
        task: `fbreply:${channelId}`,
        tier: 'fast',
        system: REPLY_SYSTEM,
        user: replyUserMessage(
          batch.map((b) => ({ commentId: b.comment.id, text: String(b.comment.message ?? '').replace(/\s+/g, ' ').trim(), reelTitle: String((b.post as any).metadata?.title ?? '') })),
          recent,
        ),
        schema: ReplyBatchSchema,
        schemaName: 'fb_reply_batch',
        reasoningEffort: 'low',
        maxCompletionTokens: 8000,
      });
    } catch (err) {
      // No credits or a model outage: nothing is recorded, so the same comments are tried again on the next pass.
      this.logger.warn(`Facebook reply model call failed: ${errMsg(err).slice(0, 160)}`);
      return { candidates: batch.length, queued: 0, skipped, note: 'model unavailable' };
    }

    const byId = new Map<string, { action: string; skipReason: string; tone: string; replyText: string }>((out as any).items.map((i: any) => [i.commentId, i]));
    let queued = 0;
    const accepted = [...recent];
    for (const it of batch) {
      const d = byId.get(it.comment.id);
      if (!d) continue; // the model dropped it: tried again next pass
      if (d.action !== 'reply') {
        await this.record(channelId, it.post, it.comment, 'skipped', { skipReason: skipReasonOf(d.skipReason) });
        skipped++;
        continue;
      }
      if (queued >= remaining) continue; // room for no more today / in the queue: decided again later
      const text = cleanReply(d.replyText);
      // A reply that had a link in it is rejected, not repaired: cleaning would leave a stump of an answer.
      const bad = /https?:\/\/|www\./i.test(String(d.replyText)) ? 'link' : validateReply(text, accepted);
      if (bad) {
        await this.record(channelId, it.post, it.comment, 'skipped', { skipReason: `reply_${bad}`, replyText: text.slice(0, 200) });
        skipped++;
        continue;
      }
      accepted.unshift(text);
      queued++;
      await this.record(channelId, it.post, it.comment, this.mode === 'on' ? 'queued' : 'dry_run', { replyText: text, tone: String(d.tone ?? '').slice(0, 20), queuedAt: now });
    }
    if (queued || skipped) this.logger.log(`Facebook replies (${this.mode}) for ${channelId}: ${queued} reply(ies) ${this.mode === 'on' ? 'queued' : 'written (dry run)'}, ${skipped} skipped`);
    return { candidates: batch.length, queued, skipped };
  }

  // ------------------------------------------------------------------ what the operator sees

  /** GET …/facebook/replies and the `fbreply:log` command: mode, pause, today's and total counts, and the newest decisions with their text. Never a token. */
  async overview(channelId: string, now = new Date(), limit = 30) {
    const cid = new Types.ObjectId(channelId);
    const { start, end } = nyDayRange(nyDate(now));
    const st = await this.state(channelId);
    const count = (q: Record<string, unknown>) => this.replies.countDocuments({ channelId: cid, platform: 'facebook', ...q });
    const [repliedToday, queued, dryToday, skippedToday, replied, skipped, failed, recent] = await Promise.all([
      this.repliedToday(channelId, now),
      count({ decision: 'queued' }),
      count({ decision: 'dry_run', queuedAt: { $gte: start, $lt: end } }),
      count({ decision: 'skipped', updatedAt: { $gte: start, $lt: end } }),
      count({ decision: 'replied' }),
      count({ decision: 'skipped' }),
      count({ decision: 'failed' }),
      this.replies.find({ channelId: cid, platform: 'facebook' }).sort({ updatedAt: -1 }).limit(limit).lean(),
    ]);
    return {
      mode: this.mode,
      dailyCap: this.cfg.FACEBOOK_REPLY_DAILY_CAP,
      paused: st.pausedReason ? { reason: st.pausedReason, since: st.pausedAt, until: st.pausedUntil } : null,
      today: { replied: repliedToday, queued, dryRun: dryToday, skipped: skippedToday },
      totals: { replied, skipped, failed },
      recent: recent.map((r) => ({
        decision: r.decision,
        skipReason: r.skipReason ?? null,
        comment: r.commentText ?? '',
        reply: r.replyText ?? null,
        tone: r.tone ?? null,
        mode: r.mode ?? null,
        error: r.error ?? null,
        at: (r.repliedAt ?? r.queuedAt ?? (r as any).updatedAt ?? null) as Date | null,
      })),
    };
  }

  // ------------------------------------------------------------------ http

  private async graph(method: 'GET' | 'POST', url: string, params: Record<string, string>): Promise<any> {
    let res: Response;
    try {
      res =
        method === 'GET'
          ? await this.fetchFn(`${url}?${new URLSearchParams(params)}`, { method: 'GET', signal: AbortSignal.timeout(30_000) })
          : await this.fetchFn(url, { method: 'POST', body: new URLSearchParams(params), signal: AbortSignal.timeout(60_000) });
    } catch (err) {
      throw new PublishError('transient', `Network error talking to Facebook: ${(err as Error).message}`);
    }
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || body?.error) throw classifyFacebookError(res.status, body);
    return body;
  }
}
