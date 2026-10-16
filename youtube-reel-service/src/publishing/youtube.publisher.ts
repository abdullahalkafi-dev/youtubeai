import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppConfig, CONFIG } from '../config/config';
import { SharedVideoDailyStat, SharedVideoDailyStatDocument, SourceVideo, SourceVideoDocument } from '../db/schemas/shared.readonly';
import { GoogleTokenProvider } from './google-token.provider';
import { preflightChecks } from './preflight';
import { PublishQuotaService } from './publish-quota.service';
import { PublisherRegistry } from './registry';
import {
  AccountStatus,
  Issue,
  MetricSample,
  PostMetadata,
  PublishContext,
  PublishError,
  PublishOutcome,
  Privacy,
  Publisher,
  PublisherCapabilities,
  ReelFacts,
  VerifyResult,
} from './types';
import { buildInsertBody } from './youtube-metadata';
import { classifyYouTubeError, YouTubeUploader } from './youtube-uploader';

const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';

const REJECTION_TEXT: Record<string, string> = {
  claim: 'YouTube rejected it: a copyright claim.',
  copyright: 'YouTube rejected it for copyright.',
  duplicate: 'YouTube rejected it as a duplicate of a video already uploaded.',
  inappropriate: 'YouTube rejected it as inappropriate content.',
  legal: 'YouTube rejected it for legal reasons.',
  length: 'YouTube rejected it: the video length is not allowed.',
  termsOfUse: 'YouTube rejected it for violating the terms of use.',
  trademark: 'YouTube rejected it for a trademark issue.',
  uploaderAccountClosed: 'YouTube rejected it: the uploader account is closed.',
  uploaderAccountSuspended: 'YouTube rejected it: the uploader account is suspended.',
};
const FAILURE_TEXT: Record<string, string> = {
  codec: 'YouTube could not process the video codec.',
  conversion: 'YouTube failed to convert the video.',
  emptyFile: 'YouTube received an empty file.',
  invalidFile: 'YouTube says the file is not a valid video.',
  tooSmall: 'YouTube says the file is too small.',
  uploadAborted: 'The upload was aborted.',
};

@Injectable()
export class YouTubePublisher implements Publisher, OnModuleInit {
  readonly platform = 'youtube' as const;
  readonly capabilities: PublisherCapabilities = {
    label: 'YouTube Shorts',
    maxDurationSec: 180,
    aspect: 'vertical-or-square',
    maxFileMB: 256 * 1024,
    titleMax: 100,
    descriptionMax: 5000,
    visibilities: ['private', 'unlisted', 'public'],
    supportsSchedule: true,
    delivery: 'push-bytes',
    metrics: ['views', 'likes', 'comments', 'watchMinutes', 'avgViewPct', 'subscribersGained'],
  };

  readonly uploader: YouTubeUploader;
  /** Overridable in tests. */
  fetchFn: typeof fetch = (input, init) => fetch(input, init);
  private readonly statusCache = new Map<string, { at: number; value: AccountStatus }>();

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly tokens: GoogleTokenProvider,
    private readonly quota: PublishQuotaService,
    private readonly registry: PublisherRegistry,
    @InjectModel(SourceVideo.name) private readonly videos: Model<SourceVideoDocument>,
    @InjectModel(SharedVideoDailyStat.name) private readonly daily: Model<SharedVideoDailyStatDocument>,
  ) {
    this.uploader = new YouTubeUploader(cfg.PUBLISH_CHUNK_MB);
  }

  onModuleInit() {
    this.registry.register(this);
  }

  async getAccountStatus(channelId: string): Promise<AccountStatus> {
    const hit = this.statusCache.get(channelId);
    if (hit && Date.now() - hit.at < 60_000) return { ...hit.value, quota: await this.quotaInfo() };

    const id = await this.tokens.identity(channelId);
    const base: AccountStatus = {
      platform: 'youtube',
      state: 'ok',
      externalId: id.youtubeChannelId,
      displayName: id.name,
      handle: id.handle,
      quota: await this.quotaInfo(),
    };
    let value = base;
    try {
      const token = await this.tokens.getAccessToken(channelId);
      const scope = await this.tokens.canUpload(token);
      if (!scope.ok) value = { ...base, state: 'needs_reconnect', message: 'The Google login does not include upload permission. Reconnect Google in the app.' };
    } catch (err) {
      if (err instanceof PublishError && err.kind === 'auth') value = { ...base, state: 'needs_reconnect', message: err.message };
      else if (err instanceof PublishError) value = { ...base, message: `Could not verify the Google login right now (${err.message})` };
      else throw err;
    }
    this.statusCache.set(channelId, { at: Date.now(), value });
    return value;
  }

  /** Drop the cached status (after a failed upload or a reconnect). */
  invalidate(channelId: string) {
    this.statusCache.delete(channelId);
  }

  private async quotaInfo() {
    return { usedToday: await this.quota.usedToday('yt'), dailyCap: this.quota.dailyCap };
  }

  preflight(input: { reel: ReelFacts; metadata: PostMetadata; account: AccountStatus; hasActiveDuplicate: boolean }): Issue[] {
    return preflightChecks({ caps: this.capabilities, ...input });
  }

  async publish(input: { channelId: string; metadata: PostMetadata; sessionUri?: string | null; ctx: PublishContext }): Promise<PublishOutcome> {
    const { channelId, metadata, ctx } = input;
    const { body, warnings } = buildInsertBody(metadata);
    try {
      const result = await this.uploader.upload({
        body,
        notifySubscribers: metadata.notifySubscribers && metadata.privacy === 'public' && !metadata.scheduleAt,
        filePath: ctx.filePath,
        fileSize: ctx.fileSize,
        sessionUri: input.sessionUri,
        getToken: () => this.tokens.getAccessToken(channelId),
        refreshToken: () => this.tokens.getAccessToken(channelId, { forceRefresh: true }),
        saveSession: async (uri, bytes) => {
          // A brand-new session = one upload against YouTube's allowance (a resumed session is not counted again).
          if (uri && uri !== input.sessionUri && bytes === 0) await this.quota.recordUpload('yt');
          await ctx.saveSession(uri, bytes);
        },
        shouldCancel: ctx.shouldCancel,
      });
      this.invalidate(channelId);
      return { externalId: result.id, url: `https://www.youtube.com/shorts/${result.id}`, warnings };
    } catch (err) {
      if (err instanceof PublishError && (err.kind === 'auth' || err.kind === 'quota')) this.invalidate(channelId);
      throw err;
    }
  }

  async verify(input: { channelId: string; externalId: string; requestedPrivacy: Privacy; scheduled: boolean; ageMs: number }): Promise<VerifyResult> {
    const call = async (token: string) =>
      this.fetchFn(`${VIDEOS_URL}?part=status,processingDetails,statistics,contentDetails&id=${encodeURIComponent(input.externalId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
      });
    let res: Response;
    try {
      res = await call(await this.tokens.getAccessToken(input.channelId));
      if (res.status === 401) res = await call(await this.tokens.getAccessToken(input.channelId, { forceRefresh: true }));
    } catch (err) {
      if (err instanceof PublishError) throw err;
      throw new PublishError('transient', `Could not reach YouTube to verify the upload: ${(err as Error).message}`);
    }
    if (!res.ok) throw classifyYouTubeError(res.status, await res.json().catch(() => ({})));

    const data: any = await res.json();
    const item = data.items?.[0];
    if (!item) {
      if (input.ageMs < 15 * 60_000) return { state: 'processing', warnings: [] };
      return { state: 'failed', warnings: [], error: 'The video can no longer be found on YouTube (it may have been deleted).' };
    }

    const st = item.status ?? {};
    const warnings: string[] = [];
    const actual = st.privacyStatus as Privacy | undefined;
    const stats: MetricSample | undefined = item.statistics
      ? {
          views: Number(item.statistics.viewCount ?? 0),
          likes: item.statistics.likeCount !== undefined ? Number(item.statistics.likeCount) : undefined,
          comments: item.statistics.commentCount !== undefined ? Number(item.statistics.commentCount) : undefined,
          source: 'youtube-data-api',
          definition: 'YouTube public view count',
        }
      : undefined;

    if (st.uploadStatus === 'rejected') {
      return { state: 'failed', actualPrivacy: actual, warnings, error: REJECTION_TEXT[st.rejectionReason] ?? `YouTube rejected the upload (${st.rejectionReason ?? 'unknown reason'}).`, stats };
    }
    if (st.uploadStatus === 'failed') {
      return { state: 'failed', actualPrivacy: actual, warnings, error: FAILURE_TEXT[st.failureReason] ?? `YouTube failed to process the video (${st.failureReason ?? 'unknown reason'}).`, stats };
    }
    if (st.uploadStatus === 'deleted') return { state: 'failed', actualPrivacy: actual, warnings, error: 'The video was deleted on YouTube.', stats };

    const processing = item.processingDetails?.processingStatus;
    if (st.uploadStatus === 'uploaded' || processing === 'processing') return { state: 'processing', actualPrivacy: actual, warnings, stats };
    if (processing === 'failed' || processing === 'terminated') {
      return { state: 'failed', actualPrivacy: actual, warnings, error: 'YouTube could not finish processing the video.', stats };
    }

    // Processed. Did YouTube honour the visibility we asked for? (Old policy forced API uploads from unaudited projects private.)
    const expected: Privacy = input.scheduled ? 'private' : input.requestedPrivacy;
    if (actual && actual !== expected) {
      warnings.push(
        actual === 'private' && expected !== 'private'
          ? 'YouTube set this video to PRIVATE although another visibility was requested. This can happen for API projects that have not passed Google\'s API audit — check the video in YouTube Studio.'
          : `Requested ${expected} but YouTube set it to ${actual}.`,
      );
    }
    return { state: 'published', actualPrivacy: actual, warnings, stats };
  }

  /**
   * YouTube numbers come from data the main app already syncs (hourly `videos` + daily `video_daily_stats`),
   * so this costs zero extra API quota. Videos not synced yet simply have no sample.
   */
  async collectMetrics(input: { channelId: string; externalIds: string[] }): Promise<Map<string, MetricSample | { removed: true }>> {
    const out = new Map<string, MetricSample | { removed: true }>();
    if (!input.externalIds.length) return out;
    const vids = await this.videos
      .find({ youtubeId: { $in: input.externalIds }, channelId: new Types.ObjectId(input.channelId) })
      .select('youtubeId viewCount likeCount commentCount deletedFromYoutube lastSyncedAt')
      .lean();
    if (!vids.length) return out;
    const rows = await this.daily.find({ videoId: { $in: vids.map((v) => v._id) } }).lean();
    const byVideo = new Map<string, typeof rows>();
    for (const r of rows) byVideo.set(String(r.videoId), [...(byVideo.get(String(r.videoId)) ?? []), r]);

    const recent = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    for (const v of vids) {
      if (v.deletedFromYoutube) {
        out.set(v.youtubeId, { removed: true });
        continue;
      }
      const days = byVideo.get(String(v._id)) ?? [];
      const dailyViews = days.reduce((n, d) => n + (d.views ?? 0), 0);
      const retentionWeight = days.reduce((n, d) => n + (d.retentionPct !== undefined && d.retentionPct !== null ? (d.views ?? 0) : 0), 0);
      const retention = retentionWeight
        ? days.reduce((n, d) => n + (d.retentionPct !== undefined && d.retentionPct !== null ? d.retentionPct * (d.views ?? 0) : 0), 0) / retentionWeight
        : undefined;
      out.set(v.youtubeId, {
        views: Math.max(v.viewCount ?? 0, dailyViews),
        likes: v.likeCount,
        comments: v.commentCount,
        watchMinutes: days.length ? Math.round(days.reduce((n, d) => n + (d.watchMinutes ?? 0), 0) * 10) / 10 : undefined,
        avgViewPct: retention !== undefined ? Math.round(retention * 10) / 10 : undefined,
        subscribersGained: days.length ? days.reduce((n, d) => n + (d.subsGained ?? 0), 0) : undefined,
        provisional: !days.length || days.some((d) => d.date >= recent),
        source: 'main-app-sync',
        definition: 'YouTube public views (a view counts when a play starts)',
        raw: { syncedAt: v.lastSyncedAt ?? null, dailyRows: days.length },
      });
    }
    return out;
  }
}
