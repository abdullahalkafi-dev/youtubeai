import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Bull from 'bull';
import { AppConfig, CONFIG } from '../config/config';

/** All reel queues live under their own Redis prefix ("reels") so they never touch the main app's queues. */
export const QUEUES = ['campaign', 'download', 'analyze', 'render', 'publish', 'maintenance'] as const;
export type QueueName = (typeof QUEUES)[number];

export type CampaignStep = 'research' | 'source' | 'compose' | 'topup';
export interface CampaignJob {
  step: CampaignStep;
  campaignId: string;
}
export interface DownloadJob {
  youtubeId: string;
}
export interface AnalyzeJob {
  youtubeId: string;
}
export interface RenderJob {
  reelId: string;
}
export interface PublishJob {
  postId: string;
  step: 'upload' | 'verify';
  /** Verify attempt number (drives the back-off schedule). */
  attempt?: number;
}
export interface MaintenanceJob {
  task: 'recover' | 'cookie-health' | 'cleanup' | 'metrics';
}

function redisOptions(url: string): Bull.QueueOptions['redis'] {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  readonly q: Record<QueueName, Bull.Queue>;

  constructor(@Inject(CONFIG) cfg: AppConfig) {
    const redis = redisOptions(cfg.REDIS_URL);
    const make = (name: QueueName) =>
      new Bull(name, {
        redis,
        prefix: 'reels',
        settings: { lockDuration: 180_000, lockRenewTime: 60_000, stalledInterval: 60_000, maxStalledCount: 2 },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: 300,
          removeOnFail: 500,
        },
      });
    this.q = Object.fromEntries(QUEUES.map((n) => [n, make(n)])) as Record<QueueName, Bull.Queue>;
  }

  campaign(step: CampaignStep, campaignId: string, delayMs = 0) {
    return this.q.campaign.add({ step, campaignId } satisfies CampaignJob, { delay: delayMs, attempts: step === 'compose' || step === 'topup' ? 2 : 3 });
  }

  download(youtubeId: string, delayMs = 0) {
    return this.q.download.add({ youtubeId } satisfies DownloadJob, { delay: delayMs, attempts: 3, backoff: { type: 'exponential', delay: 60_000 } });
  }

  analyze(youtubeId: string, delayMs = 0) {
    return this.q.analyze.add({ youtubeId } satisfies AnalyzeJob, { delay: delayMs, attempts: 3 });
  }

  render(reelId: string, delayMs = 0) {
    return this.q.render.add({ reelId } satisfies RenderJob, { delay: delayMs, attempts: 2, backoff: { type: 'fixed', delay: 30_000 } });
  }

  /**
   * `upload` runs once per attempt (our own retry logic re-queues it; Bull's attempts stay at 1 so a failed upload
   * is never replayed blindly — the post's saved session decides whether to resume). `verify` re-checks processing.
   */
  publish(postId: string, step: PublishJob['step'], delayMs = 0, attempt = 0) {
    return this.q.publish.add({ postId, step, attempt } satisfies PublishJob, { delay: delayMs, attempts: 1 });
  }

  async pauseDownloads() {
    await this.q.download.pause(false);
    this.logger.warn('Download queue paused (YouTube login required)');
  }

  async resumeDownloads() {
    await this.q.download.resume(false);
    this.logger.log('Download queue resumed');
  }

  async counts() {
    const out: Record<string, Bull.JobCounts & { paused: boolean }> = {};
    for (const name of QUEUES) {
      out[name] = { ...(await this.q[name].getJobCounts()), paused: await this.q[name].isPaused() };
    }
    return out;
  }

  async onModuleDestroy() {
    await Promise.allSettled(Object.values(this.q).map((q) => q.close()));
  }
}
