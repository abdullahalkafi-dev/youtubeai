import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppConfig, CONFIG } from '../config/config';
import { errMsg } from '../common/errors';
import { ReelPost, ReelPostDocument } from '../db/schemas/reel-post.schema';
import { ReelPostMetric, ReelPostMetricDocument } from '../db/schemas/reel-post-metric.schema';
import { advance, checkpointAt } from './checkpoints';
import { PublisherRegistry } from './registry';
import { MetricSample } from './types';

const RETRY_WITHOUT_DATA_MS = 30 * 60_000;
const GIVE_UP_AFTER_OVERDUE_MS = 12 * 3_600_000;

/**
 * Captures each published post's numbers at fixed ages (1h, 3h, 6h … 90d) into `reel_post_metrics`,
 * and keeps the newest numbers on the post for fast lists. Runs from the maintenance job every 30 minutes.
 */
@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @InjectModel(ReelPost.name) private readonly posts: Model<ReelPostDocument>,
    @InjectModel(ReelPostMetric.name) private readonly metrics: Model<ReelPostMetricDocument>,
    private readonly registry: PublisherRegistry,
  ) {}

  /** Scheduled posts whose time has come are live now: they start being measured. */
  async flipScheduled(now = new Date()) {
    await this.posts.updateMany({ status: 'scheduled', publishedAt: { $lte: now } }, { $set: { status: 'published' } });
  }

  async collectDue(limit = 200, now = new Date()): Promise<number> {
    await this.flipScheduled(now);
    const due = await this.posts
      .find({ status: 'published', externalId: { $exists: true }, nextMetricsAt: { $lte: now } })
      .sort({ nextMetricsAt: 1 })
      .limit(limit)
      .lean();
    if (!due.length) return 0;

    const groups = new Map<string, typeof due>();
    for (const p of due) groups.set(`${p.platform}|${p.channelId}`, [...(groups.get(`${p.platform}|${p.channelId}`) ?? []), p]);

    let recorded = 0;
    for (const [key, group] of groups) {
      const [platform, channelId] = key.split('|');
      const publisher = this.registry.get(platform as never);
      if (!publisher) {
        await this.posts.updateMany({ _id: { $in: group.map((g) => g._id) } }, { $unset: { nextMetricsAt: '' } });
        continue;
      }
      let samples: Awaited<ReturnType<typeof publisher.collectMetrics>>;
      try {
        samples = await publisher.collectMetrics({ channelId, externalIds: group.map((g) => g.externalId!) });
      } catch (err) {
        this.logger.warn(`Metrics collection failed for ${key}: ${errMsg(err)}`);
        continue;
      }
      for (const post of group) {
        try {
          if (await this.record(post, samples.get(post.externalId!), now)) recorded++;
        } catch (err) {
          this.logger.warn(`Recording metrics for post ${post._id} failed: ${errMsg(err)}`);
        }
      }
    }
    return recorded;
  }

  private async record(
    post: { _id: Types.ObjectId; reelId: Types.ObjectId; channelId: Types.ObjectId; platform: any; publishedAt?: Date; createdAt: Date; nextMetricsAt?: Date },
    sample: MetricSample | { removed: true } | undefined,
    now: Date,
  ): Promise<boolean> {
    if (sample && 'removed' in sample) {
      await this.posts.updateOne({ _id: post._id }, { $set: { status: 'removed' }, $unset: { nextMetricsAt: '' } });
      return false;
    }
    const publishedAt = post.publishedAt ?? post.createdAt;
    const step = advance(publishedAt, now, this.cfg.METRICS_MAX_AGE_DAYS);
    const nextAt = step.next !== undefined ? checkpointAt(publishedAt, step.next, this.cfg.METRICS_MAX_AGE_DAYS) : undefined;
    const set: Record<string, unknown> = { metricsCheckpoint: step.reached + 1 };

    if (!sample) {
      // The main app has not synced this video yet. Wait a little; if it takes far too long, skip this checkpoint.
      const overdue = now.getTime() - (post.nextMetricsAt?.getTime() ?? now.getTime());
      if (overdue < GIVE_UP_AFTER_OVERDUE_MS) {
        await this.posts.updateOne({ _id: post._id }, { $set: { nextMetricsAt: new Date(now.getTime() + RETRY_WITHOUT_DATA_MS) } });
        return false;
      }
      await this.posts.updateOne({ _id: post._id }, nextAt ? { $set: { ...set, nextMetricsAt: nextAt } } : { $set: set, $unset: { nextMetricsAt: '' } });
      return false;
    }

    await this.snapshot(post, sample, now, step.label);
    await this.posts.updateOne({ _id: post._id }, nextAt ? { $set: { ...set, nextMetricsAt: nextAt } } : { $set: set, $unset: { nextMetricsAt: '' } });
    return true;
  }

  private async snapshot(
    post: { _id: Types.ObjectId; reelId: Types.ObjectId; channelId: Types.ObjectId; platform: any; publishedAt?: Date; createdAt: Date },
    sample: MetricSample,
    now: Date,
    checkpoint: string,
  ) {
    const { raw, source, definition, provisional, ...numbers } = sample;
    const publishedAt = post.publishedAt ?? post.createdAt;
    await this.metrics.create({
      postId: post._id,
      reelId: post.reelId,
      channelId: post.channelId,
      platform: post.platform,
      capturedAt: now,
      ageHours: Math.round(((now.getTime() - publishedAt.getTime()) / 3_600_000) * 10) / 10,
      checkpoint,
      ...numbers,
      provisional: !!provisional,
      source,
      definition,
      raw,
    });
    await this.posts.updateOne({ _id: post._id }, { $set: { latestMetrics: { ...numbers, provisional: !!provisional, capturedAt: now } } });
  }

  /** The "Refresh" button: take a snapshot right now without disturbing the checkpoint schedule. */
  async refreshOne(channelId: string, postId: string): Promise<{ ok: boolean; message: string }> {
    const post = await this.posts.findOne({ _id: postId, channelId, status: { $in: ['published', 'scheduled'] } }).lean();
    if (!post?.externalId) return { ok: false, message: 'Only published posts have numbers to refresh.' };
    const publisher = this.registry.get(post.platform);
    if (!publisher) return { ok: false, message: `Numbers for ${post.platform} are not collected automatically yet.` };
    const samples = await publisher.collectMetrics({ channelId, externalIds: [post.externalId] });
    const sample = samples.get(post.externalId);
    if (!sample) return { ok: false, message: 'YouTube numbers are not available yet (the hourly sync has not picked this video up).' };
    if ('removed' in sample) {
      await this.posts.updateOne({ _id: post._id }, { $set: { status: 'removed' }, $unset: { nextMetricsAt: '' } });
      return { ok: true, message: 'The video was removed from YouTube.' };
    }
    await this.snapshot(post, sample, new Date(), 'manual');
    return { ok: true, message: 'Numbers refreshed.' };
  }
}
