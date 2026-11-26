import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as fs from 'fs';
import { ReelPost, ReelPostDocument } from '../db/schemas/reel-post.schema';
import { backoffMs, classifyFacebookError, META_GRAPH_VERSION } from './facebook.publisher';
import { buildInstagramCaption } from './instagram-caption';
import { MetaTokenProvider } from './meta-token.provider';
import { preflightChecks } from './preflight';
import { PublisherRegistry } from './registry';
import { AccountStatus, Issue, MetricSample, PostMetadata, PublishContext, PublishError, PublishOutcome, Publisher, PublisherCapabilities, ReelFacts, VerifyResult } from './types';

const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const RUPLOAD = `https://rupload.facebook.com/ig-api-upload/${META_GRAPH_VERSION}`;
const FOLLOWERS_TTL_MS = 10 * 60_000;

/** Meta: "Instagram accounts are limited to 100 API-published posts within a 24-hour moving period" (Instagram content publishing guide). */
export const INSTAGRAM_POSTS_PER_24H = 100;
const MAX_UPLOAD_ATTEMPTS = 4;
/** After the bytes are sent Instagram processes the video; it is checked about every 10 s for this long, then the job retries later. */
const PROCESS_WAIT_MS = 6 * 60_000;
const PROCESS_POLL_MS = 10_000;

/**
 * Limits, from Meta's Instagram reel specification (developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media):
 * MP4/MOV, H264 or HEVC, AAC, 23-60 fps, aspect ratio 0.01:1 to 10:1 (9:16 recommended), 3 seconds to 15 minutes, 300 MB, caption 2200 characters
 * and 30 hashtags. Our reels are 9:16 and at most 90 seconds, so 90 is the guard used here (the platform would take far more).
 */
const CAPABILITIES: PublisherCapabilities = {
  label: 'Instagram Reels',
  maxDurationSec: 90,
  aspect: 'vertical',
  maxFileMB: 300,
  descriptionMax: 2200,
  visibilities: ['public'],
  supportsSchedule: false,
  delivery: 'push-bytes',
  metrics: ['views', 'likes', 'comments', 'shares', 'saves'],
};

/** Graph errors are the same shape as Facebook's; the few Instagram-specific ones are handled first. */
export function classifyInstagramError(status: number, body: any): PublishError {
  const e = body?.error ?? {};
  const sub = Number(e.error_subcode);
  const message = String(e.error_user_msg ?? e.message ?? `Instagram returned HTTP ${status}`).slice(0, 220);
  // 2207027: "the media is not ready for publishing" (still processing): wait and try again
  if (sub === 2207027 || Number(e.code) === 9007) return new PublishError('transient', message, '2207027', status);
  // 2207051: the account was restricted / the action blocked by Instagram's own checks: nothing should keep trying
  if (sub === 2207051) return new PublishError('fatal', `Instagram blocked the action for this account: ${message}`, '2207051', status);
  // 2207042 / 2207050: the account's own posting limit or restriction
  if (sub === 2207042) return new PublishError('quota', `Instagram's posting limit was reached: ${message}`, '2207042', status);
  return classifyFacebookError(status, body);
}

/** `https://rupload.facebook.com/ig-api-upload/v26.0/12345` -> `12345`. */
export function containerIdOf(uri: string): string | null {
  const m = /\/ig-api-upload\/[^/]+\/(\d+)/.exec(uri);
  return m ? m[1] : null;
}

/** The first number named `name` in an insights answer (`values[0].value` or `total_value.value`). */
export function insightValue(data: any, name: string): number | undefined {
  const row = (data?.data ?? []).find((r: any) => r?.name === name);
  const v = row?.values?.[row.values.length - 1]?.value ?? row?.total_value?.value;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

const numberOr = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * Posts Reels to an Instagram professional account with Meta's resumable upload flow (Instagram content publishing guide):
 *   POST /{ig-user}/media  media_type=REELS upload_type=resumable caption=...  -> container id + upload uri
 *   POST rupload.facebook.com/ig-api-upload/{container}  (bytes, `offset` + `file_size` headers)
 *   GET  /{container}?fields=status_code  until FINISHED
 *   POST /{ig-user}/media_publish creation_id={container}  -> media id
 * The Page access token of the Page the account is linked to is used (MetaTokenProvider.instagram).
 */
@Injectable()
export class InstagramPublisher implements Publisher, OnModuleInit {
  readonly platform = 'instagram' as const;
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
    let id: Awaited<ReturnType<MetaTokenProvider['instagram']>>;
    try {
      id = await this.tokens.instagram(channelId);
    } catch {
      return { platform: 'instagram', state: 'missing', message: 'Could not read the Instagram connection right now.' };
    }
    if (!id) return { platform: 'instagram', state: 'missing', message: 'No Instagram account is connected. Connect the Facebook login that owns it in the app Settings.' };
    const expired = !!id.tokenExpiresAt && id.tokenExpiresAt.getTime() <= Date.now();
    return {
      platform: 'instagram',
      state: expired ? 'needs_reconnect' : 'ok',
      externalId: id.igId,
      displayName: id.username ? `@${id.username}` : id.pageName,
      handle: id.username || undefined,
      message: expired ? 'The Facebook login behind Instagram has expired. Reconnect it in the app Settings.' : undefined,
      quota: { usedToday: await this.postsLast24h(channelId), dailyCap: INSTAGRAM_POSTS_PER_24H },
    };
  }

  private readonly followersCache = new Map<string, { at: number; value: { followers: number | null; mediaCount: number | null } }>();

  /** The account's follower and post counts for the app's Instagram overview. Cached 10 minutes; a problem gives nulls, never an error. */
  async accountStats(channelId: string): Promise<{ followers: number | null; mediaCount: number | null; fetchedAt: Date }> {
    const hit = this.followersCache.get(channelId);
    if (hit && Date.now() - hit.at < FOLLOWERS_TTL_MS) return { ...hit.value, fetchedAt: new Date(hit.at) };
    let value: { followers: number | null; mediaCount: number | null } = { followers: null, mediaCount: null };
    try {
      const { igId, accessToken } = await this.requireAccount(channelId);
      const data = await this.get(`${GRAPH}/${encodeURIComponent(igId)}`, { fields: 'followers_count,media_count', access_token: accessToken });
      value = { followers: numberOr(data?.followers_count) ?? null, mediaCount: numberOr(data?.media_count) ?? null };
    } catch {
      /* stays null */
    }
    const at = Date.now();
    this.followersCache.set(channelId, { at, value });
    return { ...value, fetchedAt: new Date(at) };
  }

  private postsLast24h(channelId: string): Promise<number> {
    return this.posts.countDocuments({
      channelId: new Types.ObjectId(channelId),
      platform: 'instagram',
      status: { $in: ['queued', 'uploading', 'processing', 'scheduled', 'published', 'blocked'] },
      createdAt: { $gte: new Date(Date.now() - 24 * 3_600_000) },
    });
  }

  private async requireAccount(channelId: string) {
    const id = await this.tokens.instagram(channelId);
    if (!id) throw new PublishError('auth', 'No Instagram account is connected. Connect the Facebook login that owns it in the app Settings.', 'no_instagram_connection');
    if (id.tokenExpiresAt && id.tokenExpiresAt.getTime() <= Date.now()) {
      throw new PublishError('auth', 'The Facebook login behind Instagram has expired. Reconnect it in the app Settings.', 'meta_token_expired');
    }
    return id;
  }

  // ------------------------------------------------------------------ preflight

  preflight(input: { reel: ReelFacts; metadata: PostMetadata; account: AccountStatus; hasActiveDuplicate: boolean }): Issue[] {
    const metadata: PostMetadata = { ...input.metadata, privacy: 'public' };
    const YOUTUBE_ONLY = new Set(['tags_trimmed', 'description_truncated', 'title_adjusted']);
    const issues = preflightChecks({ caps: this.capabilities, ...input, metadata })
      .filter((i) => !YOUTUBE_ONLY.has(i.code))
      .map((i): Issue => {
        if (i.code === 'daily_cap') return { ...i, message: `Instagram allows ${INSTAGRAM_POSTS_PER_24H} reels per 24 hours through the API. Try again when older posts are more than a day old.` };
        if (i.code === 'rights') return { ...i, message: 'Public posting: this reel is cut from your long videos and may contain third-party clips (news footage, music) that Instagram can flag for rights.' };
        if (i.code === 'not_vertical') return { ...i, message: i.message.replace(' It must be vertical or square to count as a Short.', ' Instagram Reels should be vertical (9:16).') };
        return i;
      });
    if (!buildInstagramCaption(metadata)) issues.push({ level: 'error', code: 'caption_empty', message: 'The Instagram caption is empty.' });
    return issues;
  }

  // ------------------------------------------------------------------ publish

  async publish(input: { channelId: string; metadata: PostMetadata; sessionUri?: string | null; ctx: PublishContext }): Promise<PublishOutcome> {
    const { channelId, metadata, ctx } = input;
    const { igId, accessToken } = await this.requireAccount(channelId);
    const caption = buildInstagramCaption(metadata);
    if (!caption) throw new PublishError('invalid_metadata', 'The Instagram caption is empty.');
    if (ctx.fileSize <= 0) throw new PublishError('media', 'The reel file is empty');

    let uri: string | null = input.sessionUri ?? null;
    let containerId: string | null = uri ? containerIdOf(uri) : null;
    let uploaded = false;

    if (containerId) {
      // A retry: ask where the container stands before doing anything twice.
      const st = await this.containerStatus(containerId, accessToken).catch(() => null);
      if (!st || st.code === 'EXPIRED' || st.code === 'ERROR') {
        uri = null;
        containerId = null;
      } else if (st.code === 'PUBLISHED') {
        const existing = await this.findPublished(igId, accessToken, caption);
        if (existing) return existing;
        uri = null;
        containerId = null;
      } else {
        uploaded = st.code === 'FINISHED' || st.uploadComplete;
      }
    }

    if (!containerId) {
      if (await ctx.shouldCancel()) throw new PublishError('cancelled', 'Cancelled by user');
      const created = await this.post(`${GRAPH}/${encodeURIComponent(igId)}/media`, { media_type: 'REELS', upload_type: 'resumable', caption, access_token: accessToken });
      containerId = String(created.id ?? '');
      if (!containerId) throw new PublishError('fatal', 'Instagram did not return a container id for the upload');
      uri = typeof created.uri === 'string' && created.uri ? created.uri : `${RUPLOAD}/${containerId}`;
      await ctx.saveSession(uri, 0);
      uploaded = false;
    }

    if (!uploaded) await this.sendBytes(uri as string, accessToken, ctx);
    await ctx.saveSession(uri as string, ctx.fileSize);
    if (await ctx.shouldCancel()) throw new PublishError('cancelled', 'Cancelled by user');

    await this.waitUntilFinished(containerId, accessToken);

    const published = await this.post(`${GRAPH}/${encodeURIComponent(igId)}/media_publish`, { creation_id: containerId, access_token: accessToken });
    const mediaId = String(published.id ?? '');
    if (!mediaId) throw new PublishError('fatal', 'Instagram did not return the id of the published reel');
    return { externalId: mediaId, url: (await this.permalink(mediaId, accessToken)) ?? 'https://www.instagram.com/', warnings: [] };
  }

  /** Polls the container until FINISHED. ERROR/EXPIRED fail the post; running out of time is a retry (the saved container is reused). */
  private async waitUntilFinished(containerId: string, token: string): Promise<void> {
    const until = Date.now() + PROCESS_WAIT_MS;
    for (;;) {
      const st = await this.containerStatus(containerId, token);
      if (st.code === 'FINISHED') return;
      if (st.code === 'ERROR' || st.code === 'EXPIRED') {
        throw new PublishError('media', `Instagram could not process the reel: ${st.text || st.code}`.slice(0, 240), st.code === 'EXPIRED' ? 'expired' : 'processing_error');
      }
      if (Date.now() >= until) throw new PublishError('transient', 'Instagram is still processing the reel; it will be checked again shortly.', 'still_processing');
      await this.sleep(PROCESS_POLL_MS);
    }
  }

  private async containerStatus(containerId: string, token: string): Promise<{ code: string; text: string; uploadComplete: boolean }> {
    const data = await this.get(`${GRAPH}/${encodeURIComponent(containerId)}`, { fields: 'id,status,status_code,video_status', access_token: token });
    return {
      code: String(data?.status_code ?? '').toUpperCase(),
      text: String(data?.status ?? ''),
      uploadComplete: String(data?.video_status?.uploading_phase?.status ?? '').toLowerCase() === 'complete',
    };
  }

  /** After a lost answer to `media_publish`: the reel may be out already; match it by its caption among the newest media. */
  private async findPublished(igId: string, token: string, caption: string): Promise<PublishOutcome | null> {
    try {
      const data = await this.get(`${GRAPH}/${encodeURIComponent(igId)}/media`, { fields: 'id,caption,permalink,timestamp', limit: '10', access_token: token });
      const hit = (data?.data ?? []).find((m: any) => String(m?.caption ?? '').trim() === caption.trim());
      return hit ? { externalId: String(hit.id), url: String(hit.permalink ?? 'https://www.instagram.com/'), warnings: [] } : null;
    } catch {
      return null;
    }
  }

  private async permalink(mediaId: string, token: string): Promise<string | null> {
    for (let i = 0; i < 3; i++) {
      try {
        const data = await this.get(`${GRAPH}/${encodeURIComponent(mediaId)}`, { fields: 'permalink', access_token: token });
        if (typeof data?.permalink === 'string' && data.permalink) return data.permalink;
      } catch {
        /* try again */
      }
      await this.sleep(2_000);
    }
    return null;
  }

  /** One POST with the whole file (a reel is small); retries start again from byte 0 of the same container. */
  private async sendBytes(uri: string, token: string, ctx: PublishContext): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      if (await ctx.shouldCancel()) throw new PublishError('cancelled', 'Cancelled by user');
      const buf = await fs.promises.readFile(ctx.filePath);
      try {
        const res = await this.call(uri, {
          method: 'POST',
          // Exactly the three headers Meta documents: adding Content-Type / Content-Length made Instagram answer "Request processing failed" (checked live 2026-11-26).
          headers: { Authorization: `OAuth ${token}`, offset: '0', file_size: String(ctx.fileSize) },
          body: new Uint8Array(buf),
          signal: AbortSignal.timeout(600_000),
        });
        const body: any = await res.json().catch(() => ({}));
        if (!res.ok || body?.error) throw classifyInstagramError(res.status, body?.error ? body : { error: { message: body?.debug_info?.message ?? `Upload failed (HTTP ${res.status})`, is_transient: body?.debug_info?.retriable === true } });
        if (body?.success === false) throw new PublishError('transient', 'Instagram did not confirm the upload');
        return;
      } catch (err) {
        const pe = err instanceof PublishError ? err : new PublishError('transient', (err as Error).message);
        if (pe.kind !== 'transient' || attempt >= MAX_UPLOAD_ATTEMPTS) throw pe;
        await this.sleep(backoffMs(attempt));
      }
    }
  }

  // ------------------------------------------------------------------ verify

  async verify(input: { channelId: string; externalId: string; requestedPrivacy: string; scheduled: boolean; ageMs: number }): Promise<VerifyResult> {
    const { accessToken } = await this.requireAccount(input.channelId);
    try {
      const data = await this.get(`${GRAPH}/${encodeURIComponent(input.externalId)}`, { fields: 'id,permalink,media_product_type', access_token: accessToken });
      return data?.id ? { state: 'published', actualPrivacy: 'public', warnings: [] } : { state: 'processing', warnings: [] };
    } catch (err) {
      if (err instanceof PublishError && err.code === 'not_found') {
        if (input.ageMs < 15 * 60_000) return { state: 'processing', warnings: [] };
        return { state: 'failed', warnings: [], error: 'The reel can no longer be found on Instagram (it may have been deleted).' };
      }
      throw err;
    }
  }

  // ------------------------------------------------------------------ metrics

  /**
   * Plays, likes, comments, saves and shares of each reel. Insight metric names for reels have changed over the years (`plays` was
   * replaced by `views`), so a short list is tried in turn; a reel with no readable views simply has no sample yet.
   */
  async collectMetrics(input: { channelId: string; externalIds: string[] }): Promise<Map<string, MetricSample | { removed: true }>> {
    const out = new Map<string, MetricSample | { removed: true }>();
    if (!input.externalIds.length) return out;
    const { accessToken } = await this.requireAccount(input.channelId);

    for (const id of input.externalIds) {
      let node: any;
      try {
        node = await this.get(`${GRAPH}/${encodeURIComponent(id)}`, { fields: 'like_count,comments_count', access_token: accessToken });
      } catch (err) {
        if (err instanceof PublishError && err.code === 'not_found') {
          out.set(id, { removed: true });
          continue;
        }
        if (err instanceof PublishError && (err.kind === 'auth' || err.kind === 'quota')) throw err;
        continue;
      }
      let insights: any = null;
      for (const metric of ['views,reach,saved,shares', 'views', 'plays']) {
        try {
          insights = await this.get(`${GRAPH}/${encodeURIComponent(id)}/insights`, { metric, access_token: accessToken });
          break;
        } catch (err) {
          if (err instanceof PublishError && (err.kind === 'auth' || err.kind === 'quota')) throw err;
          // an unknown metric (code 100) or a transient failure: try the next list
        }
      }
      const views = insightValue(insights, 'views') ?? insightValue(insights, 'plays');
      if (views === undefined) continue;
      const watch = await this.get(`${GRAPH}/${encodeURIComponent(id)}/insights`, { metric: 'ig_reels_avg_watch_time', access_token: accessToken }).catch(() => null);
      const avgMs = insightValue(watch, 'ig_reels_avg_watch_time');
      out.set(id, {
        views,
        likes: numberOr(node?.like_count),
        comments: numberOr(node?.comments_count),
        saves: insightValue(insights, 'saved'),
        shares: insightValue(insights, 'shares'),
        avgViewDurationSec: avgMs !== undefined ? Math.round(avgMs / 100) / 10 : undefined,
        provisional: true,
        source: 'instagram-graph-api',
        definition: 'Instagram reel views (media insights)',
      });
    }
    return out;
  }

  // ------------------------------------------------------------------ http

  private async call(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchFn(url, init);
    } catch (err) {
      throw new PublishError('transient', `Network error talking to Instagram: ${(err as Error).message}`);
    }
  }

  /** Form POST (the token travels in the body, never in the URL). */
  private async post(url: string, params: Record<string, string>): Promise<any> {
    const res = await this.call(url, { method: 'POST', body: new URLSearchParams(params), signal: AbortSignal.timeout(60_000) });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || body?.error) throw classifyInstagramError(res.status, body);
    return body;
  }

  private async get(url: string, params: Record<string, string>): Promise<any> {
    const res = await this.call(`${url}?${new URLSearchParams(params)}`, { method: 'GET', signal: AbortSignal.timeout(30_000) });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || body?.error) throw classifyInstagramError(res.status, body);
    return body;
  }
}
