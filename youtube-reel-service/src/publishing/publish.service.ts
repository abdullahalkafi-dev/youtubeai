import type { ReelTrack } from '../db/schemas/reel-campaign.schema';
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ThumbnailService } from '../pipeline/thumbnail.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import { AppConfig, CONFIG } from '../config/config';
import { errMsg } from '../common/errors';
import { Reel, ReelDocument } from '../db/schemas/reel.schema';
import { ReelPost, ReelPostDocument } from '../db/schemas/reel-post.schema';
import { SourceVideo, SourceVideoDocument } from '../db/schemas/shared.readonly';
import { QueueService, PublishJob } from '../queue/queue.service';
import { BUCKETS, StorageService } from '../storage/storage.service';
import { ensureDir, removeDir } from '../pipeline/media';
import { firstCheckpointAt } from './checkpoints';
import { UPLOAD_LEAD_MS } from './auto-plan';
import { hasErrors } from './preflight';
import { msUntilPacificMidnight, PublishQuotaService } from './publish-quota.service';
import { PublisherRegistry } from './registry';
import { YouTubePublisher } from './youtube.publisher';
import { ACTIVE_POST_STATUSES, AccountStatus, Issue, PLATFORMS, PlatformId, PostMetadata, PostStatus, Privacy, Publisher, PublishError, ReelFacts } from './types';

const MAX_UPLOAD_ATTEMPTS = 5;
const VERIFY_DELAYS_MS = [90_000, 3 * 60_000, 6 * 60_000, 12 * 60_000, 20 * 60_000, 30 * 60_000, 45 * 60_000, 60 * 60_000];

export interface PublishInput {
  platform: PlatformId;
  metadata?: Partial<PostMetadata>;
  confirm?: boolean;
  allowDuplicate?: boolean;
}

@Injectable()
export class PublishService {
  private readonly logger = new Logger(PublishService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @InjectModel(ReelPost.name) private readonly posts: Model<ReelPostDocument>,
    @InjectModel(Reel.name) private readonly reels: Model<ReelDocument>,
    @InjectModel(SourceVideo.name) private readonly videos: Model<SourceVideoDocument>,
    private readonly registry: PublisherRegistry,
    private readonly quota: PublishQuotaService,
    private readonly storage: StorageService,
    private readonly queues: QueueService,
    private readonly youtube: YouTubePublisher, // injected so the adapter registers itself at startup
    private readonly thumbnails: ThumbnailService,
  ) {}

  // ------------------------------------------------------------------ helpers

  private publisher(platform: PlatformId): Publisher {
    const p = this.registry.get(platform);
    if (!p) throw new BadRequestException(`Publishing to "${platform}" is not available yet`);
    return p;
  }

  private factsOf(reel: ReelDocument | (Reel & { _id: unknown })): ReelFacts {
    return {
      id: String(reel._id),
      durationSec: reel.durationSec,
      width: reel.qa?.width,
      height: reel.qa?.height,
      sizeBytes: reel.assets?.sizeBytes,
      hasAsset: !!reel.assets?.videoKey && ['todo', 'posted', 'rejected'].includes(reel.status),
      status: reel.status,
      warnings: reel.qa?.warnings ?? [],
    };
  }

  /** Prefilled from the AI packaging; category taken from the most common category of the source videos. */
  async defaultMetadata(reel: ReelDocument | (Reel & { _id: unknown })): Promise<PostMetadata> {
    const p = reel.packaging;
    let categoryId = '22';
    try {
      const ids = [...new Set(reel.clips.map((c) => c.youtubeId))];
      const vids = await this.videos.find({ youtubeId: { $in: ids } }).select('categoryId').lean();
      const counts = new Map<string, number>();
      for (const v of vids) if (v.categoryId) counts.set(v.categoryId, (counts.get(v.categoryId) ?? 0) + 1);
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top) categoryId = top[0];
    } catch {
      /* fall back to People & Blogs */
    }
    return {
      title: p?.title ?? reel.concept,
      description: p?.description ?? reel.concept,
      tags: p?.tags ?? [],
      hashtags: p?.hashtags ?? [],
      categoryId,
      privacy: this.cfg.PUBLISH_DEFAULT_PRIVACY,
      scheduleAt: null,
      madeForKids: false,
      // Realistic AI images of real people must be declared as altered/synthetic content on YouTube.
      containsSyntheticMedia: !!reel.visuals?.some((v) => v.status === 'ready' && v.realPerson),
      notifySubscribers: false,
    };
  }

  private mergeMetadata(defaults: PostMetadata, o: Partial<PostMetadata> = {}): PostMetadata {
    return {
      ...defaults,
      ...Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)),
      scheduleAt: o.scheduleAt === undefined ? defaults.scheduleAt : o.scheduleAt || null,
    } as PostMetadata;
  }

  private async loadReel(channelId: string, reelId: string) {
    if (!Types.ObjectId.isValid(reelId)) throw new NotFoundException('Reel not found');
    const reel = await this.reels.findOne({ _id: reelId, channelId });
    if (!reel) throw new NotFoundException('Reel not found');
    return reel;
  }

  // ------------------------------------------------------------------ preflight + create

  async preflight(channelId: string, reelId: string, platform: PlatformId, overrides?: Partial<PostMetadata>, allowDuplicate = false) {
    const publisher = this.publisher(platform);
    const reel = await this.loadReel(channelId, reelId);
    const defaults = await this.defaultMetadata(reel);
    const metadata = this.mergeMetadata(defaults, overrides);
    const account = await publisher.getAccountStatus(channelId);
    const duplicate = allowDuplicate ? false : !!(await this.findActiveDuplicate(reelId, platform, account));
    const issues = publisher.preflight({ reel: this.factsOf(reel), metadata, account, hasActiveDuplicate: duplicate });
    return { defaults, metadata, account, issues, capabilities: publisher.capabilities, canPublish: !hasErrors(issues) };
  }

  private findActiveDuplicate(reelId: string, platform: PlatformId, account: AccountStatus) {
    return this.posts
      .findOne({
        reelId: new Types.ObjectId(reelId),
        platform,
        status: { $in: ACTIVE_POST_STATUSES },
        ...(account.externalId ? { accountExternalId: account.externalId } : {}),
      })
      .select('_id')
      .lean();
  }

  /** The ONLY way an API post comes into existence: an explicit, confirmed request from a signed-in person. */
  async createPost(channelId: string, userId: string, reelId: string, input: PublishInput) {
    if (input.confirm !== true) throw new BadRequestException('Publishing needs an explicit confirmation');
    const pre = await this.preflight(channelId, reelId, input.platform, input.metadata, !!input.allowDuplicate);
    if (!pre.canPublish) {
      throw new BadRequestException({ message: 'The reel cannot be published yet', issues: pre.issues.filter((i) => i.level === 'error') });
    }
    const reel = await this.loadReel(channelId, reelId);
    const stat = reel.assets.videoKey ? await this.storage.stat(BUCKETS.reels, reel.assets.videoKey) : null;
    if (!stat) throw new BadRequestException('The rendered video file is missing. Re-render the reel first.');

    const requestedPrivacy: Privacy = pre.metadata.scheduleAt ? 'private' : pre.metadata.privacy;
    const post = await this.posts.create({
      reelId: reel._id,
      campaignId: reel.campaignId,
      channelId: reel.channelId,
      platform: input.platform,
      accountExternalId: pre.account.externalId,
      accountName: pre.account.displayName,
      source: 'api',
      status: 'queued',
      metadata: pre.metadata,
      approvedBy: new Types.ObjectId(userId),
      approvedAt: new Date(),
      assetKey: reel.assets.videoKey,
      assetSizeBytes: stat.size,
      requestedPrivacy,
      warnings: pre.issues.filter((i) => i.level !== 'error').map((i) => i.message),
    });
    await this.queues.publish(String(post._id), 'upload');
    return this.serialize(post.toObject());
  }

  /**
   * A post made by Auto-publish: only ever called by AutoPublishService, which exists only behind the client's Auto-publish switch.
   * The upload starts shortly before `runAt` from OUR queue (not scheduled on YouTube), so cancelling, moving or publishing now
   * before that time costs nothing and never touches YouTube.
   */
  async createAutoPost(
    channelId: string,
    ownerUserId: string,
    reelId: string,
    o: { runAt: Date; slot: string; planDate: string; mode: 'rotation' | 'bandit'; privacy: 'public' | 'unlisted'; track: ReelTrack; score: number | null },
  ) {
    const pre = await this.preflight(channelId, reelId, 'youtube', { privacy: o.privacy, scheduleAt: null });
    if (!pre.canPublish) throw new BadRequestException({ message: 'The reel cannot be published yet', issues: pre.issues.filter((i) => i.level === 'error') });
    const reel = await this.loadReel(channelId, reelId);
    const stat = reel.assets.videoKey ? await this.storage.stat(BUCKETS.reels, reel.assets.videoKey) : null;
    if (!stat) throw new BadRequestException('The rendered video file is missing. Re-render the reel first.');
    const post = await this.posts.create({
      reelId: reel._id,
      campaignId: reel.campaignId,
      channelId: reel.channelId,
      platform: 'youtube',
      accountExternalId: pre.account.externalId,
      accountName: pre.account.displayName,
      source: 'auto',
      status: 'queued',
      metadata: pre.metadata,
      approvedBy: new Types.ObjectId(ownerUserId),
      approvedAt: new Date(),
      assetKey: reel.assets.videoKey,
      assetSizeBytes: stat.size,
      requestedPrivacy: o.privacy,
      // The standing advisories (e.g. "may contain third-party clips") are NOT copied here: `warnings` is what YouTube itself reports,
      // and the stop-by-itself rule reads it. A permanent advisory would trip that rule on the first post.
      warnings: [],
      autoPlan: { slot: o.slot, runAt: o.runAt, planDate: o.planDate, mode: o.mode, track: o.track, score: o.score },
    });
    await this.queues.publish(String(post._id), 'upload', Math.max(0, o.runAt.getTime() - Date.now() - UPLOAD_LEAD_MS));
    return this.serialize(post.toObject());
  }

  /** Remove the waiting timer(s) of a post that has not started uploading. */
  private async dropWaitingJobs(postId: string) {
    const jobs = await this.queues.q.publish.getJobs(['delayed', 'waiting']);
    for (const j of jobs) if (j && String(j.data?.postId) === postId && j.data?.step === 'upload') await j.remove().catch(() => undefined);
  }

  /** "Publish now" / "Move" for an auto post that has not started uploading. */
  async rescheduleAuto(channelId: string, postId: string, runAt: Date) {
    const post = await this.loadPost(channelId, postId);
    if (post.source !== 'auto' || post.status !== 'queued') throw new BadRequestException('Only an automatic post that has not started uploading can be moved');
    if (!Number.isFinite(runAt.getTime())) throw new BadRequestException('The time is not valid');
    await this.dropWaitingJobs(postId);
    await this.posts.updateOne({ _id: post._id }, { $set: { 'autoPlan.runAt': runAt, 'autoPlan.movedByClient': true } });
    await this.queues.publish(postId, 'upload', Math.max(0, runAt.getTime() - Date.now() - UPLOAD_LEAD_MS));
    return { ok: true, runAt };
  }

  /** Record a post made outside the app (any platform) so it is still tracked against the reel. */
  async createManual(channelId: string, userId: string, reelId: string, input: { platform: PlatformId; url: string; postedAt?: string }) {
    const reel = await this.loadReel(channelId, reelId);
    if (!PLATFORMS.includes(input.platform)) throw new BadRequestException('Unknown platform');
    const externalId = input.platform === 'youtube' ? parseYouTubeId(input.url) : undefined;
    if (input.platform === 'youtube' && !externalId) throw new BadRequestException('That does not look like a YouTube video or Shorts link');
    if (externalId && (await this.posts.exists({ platform: 'youtube', externalId }))) throw new ConflictException('That YouTube video is already tracked');

    const publishedAt = input.postedAt ? new Date(input.postedAt) : new Date();
    if (Number.isNaN(publishedAt.getTime())) throw new BadRequestException('Invalid posted date');
    const defaults = await this.defaultMetadata(reel);
    const post = await this.posts.create({
      reelId: reel._id,
      campaignId: reel.campaignId,
      channelId: reel.channelId,
      platform: input.platform,
      source: 'manual',
      status: 'published',
      metadata: defaults,
      approvedBy: new Types.ObjectId(userId),
      approvedAt: new Date(),
      externalId,
      url: input.url,
      publishedAt,
      // Only YouTube has an adapter to pull numbers from; other platforms are tracked without numbers for now.
      nextMetricsAt: externalId ? firstCheckpointAt(publishedAt) : undefined,
    });
    await this.markReelPosted(String(reel._id), publishedAt, input.url);
    return this.serialize(post.toObject());
  }

  // ------------------------------------------------------------------ worker

  async handle(job: PublishJob) {
    if (job.step === 'upload') return this.runUpload(job.postId);
    return this.runVerify(job.postId, job.attempt ?? 0);
  }

  private async runUpload(postId: string) {
    // `uploading` is allowed too: a stalled job (worker crash) is re-run and must RESUME, not start over.
    const post = await this.posts
      .findOneAndUpdate(
        { _id: postId, status: { $in: ['queued', 'blocked', 'uploading'] }, cancelRequested: { $ne: true } },
        { $set: { status: 'uploading', error: null, errorCode: null, blockedUntil: null }, $inc: { attempts: 1 } },
        { new: true },
      )
      .select('+uploadSessionUri');
    if (!post) {
      await this.posts.updateOne({ _id: postId, status: { $in: ['queued', 'blocked'] }, cancelRequested: true }, { $set: { status: 'cancelled' } });
      return;
    }
    const publisher = this.publisher(post.platform);
    const channelId = String(post.channelId);

    // A brand-new upload must fit today's cap; resuming an existing session does not use a new slot.
    if (!post.uploadSessionUri && !(await this.quota.hasRoom('yt'))) {
      return this.block(post, 'daily_cap', `Today's upload limit (${this.quota.dailyCap}) is reached; it will continue after midnight Pacific time.`, msUntilPacificMidnight());
    }
    if (!post.assetKey) return this.fail(post, 'missing_asset', 'The rendered video file is missing.');

    const dir = ensureDir(path.join(this.cfg.REEL_WORK_DIR, 'jobs', `publish-${postId}-${Date.now()}`));
    try {
      const filePath = path.join(dir, 'reel.mp4');
      await this.storage.getFile(BUCKETS.reels, post.assetKey, filePath);
      const fileSize = fs.statSync(filePath).size;

      const outcome = await publisher.publish({
        channelId,
        metadata: post.metadata,
        sessionUri: post.uploadSessionUri ?? null,
        ctx: {
          filePath,
          fileSize,
          saveSession: async (uri, bytes) => {
            await this.posts.updateOne({ _id: postId }, { $set: { bytesUploaded: bytes, ...(uri ? { uploadSessionUri: uri } : {}) }, ...(uri ? {} : { $unset: { uploadSessionUri: '' } }) });
          },
          shouldCancel: async () => !!(await this.posts.exists({ _id: postId, cancelRequested: true })),
        },
      });

      await this.posts.updateOne(
        { _id: postId },
        {
          $set: { status: 'processing', externalId: outcome.externalId, url: outcome.url, bytesUploaded: fileSize, warnings: [...new Set([...(post.warnings ?? []), ...(outcome.warnings ?? [])])] },
          $unset: { uploadSessionUri: '' },
        },
      );
      this.logger.log(`Post ${postId}: uploaded as ${outcome.externalId}`);
      if (post.platform === 'youtube') await this.applyThumbnail(String(post._id), channelId, String(post.reelId), outcome.externalId);
      await this.queues.publish(postId, 'verify', VERIFY_DELAYS_MS[0], 0);
    } catch (err) {
      await this.onUploadError(post, err);
    } finally {
      removeDir(dir);
    }
  }

  private async onUploadError(post: ReelPostDocument, err: unknown) {
    const postId = String(post._id);
    const pe = err instanceof PublishError ? err : new PublishError('transient', errMsg(err));
    this.logger.warn(`Post ${postId}: ${pe.kind} — ${pe.message}`);
    switch (pe.kind) {
      case 'cancelled':
        await this.posts.updateOne({ _id: postId }, { $set: { status: 'cancelled', error: null } });
        return;
      case 'auth':
        return this.block(post, 'needs_reconnect', pe.message, 0);
      case 'quota':
        return this.block(post, 'quota', pe.message, msUntilPacificMidnight());
      case 'transient': {
        if ((post.attempts ?? 1) >= MAX_UPLOAD_ATTEMPTS) return this.fail(post, pe.code ?? 'transient', `${pe.message} (gave up after ${MAX_UPLOAD_ATTEMPTS} attempts)`);
        const delay = Math.min(30 * 60_000, 60_000 * 2 ** ((post.attempts ?? 1) - 1));
        await this.posts.updateOne({ _id: postId }, { $set: { status: 'queued', error: pe.message, errorCode: pe.code ?? 'transient' } });
        await this.queues.publish(postId, 'upload', delay);
        return;
      }
      default:
        return this.fail(post, pe.code ?? pe.kind, pe.message);
    }
  }

  private async block(post: ReelPostDocument, code: string, message: string, delayMs: number) {
    const blockedUntil = delayMs ? new Date(Date.now() + delayMs) : undefined;
    await this.posts.updateOne(
      { _id: post._id },
      { $set: { status: 'blocked', error: message, errorCode: code, ...(blockedUntil ? { blockedUntil } : {}) }, $inc: { attempts: -1 } }, // a block is not a failed attempt
    );
    // Time-based blocks resume on their own (the person already approved this post). Reconnect blocks wait for the maintenance check.
    if (delayMs) await this.queues.publish(String(post._id), 'upload', delayMs);
  }

  private async fail(post: ReelPostDocument, code: string, message: string) {
    await this.posts.updateOne({ _id: post._id }, { $set: { status: 'failed', error: message, errorCode: code } });
  }

  private async runVerify(postId: string, attempt: number) {
    const post = await this.posts.findOne({ _id: postId, status: { $in: ['processing', 'scheduled'] } });
    if (!post?.externalId) return;
    const publisher = this.publisher(post.platform);
    const scheduleAt = post.metadata.scheduleAt ? new Date(post.metadata.scheduleAt) : null;
    const scheduled = !!scheduleAt && scheduleAt.getTime() > Date.now();

    let result;
    try {
      result = await publisher.verify({
        channelId: String(post.channelId),
        externalId: post.externalId,
        requestedPrivacy: post.requestedPrivacy ?? post.metadata.privacy,
        scheduled,
        ageMs: Date.now() - post.createdAt.getTime(),
      });
    } catch (err) {
      const pe = err instanceof PublishError ? err : new PublishError('transient', errMsg(err));
      if (pe.kind === 'auth') return this.block(post, 'needs_reconnect', pe.message, 0);
      // Anything else: try again later without disturbing the post.
      if (attempt + 1 < VERIFY_DELAYS_MS.length) await this.queues.publish(postId, 'verify', VERIFY_DELAYS_MS[attempt + 1], attempt + 1);
      return;
    }
    await this.posts.updateOne({ _id: postId }, { $inc: { unitsSpent: 1 } });

    if (result.state === 'failed') return this.fail(post, 'rejected', result.error ?? 'YouTube could not publish the video.');
    if (result.state === 'processing') {
      if (attempt + 1 < VERIFY_DELAYS_MS.length) {
        await this.queues.publish(postId, 'verify', VERIFY_DELAYS_MS[attempt + 1], attempt + 1);
        return;
      }
      result.warnings.push('YouTube is still processing this video; check YouTube Studio.');
    }

    const now = new Date();
    const publishedAt = scheduleAt && scheduleAt.getTime() > now.getTime() ? scheduleAt : now;
    await this.posts.updateOne(
      { _id: postId },
      {
        $set: {
          status: scheduled ? 'scheduled' : 'published',
          publishedAt,
          actualPrivacy: result.actualPrivacy,
          warnings: [...new Set([...(post.warnings ?? []), ...result.warnings])],
          nextMetricsAt: firstCheckpointAt(publishedAt),
          ...(result.stats ? { latestMetrics: { ...result.stats, capturedAt: now } } : {}),
        },
      },
    );
    await this.markReelPosted(String(post.reelId), publishedAt, post.url ?? '');
    this.logger.log(`Post ${postId}: ${scheduled ? 'scheduled' : 'published'} (${result.actualPrivacy ?? '?'})`);
  }

  /** The reel's overall state: it has gone out (or is booked to). Does not touch rejected/failed reels. */
  private async markReelPosted(reelId: string, at: Date, url: string) {
    await this.reels.updateOne(
      { _id: reelId, status: 'todo' },
      { $set: { status: 'posted', postedAt: at, ...(url ? { postedUrl: url } : {}) } },
    );
  }

  // ------------------------------------------------------------------ user actions

  async cancel(channelId: string, postId: string) {
    const post = await this.loadPost(channelId, postId);
    if (['queued', 'blocked'].includes(post.status)) {
      await this.posts.updateOne({ _id: post._id }, { $set: { status: 'cancelled', cancelRequested: true, error: null } });
      await this.dropWaitingJobs(postId);
    } else if (post.status === 'uploading') {
      await this.posts.updateOne({ _id: post._id }, { $set: { cancelRequested: true } }); // stops between chunks
    } else {
      throw new BadRequestException(`A ${post.status} post cannot be cancelled`);
    }
    return { ok: true };
  }

  async retry(channelId: string, postId: string) {
    const post = await this.loadPost(channelId, postId);
    if (!['failed', 'blocked'].includes(post.status)) throw new BadRequestException('Only failed or blocked posts can be retried');
    if (post.externalId) throw new BadRequestException('The video already exists on the platform; retrying would create a duplicate.');
    await this.posts.updateOne({ _id: post._id }, { $set: { status: 'queued', error: null, errorCode: null, cancelRequested: false, attempts: 0 } });
    await this.queues.publish(postId, 'upload');
    return { ok: true };
  }

  /** Periodic: resume approved posts that were waiting for the Google login to be fixed. */
  async resumeReconnectBlocked() {
    const blocked = await this.posts.find({ status: 'blocked', errorCode: 'needs_reconnect' }).select('channelId platform').lean();
    const checked = new Map<string, boolean>();
    for (const b of blocked) {
      const key = `${b.platform}:${b.channelId}`;
      if (!checked.has(key)) {
        const account = await this.registry.get(b.platform)?.getAccountStatus(String(b.channelId)).catch(() => undefined);
        checked.set(key, account?.state === 'ok');
      }
      if (checked.get(key)) {
        await this.posts.updateOne({ _id: b._id, status: 'blocked' }, { $set: { status: 'queued', error: null, errorCode: null } });
        await this.queues.publish(String(b._id), 'upload');
      }
    }
  }

  /** Posts whose job was lost (e.g. Redis flush) are picked up again; the saved session makes this safe. */
  async requeueStuck() {
    const cutoff = new Date(Date.now() - 20 * 60_000);
    const stuck = await this.posts.find({ status: { $in: ['queued', 'uploading'] }, updatedAt: { $lt: cutoff } }).select('_id status autoPlan.runAt').lean();
    if (!stuck.length) return;
    const waiting = await this.queues.q.publish.getJobs(['waiting', 'active', 'delayed']);
    const queued = new Set(waiting.filter(Boolean).map((j) => String(j.data?.postId)));
    for (const p of stuck) {
      if (queued.has(String(p._id))) continue;
      // An automatic post whose timer was lost (e.g. a Redis flush) must still wait for its slot, not go out at once.
      const wait = p.status === 'queued' && p.autoPlan?.runAt ? new Date(p.autoPlan.runAt).getTime() - Date.now() - UPLOAD_LEAD_MS : 0;
      await this.queues.publish(String(p._id), 'upload', Math.max(0, wait));
    }
    const verifying = await this.posts.find({ status: 'processing', updatedAt: { $lt: cutoff } }).select('_id').lean();
    for (const p of verifying) if (!queued.has(String(p._id))) await this.queues.publish(String(p._id), 'verify');
  }

  /** Send the reel's chosen thumbnail to YouTube. Failure only adds a warning to the post. */
  private async applyThumbnail(postId: string, channelId: string, reelId: string, videoId: string) {
    try {
      const reel = await this.reels.findById(reelId).select('thumbnails thumbnailChoice').lean();
      const jpeg = reel ? await this.thumbnails.chosenImage(reel) : null;
      if (!jpeg) return;
      const problem = await this.youtube.setThumbnail(channelId, videoId, jpeg);
      if (problem) {
        this.logger.warn(`Post ${postId}: thumbnail not applied (${problem})`);
        await this.posts.updateOne({ _id: postId }, { $addToSet: { warnings: 'YouTube did not accept the custom thumbnail. You can set it in YouTube Studio (download it from the reel).' }, $set: { thumbnailApplied: false } });
      } else {
        await this.posts.updateOne({ _id: postId }, { $set: { thumbnailApplied: true }, $inc: { unitsSpent: 50 } });
      }
    } catch (err) {
      this.logger.warn(`Post ${postId}: thumbnail step skipped (${(err as Error).message})`);
    }
  }

  // ------------------------------------------------------------------ reads

  private async loadPost(channelId: string, postId: string) {
    if (!Types.ObjectId.isValid(postId)) throw new NotFoundException('Post not found');
    const post = await this.posts.findOne({ _id: postId, channelId });
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  async listForReel(channelId: string, reelId: string) {
    await this.loadReel(channelId, reelId);
    const rows = await this.posts.find({ reelId, channelId }).sort({ createdAt: -1 }).lean();
    return rows.map((r) => this.serialize(r));
  }

  async list(channelId: string, q: { platform?: string; status?: string; period?: string; limit: number; skip: number }) {
    const filter: Record<string, unknown> = { channelId: new Types.ObjectId(channelId) };
    if (q.platform) filter.platform = q.platform;
    if (q.status) filter.status = q.status;
    if (q.period && q.period !== 'all') filter.createdAt = { $gte: new Date(Date.now() - parsePeriodDays(q.period) * 86_400_000) };
    const [items, total] = await Promise.all([
      this.posts.find(filter).sort({ createdAt: -1 }).skip(q.skip).limit(q.limit).lean(),
      this.posts.countDocuments(filter),
    ]);
    return { total, items: items.map((r) => this.serialize(r)) };
  }

  async get(channelId: string, postId: string) {
    const post = await this.loadPost(channelId, postId);
    return this.serialize(post.toObject());
  }

  /** Public shape: never includes the upload session or any token. */
  serialize(p: any) {
    return {
      id: String(p._id),
      reelId: String(p.reelId),
      campaignId: String(p.campaignId),
      platform: p.platform as PlatformId,
      source: p.source,
      autoPlan: p.autoPlan ? { slot: p.autoPlan.slot, runAt: p.autoPlan.runAt, mode: p.autoPlan.mode, track: p.autoPlan.track, movedByClient: !!p.autoPlan.movedByClient } : null,
      status: p.status as PostStatus,
      accountName: p.accountName ?? null,
      title: p.metadata?.title ?? '',
      privacy: p.metadata?.privacy ?? null,
      scheduleAt: p.metadata?.scheduleAt ?? null,
      requestedPrivacy: p.requestedPrivacy ?? null,
      actualPrivacy: p.actualPrivacy ?? null,
      url: p.url ?? null,
      externalId: p.externalId ?? null,
      publishedAt: p.publishedAt ?? null,
      progress: p.assetSizeBytes ? Math.min(1, (p.bytesUploaded ?? 0) / p.assetSizeBytes) : 0,
      warnings: p.warnings ?? [],
      error: p.error ?? null,
      errorCode: p.errorCode ?? null,
      blockedUntil: p.blockedUntil ?? null,
      latestMetrics: p.latestMetrics ?? null,
      createdAt: p.createdAt,
    };
  }

  /** Light summary attached to reels in lists ("posted on…"). */
  async summariesForReels(reelIds: Array<string | Types.ObjectId>): Promise<Map<string, Array<{ platform: PlatformId; status: PostStatus; url: string | null; views: number | null }>>> {
    const rows = await this.posts
      .find({ reelId: { $in: reelIds.map((r) => new Types.ObjectId(String(r))) }, status: { $nin: ['cancelled'] } })
      .select('reelId platform status url latestMetrics.views')
      .lean();
    const out = new Map<string, Array<{ platform: PlatformId; status: PostStatus; url: string | null; views: number | null }>>();
    for (const r of rows) {
      const k = String(r.reelId);
      out.set(k, [...(out.get(k) ?? []), { platform: r.platform, status: r.status, url: r.url ?? null, views: r.latestMetrics?.views ?? null }]);
    }
    return out;
  }
}

export function parseYouTubeId(url: string): string | undefined {
  const m = /(?:youtu\.be\/|youtube\.com\/(?:shorts\/|watch\?(?:.*&)?v=|embed\/|live\/))([A-Za-z0-9_-]{11})/.exec(url.trim());
  return m?.[1];
}

export function parsePeriodDays(period: string): number {
  const m = /^(\d+)d$/.exec(period);
  return m ? Number(m[1]) : 30;
}
