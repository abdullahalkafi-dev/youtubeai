import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as fs from 'fs';
import { ReelPost, ReelPostDocument } from '../db/schemas/reel-post.schema';
import { buildFacebookCaption, fullVideoComment } from './facebook-caption';
import { MetaTokenProvider } from './meta-token.provider';
import { preflightChecks } from './preflight';
import { PublisherRegistry } from './registry';
import {
  AccountStatus,
  Issue,
  MetricSample,
  PostMetadata,
  PublishContext,
  PublishError,
  PublishOutcome,
  Publisher,
  PublisherCapabilities,
  ReelFacts,
  VerifyResult,
} from './types';

/**
 * Graph API version. Keep in sync with META_GRAPH_VERSION in youtube-ai-backend/src/meta/meta.service.ts (v26.0, Meta changelog).
 */
export const META_GRAPH_VERSION = 'v26.0';
const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const FOLLOWERS_TTL_MS = 10 * 60_000;
const AUTH_LOG = new Logger('MetaAuth');
const RUPLOAD = `https://rupload.facebook.com/video-upload/${META_GRAPH_VERSION}`;

/** Meta: "Reels API is limited to 30 API-published posts within a 24-hour moving period" (Reels Publishing API guide). */
export const FACEBOOK_REELS_PER_24H = 30;
const MAX_UPLOAD_ATTEMPTS = 4;
const MIN_WIDTH = 540;
const MIN_HEIGHT = 960;

/**
 * Limits, from Meta's Reels Publishing API guide (developers.facebook.com/documentation/video-api/guides/reels-publishing):
 *  - 9:16 vertical, minimum 540x960 (error 1363127 below it), 24-60 fps, 30 API posts per 24 hours: stated in the guide.
 *  - 3-90 seconds: NOT confirmed in Meta's own text (secondary guides say 3-90, one says 3-60). 90 is used here; confirm on the first real post.
 *  - maximum file size: Meta states none that we could find; 512 MB is our own guard (a reel is tens of MB, and the upload is read into memory).
 *  - the API publishes publicly (no private/unlisted), so `visibilities` is only 'public'. Native scheduling exists (video_state SCHEDULED)
 *    but our own queue decides the time, so `supportsSchedule` is false.
 */
const CAPABILITIES: PublisherCapabilities = {
  label: 'Facebook Reels',
  maxDurationSec: 90,
  aspect: 'vertical',
  maxFileMB: 512,
  descriptionMax: 2200,
  visibilities: ['public'],
  supportsSchedule: false,
  delivery: 'push-bytes',
  metrics: ['views', 'likes', 'comments'],
};

/**
 * Turn a Graph API error into a typed error. Graph bodies look like
 * `{ error: { message, type, code, error_subcode, is_transient, error_user_msg } }`. Messages are cut short and never carry tokens.
 */
export function classifyFacebookError(status: number, body: any): PublishError {
  const e = body?.error ?? {};
  const code = Number(e.code);
  const sub = Number(e.error_subcode);
  const message = String(e.error_user_msg ?? e.message ?? `Facebook returned HTTP ${status}`).slice(0, 220);
  const tag = Number.isFinite(code) ? String(code) : String(status);

  if (status === 401 || code === 190 || code === 102 || code === 463 || code === 467 || sub === 458 || sub === 459 || sub === 460 || sub === 463 || sub === 467) {
    // The user-facing text below is generic on purpose; the real reason (Facebook's own code, subcode and trace id) goes to the log for audit.
    AUTH_LOG.warn(`Facebook auth error: HTTP ${status} code=${e.code ?? '-'} subcode=${e.error_subcode ?? '-'} type=${e.type ?? '-'} trace=${e.fbtrace_id ?? '-'} message=${String(e.message ?? '').replace(/\s+/g, ' ').slice(0, 200)}`);
    return new PublishError('auth', 'Facebook rejected the login (expired or revoked). Reconnect Facebook in the app Settings.', tag, status);
  }
  if (code === 10 || (code >= 200 && code <= 299)) {
    return new PublishError('auth', 'The Facebook login does not allow publishing reels to this Page. Reconnect Facebook and tick the Page.', tag, status);
  }
  if (code === 4 || code === 17 || code === 32 || code === 613 || (code >= 80000 && code <= 80099)) {
    return new PublishError('quota', `Facebook's posting limit was reached: ${message}`, tag, status);
  }
  if (code === 100 && sub === 33) {
    return new PublishError('fatal', 'Facebook cannot find that video (it may have been deleted).', 'not_found', status);
  }
  if ((code >= 1363000 && code <= 1363999) || (sub >= 1363000 && sub <= 1363999) || (sub >= 2207000 && sub <= 2207999)) {
    return new PublishError('media', `Facebook rejected the video file: ${message}`, String(sub || code), status);
  }
  if (code === 100) return new PublishError('invalid_metadata', message, tag, status);
  if (e.is_transient === true || code === 1 || code === 2 || status >= 500 || status === 408 || status === 429) {
    return new PublishError('transient', message, tag, status);
  }
  return new PublishError('fatal', message, tag, status);
}

export const backoffMs = (attempt: number) => Math.min(60_000, 2000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 500);

/** `https://rupload.facebook.com/video-upload/v26.0/12345?x=y` -> `12345`. */
export function videoIdOf(sessionUrl: string): string | null {
  const m = /\/video-upload\/[^/]+\/(\d+)/.exec(sessionUrl);
  return m ? m[1] : null;
}

type UploadStatus = { kind: 'partial'; offset: number } | { kind: 'expired' };

/**
 * Posts Reels to a Facebook Page with the Page Reels flow (Meta Reels Publishing API):
 *   POST /{page}/video_reels upload_phase=start -> video_id + upload URL
 *   POST rupload.facebook.com/video-upload/{video_id} (bytes, `offset` + `file_size` headers)
 *   POST /{page}/video_reels upload_phase=finish video_state=PUBLISHED description=...
 * then `verify` reads the video's status. The Page token comes from the main app's Facebook login (MetaTokenProvider).
 */
@Injectable()
export class FacebookPublisher implements Publisher, OnModuleInit {
  readonly platform = 'facebook' as const;
  readonly capabilities = CAPABILITIES;

  /** Overridable in tests. */
  fetchFn: typeof fetch = (input, init) => fetch(input, init);
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));

  constructor(
    private readonly tokens: MetaTokenProvider,
    private readonly registry: PublisherRegistry,
    @InjectModel(ReelPost.name) private readonly posts: Model<ReelPostDocument>,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  // ------------------------------------------------------------------ account

  async getAccountStatus(channelId: string): Promise<AccountStatus> {
    // GET …/accounts asks every publisher at once: a Facebook problem must never hide the YouTube account.
    let id: Awaited<ReturnType<MetaTokenProvider['identity']>>;
    try {
      id = await this.tokens.identity(channelId);
    } catch {
      return { platform: 'facebook', state: 'missing', message: 'Could not read the Facebook connection right now.' };
    }
    if (!id) return { platform: 'facebook', state: 'missing', message: 'No Facebook Page is connected. Connect Facebook in the app Settings.' };
    const expired = !!id.tokenExpiresAt && id.tokenExpiresAt.getTime() <= Date.now();
    return {
      platform: 'facebook',
      state: expired ? 'needs_reconnect' : 'ok',
      externalId: id.pageId,
      displayName: id.name,
      message: expired
        ? 'The Facebook login has expired. Reconnect Facebook in the app Settings.'
        : id.extraPages > 0
          ? `${id.extraPages + 1} Pages were shared; "${id.name}" is used.`
          : undefined,
      quota: { usedToday: await this.postsLast24h(channelId), dailyCap: FACEBOOK_REELS_PER_24H },
    };
  }

  private readonly followersCache = new Map<string, { at: number; value: number | null }>();

  /**
   * The Page's follower count for the app's Facebook overview. Cached for 10 minutes, and a Facebook problem gives null instead of
   * an error (the overview must still load).
   */
  async pageFollowers(channelId: string): Promise<{ followers: number | null; fetchedAt: Date }> {
    const hit = this.followersCache.get(channelId);
    if (hit && Date.now() - hit.at < FOLLOWERS_TTL_MS) return { followers: hit.value, fetchedAt: new Date(hit.at) };
    let value: number | null = null;
    try {
      const { pageId, accessToken } = await this.tokens.page(channelId);
      const data = await this.get(`${GRAPH}/${encodeURIComponent(pageId)}`, { fields: 'followers_count,fan_count', access_token: accessToken });
      const n = Number(data?.followers_count ?? data?.fan_count);
      value = Number.isFinite(n) ? n : null;
    } catch {
      value = null;
    }
    const at = Date.now();
    this.followersCache.set(channelId, { at, value });
    return { followers: value, fetchedAt: new Date(at) };
  }

  /** Facebook counts a moving 24 hours, not a calendar day. */
  private postsLast24h(channelId: string): Promise<number> {
    return this.posts.countDocuments({
      channelId: new Types.ObjectId(channelId),
      platform: 'facebook',
      status: { $in: ['queued', 'uploading', 'processing', 'scheduled', 'published', 'blocked'] },
      createdAt: { $gte: new Date(Date.now() - 24 * 3_600_000) },
    });
  }

  // ------------------------------------------------------------------ preflight

  preflight(input: { reel: ReelFacts; metadata: PostMetadata; account: AccountStatus; hasActiveDuplicate: boolean }): Issue[] {
    // The API publishes publicly only: whatever the shared default says ('unlisted' by default), Facebook gets 'public'.
    const metadata: PostMetadata = { ...input.metadata, privacy: 'public' };
    const YOUTUBE_ONLY = new Set(['tags_trimmed', 'description_truncated', 'title_adjusted']);
    const issues = preflightChecks({ caps: this.capabilities, ...input, metadata })
      .filter((i) => !YOUTUBE_ONLY.has(i.code))
      .map((i): Issue => {
        if (i.code === 'daily_cap') return { ...i, message: `Facebook allows ${FACEBOOK_REELS_PER_24H} reels per 24 hours through the API. Try again when older posts are more than a day old.` };
        if (i.code === 'rights') return { ...i, message: 'Public posting: this reel is cut from your long videos and may contain third-party clips (news footage, music) that Facebook can flag for rights.' };
        if (i.code === 'not_vertical') return { ...i, message: i.message.replace(' It must be vertical or square to count as a Short.', ' Facebook Reels must be vertical (9:16).') };
        return i;
      });
    const { width, height } = input.reel;
    if (width && height && (Math.min(width, height) < MIN_WIDTH || Math.max(width, height) < MIN_HEIGHT)) {
      issues.push({ level: 'error', code: 'resolution_low', message: `The video is ${width}×${height}. Facebook Reels need at least ${MIN_WIDTH}×${MIN_HEIGHT}.` });
    }
    if (!buildFacebookCaption(metadata)) issues.push({ level: 'error', code: 'caption_empty', message: 'The Facebook caption is empty.' });
    return issues;
  }

  // ------------------------------------------------------------------ publish

  async publish(input: { channelId: string; metadata: PostMetadata; sessionUri?: string | null; ctx: PublishContext }): Promise<PublishOutcome> {
    const { channelId, metadata, ctx } = input;
    const { pageId, accessToken } = await this.tokens.page(channelId);
    const caption = buildFacebookCaption(metadata);
    if (!caption) throw new PublishError('invalid_metadata', 'The Facebook caption is empty.');
    if (ctx.fileSize <= 0) throw new PublishError('media', 'The reel file is empty');

    let session: string | null = input.sessionUri ?? null;
    let videoId: string | null = session ? videoIdOf(session) : null;
    let offset = 0;
    let resumed = false;

    if (session && videoId) {
      const st = await this.uploadStatus(session, accessToken);
      if (st.kind === 'expired') {
        session = null;
        videoId = null;
      } else {
        offset = Math.min(st.offset, ctx.fileSize);
        resumed = true;
      }
    } else {
      session = null;
      videoId = null;
    }

    if (!session) {
      if (await ctx.shouldCancel()) throw new PublishError('cancelled', 'Cancelled by user');
      const started = await this.post(`${GRAPH}/${encodeURIComponent(pageId)}/video_reels`, { upload_phase: 'start', access_token: accessToken });
      videoId = String(started.video_id ?? '');
      if (!videoId) throw new PublishError('fatal', 'Facebook did not return a video id for the upload');
      session = typeof started.upload_url === 'string' && started.upload_url ? started.upload_url : `${RUPLOAD}/${videoId}`;
      offset = 0;
      await ctx.saveSession(session, 0);
    }

    const uploadUrl = session as string; // set above: resumed or just started
    if (offset < ctx.fileSize) await this.sendBytes(uploadUrl, accessToken, ctx, offset);
    await ctx.saveSession(uploadUrl, ctx.fileSize);
    if (await ctx.shouldCancel()) throw new PublishError('cancelled', 'Cancelled by user');

    try {
      const done = await this.post(`${GRAPH}/${encodeURIComponent(pageId)}/video_reels`, {
        upload_phase: 'finish',
        video_id: videoId!,
        video_state: 'PUBLISHED',
        description: caption,
        access_token: accessToken,
      });
      if (done.success === false) throw new PublishError('fatal', 'Facebook did not accept the publish request');
    } catch (err) {
      // A retry after a lost "finish" answer must not fail on a reel that is already out.
      if (resumed && err instanceof PublishError && err.kind !== 'auth' && (await this.alreadyPublished(videoId!, accessToken))) {
        return { externalId: videoId!, url: reelUrl(videoId!), warnings: [] };
      }
      throw err;
    }
    const warnings = await this.addLinkComment(videoId!, accessToken, metadata);
    return { externalId: videoId!, url: reelUrl(videoId!), warnings };
  }

  /**
   * First comment with the clickable YouTube link. Facebook only accepts comments once the reel has finished processing
   * (about 1.5 minutes), so this retries for up to 2 minutes. It never fails the post: a miss is returned as a warning.
   */
  private async addLinkComment(videoId: string, token: string, metadata: PostMetadata): Promise<string[]> {
    const message = fullVideoComment(metadata.description);
    if (!message) return [];
    for (let attempt = 0; attempt < 12; attempt++) {
      await this.sleep(10_000);
      try {
        await this.post(`${GRAPH}/${encodeURIComponent(videoId)}/comments`, { message, access_token: token });
        return [];
      } catch (err) {
        if (err instanceof PublishError && err.kind === 'auth') break;
      }
    }
    return ['The reel is out, but the "full video" link comment could not be added. Add it by hand.'];
  }

  /** One POST with the bytes from `startOffset` to the end (a reel is small); retries ask Facebook how much it already has. */
  private async sendBytes(session: string, token: string, ctx: PublishContext, startOffset: number): Promise<void> {
    let offset = startOffset;
    for (let attempt = 1; ; attempt++) {
      if (await ctx.shouldCancel()) throw new PublishError('cancelled', 'Cancelled by user');
      const fh = await fs.promises.open(ctx.filePath, 'r');
      let buf: Buffer;
      try {
        buf = Buffer.alloc(ctx.fileSize - offset);
        await fh.read(buf, 0, buf.length, offset);
      } finally {
        await fh.close();
      }
      try {
        const res = await this.call(session, {
          method: 'POST',
          headers: { Authorization: `OAuth ${token}`, offset: String(offset), file_size: String(ctx.fileSize), 'Content-Type': 'application/octet-stream', 'Content-Length': String(buf.length) },
          body: new Uint8Array(buf),
          signal: AbortSignal.timeout(600_000),
        });
        const body: any = await res.json().catch(() => ({}));
        if (!res.ok) throw classifyFacebookError(res.status, body);
        if (body?.success === false) throw new PublishError('transient', 'Facebook did not confirm the upload');
        return;
      } catch (err) {
        const pe = err instanceof PublishError ? err : new PublishError('transient', (err as Error).message);
        if (pe.kind !== 'transient' || attempt >= MAX_UPLOAD_ATTEMPTS) throw pe;
        await this.sleep(backoffMs(attempt));
        const st = await this.uploadStatus(session, token).catch(() => null);
        if (st?.kind === 'expired') throw new PublishError('transient', 'The upload session expired; it will start over', 'session_expired');
        if (st?.kind === 'partial') offset = Math.min(st.offset, ctx.fileSize);
        if (offset >= ctx.fileSize) return;
      }
    }
  }

  /**
   * "How much do you have?" (GET on the upload URL). The offset field name is not documented anywhere we could confirm, so
   * `start_offset`, `offset` and `bytes_transfered` are all accepted; when none is present the upload restarts from byte 0 of the same session.
   */
  private async uploadStatus(session: string, token: string): Promise<UploadStatus> {
    const res = await this.call(session, { method: 'GET', headers: { Authorization: `OAuth ${token}` }, signal: AbortSignal.timeout(30_000) });
    if (res.status === 404 || res.status === 410) return { kind: 'expired' };
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = classifyFacebookError(res.status, body);
      if (err.kind === 'auth') throw err;
      return { kind: 'partial', offset: 0 };
    }
    const n = Number(body.start_offset ?? body.offset ?? body.bytes_transfered ?? 0);
    return { kind: 'partial', offset: Number.isFinite(n) && n > 0 ? n : 0 };
  }

  // ------------------------------------------------------------------ verify

  async verify(input: { channelId: string; externalId: string; requestedPrivacy: string; scheduled: boolean; ageMs: number }): Promise<VerifyResult> {
    const { accessToken } = await this.tokens.page(input.channelId);
    let data: any;
    try {
      data = await this.get(`${GRAPH}/${encodeURIComponent(input.externalId)}`, { fields: 'status', access_token: accessToken });
    } catch (err) {
      if (err instanceof PublishError && err.code === 'not_found') {
        if (input.ageMs < 15 * 60_000) return { state: 'processing', warnings: [] };
        return { state: 'failed', warnings: [], error: 'The reel can no longer be found on Facebook (it may have been deleted).' };
      }
      throw err;
    }
    return mapReelStatus(data?.status);
  }

  private async alreadyPublished(videoId: string, token: string): Promise<boolean> {
    try {
      const data = await this.get(`${GRAPH}/${encodeURIComponent(videoId)}`, { fields: 'status', access_token: token });
      return mapReelStatus(data?.status).state === 'published';
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------------ metrics

  /**
   * Views come from the video's insights, likes and comments from the node. The insight metric names Meta supports for Page
   * reels change over time and could not be confirmed here, so each candidate is tried in turn; a video with no readable views
   * simply has no sample yet (the metrics job retries later). Confirm the names on the first real reel.
   */
  async collectMetrics(input: { channelId: string; externalIds: string[] }): Promise<Map<string, MetricSample | { removed: true }>> {
    const out = new Map<string, MetricSample | { removed: true }>();
    if (!input.externalIds.length) return out;
    const { accessToken } = await this.tokens.page(input.channelId);

    for (const id of input.externalIds) {
      let node: any;
      try {
        node = await this.get(`${GRAPH}/${encodeURIComponent(id)}`, { fields: 'likes.summary(true).limit(0),comments.summary(true).limit(0)', access_token: accessToken });
      } catch (err) {
        if (err instanceof PublishError && err.code === 'not_found') {
          out.set(id, { removed: true });
          continue;
        }
        if (err instanceof PublishError && (err.kind === 'auth' || err.kind === 'quota')) throw err;
        continue;
      }
      const views = await this.insight(id, accessToken, VIEW_METRICS);
      if (views === undefined) continue;
      const avgMs = await this.insight(id, accessToken, ['post_video_avg_time_watched']);
      out.set(id, {
        views,
        likes: numberOr(node?.likes?.summary?.total_count),
        comments: numberOr(node?.comments?.summary?.total_count),
        avgViewDurationSec: avgMs !== undefined ? Math.round(avgMs / 100) / 10 : undefined,
        provisional: true,
        source: 'facebook-graph-api',
        definition: 'Facebook reel plays (Page video insights)',
      });
    }
    return out;
  }

  /** The newest value of the first metric Facebook answers; undefined when none is readable. */
  private async insight(videoId: string, token: string, metrics: string[]): Promise<number | undefined> {
    for (const metric of metrics) {
      try {
        const data = await this.get(`${GRAPH}/${encodeURIComponent(videoId)}/video_insights`, { metric, access_token: token });
        const values: any[] = data?.data?.[0]?.values ?? [];
        const v = values.length ? values[values.length - 1]?.value : undefined;
        if (typeof v === 'number' && Number.isFinite(v)) return v;
      } catch (err) {
        if (err instanceof PublishError && (err.kind === 'auth' || err.kind === 'quota')) throw err;
        // an unknown metric (code 100) or a transient failure: try the next one
      }
    }
    return undefined;
  }

  // ------------------------------------------------------------------ http

  /** fetch with network failures turned into typed errors. */
  private async call(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchFn(url, init);
    } catch (err) {
      throw new PublishError('transient', `Network error talking to Facebook: ${(err as Error).message}`);
    }
  }

  /** Form POST (the token travels in the body, never in the URL). */
  private async post(url: string, params: Record<string, string>): Promise<any> {
    const res = await this.call(url, { method: 'POST', body: new URLSearchParams(params), signal: AbortSignal.timeout(60_000) });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || body?.error) throw classifyFacebookError(res.status, body);
    return body;
  }

  private async get(url: string, params: Record<string, string>): Promise<any> {
    const res = await this.call(`${url}?${new URLSearchParams(params)}`, { method: 'GET', signal: AbortSignal.timeout(30_000) });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || body?.error) throw classifyFacebookError(res.status, body);
    return body;
  }
}

/** Candidate Page-reel view metrics, newest naming first (see `collectMetrics`). */
const VIEW_METRICS = ['blue_reels_play_count', 'post_video_views'];
const numberOr = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const reelUrl = (videoId: string) => `https://www.facebook.com/reel/${videoId}`;

/**
 * The video node's `status` field: `{ video_status, uploading_phase, processing_phase, publishing_phase }`, each phase with a `status`
 * (and `errors` when it failed); the publishing phase also has `publish_status`. Field names follow Meta's Reels Publishing guide
 * but could not be re-checked against a live response, so unknown shapes are treated as "still processing".
 */
export function mapReelStatus(status: any): VerifyResult {
  const s = status ?? {};
  const phases = [s.uploading_phase, s.processing_phase, s.publishing_phase];
  const videoStatus = String(s.video_status ?? '').toLowerCase();
  const failedPhase = phases.find((p) => String(p?.status ?? '').toLowerCase() === 'error');
  if (videoStatus === 'error' || failedPhase) {
    const reason = failedPhase?.errors?.[0]?.message ?? s.errors?.[0]?.message;
    return { state: 'failed', warnings: [], error: reason ? `Facebook could not publish the reel: ${String(reason).slice(0, 200)}` : 'Facebook could not process or publish the reel.' };
  }
  const publish = s.publishing_phase;
  const published = String(publish?.publish_status ?? '').toLowerCase() === 'published' || (videoStatus === 'ready' && String(publish?.status ?? '').toLowerCase() === 'complete');
  if (published) return { state: 'published', actualPrivacy: 'public', warnings: [] };
  return { state: 'processing', warnings: [] };
}
