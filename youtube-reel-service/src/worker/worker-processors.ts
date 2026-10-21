import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Bull from 'bull';
import { AppConfig, CONFIG } from '../config/config';
import { CancelledError, errMsg, FatalJobError } from '../common/errors';
import { Reel, ReelDocument } from '../db/schemas/reel.schema';
import { ReelSource, ReelSourceDocument } from '../db/schemas/reel-source.schema';
import { AnalyzeJob, CampaignJob, DownloadJob, MaintenanceJob, PublishJob, QueueService, RenderJob } from '../queue/queue.service';
import { OrchestratorService } from '../queue/orchestrator.service';
import { CampaignRunnerService } from '../pipeline/campaign-runner.service';
import { DownloaderService } from '../pipeline/downloader.service';
import { AnalyzerService } from '../pipeline/analyzer.service';
import { RendererService } from '../pipeline/renderer.service';
import { MaintenanceService } from '../pipeline/maintenance.service';
import { TemplateStoreService } from '../pipeline/template-store.service';
import { PublishService } from '../publishing/publish.service';
import { ReelPost, ReelPostDocument } from '../db/schemas/reel-post.schema';

/** During processing, attemptsMade counts previous failures: this run is the last one when +1 reaches the limit. */
const isLastAttempt = (job: Bull.Job) => job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

/** Registers the Bull processors. Only the worker process loads this. */
@Injectable()
export class WorkerProcessors implements OnApplicationBootstrap {
  private readonly logger = new Logger('Worker');

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @InjectModel(Reel.name) private readonly reels: Model<ReelDocument>,
    @InjectModel(ReelSource.name) private readonly sources: Model<ReelSourceDocument>,
    @InjectModel(ReelPost.name) private readonly postModel: Model<ReelPostDocument>,
    private readonly queues: QueueService,
    private readonly orchestrator: OrchestratorService,
    private readonly runner: CampaignRunnerService,
    private readonly downloader: DownloaderService,
    private readonly analyzer: AnalyzerService,
    private readonly renderer: RendererService,
    private readonly maintenance: MaintenanceService,
    private readonly templates: TemplateStoreService,
    private readonly publishing: PublishService,
  ) {}

  async onApplicationBootstrap() {
    if (!this.cfg.REELS_ENABLED) {
      this.logger.warn('REELS_ENABLED=false — worker is idle (kill switch).');
      return;
    }
    const { q } = this.queues;
    const c = this.cfg;

    q.campaign.process(c.REEL_CAMPAIGN_CONCURRENCY, (job: Bull.Job<CampaignJob>) =>
      this.guard(job, async () => this.runner.run(job.data), async (err) => {
        if (job.data.step === 'topup') {
          await this.orchestrator.finish(job.data.campaignId, 'partial', `No additional reels added: ${errMsg(err)}`);
        } else {
          await this.orchestrator.finish(job.data.campaignId, 'failed', `${job.data.step} failed: ${errMsg(err)}`);
        }
      }),
    );
    q.download.process(c.REEL_DOWNLOAD_CONCURRENCY, (job: Bull.Job<DownloadJob>) =>
      this.guard(job, async () => this.downloader.download(job.data.youtubeId), async (err) => {
        await this.downloader.markFailed(job.data.youtubeId, `download failed: ${errMsg(err)}`);
      }),
    );
    q.ingest.process(1, (job: Bull.Job<DownloadJob>) =>
      this.guard(job, async () => this.downloader.download(job.data.youtubeId), async (err) => {
        await this.downloader.markFailed(job.data.youtubeId, `preparing the uploaded video failed: ${errMsg(err)}`);
      }),
    );
    q.analyze.process(c.REEL_ANALYZE_CONCURRENCY, (job: Bull.Job<AnalyzeJob>) =>
      this.guard(job, async () => this.analyzer.analyze(job.data.youtubeId), async (err) => {
        await this.sources.updateOne({ youtubeId: job.data.youtubeId }, { $set: { stage: 'failed', error: `analysis failed: ${errMsg(err)}` } });
        await this.orchestrator.onSourceSettled(job.data.youtubeId);
      }),
    );
    q.render.process(c.REEL_RENDER_CONCURRENCY, (job: Bull.Job<RenderJob>) =>
      this.guard(job, async () => this.renderer.render(job.data.reelId), async (err) => {
        const reel = await this.reels.findByIdAndUpdate(job.data.reelId, { $set: { status: 'failed', error: errMsg(err).slice(0, 800) } }).lean();
        if (reel) await this.orchestrator.onReelSettled(String(reel.campaignId));
      }),
    );
    q.publish.process(c.PUBLISH_CONCURRENCY, (job: Bull.Job<PublishJob>) =>
      this.guard(job, async () => this.publishing.handle(job.data), async (err) => {
        await this.postModel.updateOne(
          { _id: job.data.postId, status: { $in: ['queued', 'uploading', 'processing'] } },
          { $set: { status: 'failed', error: errMsg(err).slice(0, 500), errorCode: 'worker_error' } },
        );
      }),
    );
    q.maintenance.process(1, (job: Bull.Job<MaintenanceJob>) => this.maintenance.run(job.data.task));

    // Repeatable housekeeping (deduplicated by Bull's repeat key).
    await q.maintenance.add({ task: 'recover' } satisfies MaintenanceJob, { repeat: { every: 10 * 60_000 }, jobId: 'recover', attempts: 1 });
    await q.maintenance.add({ task: 'cookie-health' } satisfies MaintenanceJob, { repeat: { every: 6 * 3600_000 }, jobId: 'cookie-health', attempts: 1 });
    await q.maintenance.add({ task: 'cleanup' } satisfies MaintenanceJob, { repeat: { every: 3600_000 }, jobId: 'cleanup', attempts: 1 });
    await q.maintenance.add({ task: 'metrics' } satisfies MaintenanceJob, { repeat: { every: 30 * 60_000 }, jobId: 'metrics', attempts: 1 });
    // Auto-publish (does nothing for a channel whose switch is off): plan the day's posts once its reels are ready, and the stop-by-itself check.
    await q.maintenance.add({ task: 'auto-publish' } satisfies MaintenanceJob, { repeat: { every: 10 * 60_000 }, jobId: 'auto-publish', attempts: 1 });
    // Daily automatic campaign: 4:00 AM New York, with a 6:00 AM retry for a failed day (runs are idempotent per NY date).
    await q.maintenance.add({ task: 'daily' } satisfies MaintenanceJob, { repeat: { cron: '0 4 * * *', tz: 'America/New_York' }, jobId: 'daily', attempts: 1 });
    await q.maintenance.add({ task: 'daily' } satisfies MaintenanceJob, { repeat: { cron: '0 6 * * *', tz: 'America/New_York' }, jobId: 'daily-retry', attempts: 1 });

    for (const name of Object.keys(q) as Array<keyof typeof q>) {
      q[name].on('error', (err) => this.logger.error(`[queue ${name}] ${err.message}`));
    }

    try {
      await this.templates.get('default'); // seed the default template on first boot
    } catch (err) {
      this.logger.warn(`Default template not ready: ${errMsg(err)}`);
    }
    this.logger.log(
      `Processors up — campaign×${c.REEL_CAMPAIGN_CONCURRENCY}, download×${c.REEL_DOWNLOAD_CONCURRENCY}, analyze×${c.REEL_ANALYZE_CONCURRENCY}, render×${c.REEL_RENDER_CONCURRENCY}`,
    );
  }

  /**
   * Runs a job. Cancellations and deterministic failures are settled immediately (no retry);
   * transient errors are re-thrown for Bull to retry, and settled as failed on the final attempt.
   */
  private async guard<T>(job: Bull.Job, fn: () => Promise<T>, onFinalFailure: (err: unknown) => Promise<void>): Promise<T | undefined> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof CancelledError) {
        this.logger.log(`Job ${job.queue.name}#${job.id} stopped: campaign cancelled`);
        return undefined;
      }
      const final = err instanceof FatalJobError || isLastAttempt(job);
      this.logger.error(`Job ${job.queue.name}#${job.id} failed (attempt ${job.attemptsMade + 1}/${job.opts.attempts ?? 1}): ${errMsg(err)}`);
      if (final) {
        try {
          await onFinalFailure(err);
        } catch (inner) {
          this.logger.error(`Failure handler error: ${errMsg(inner)}`);
        }
        return undefined;
      }
      throw err;
    }
  }
}
