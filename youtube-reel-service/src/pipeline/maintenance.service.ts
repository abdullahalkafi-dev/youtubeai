import { Inject, Injectable, Logger } from '@nestjs/common';
import { AutoPublishService } from '../publishing/auto-publish.service';
import { LearningService } from '../publishing/learning.service';
import { DailyService } from './daily.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import { AppConfig, CONFIG } from '../config/config';
import { errMsg } from '../common/errors';
import { ReelCampaign, ReelCampaignDocument, TERMINAL_CAMPAIGN_STATUSES } from '../db/schemas/reel-campaign.schema';
import { Reel, ReelDocument } from '../db/schemas/reel.schema';
import { ReelSource, ReelSourceDocument } from '../db/schemas/reel-source.schema';
import { BUCKETS, StorageService } from '../storage/storage.service';
import { OrchestratorService } from '../queue/orchestrator.service';
import { QueueService } from '../queue/queue.service';
import { CampaignRunnerService } from './campaign-runner.service';
import { removeDir } from './media';
import { MetricsService } from '../publishing/metrics.service';
import { PublishService } from '../publishing/publish.service';
import { YouTubeSessionService } from './youtube-session.service';

const STALE_CAMPAIGN_MS = 20 * 60_000;
const STALE_RENDER_MS = 30 * 60_000;

/** Self-healing: crash recovery, YouTube session health, temp cleanup, source-cache eviction. */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @InjectModel(ReelCampaign.name) private readonly campaigns: Model<ReelCampaignDocument>,
    @InjectModel(Reel.name) private readonly reels: Model<ReelDocument>,
    @InjectModel(ReelSource.name) private readonly sources: Model<ReelSourceDocument>,
    private readonly storage: StorageService,
    private readonly queues: QueueService,
    private readonly orchestrator: OrchestratorService,
    private readonly runner: CampaignRunnerService,
    private readonly session: YouTubeSessionService,
    private readonly publishing: PublishService,
    private readonly metrics: MetricsService,
    private readonly daily: DailyService,
    private readonly autoPublish: AutoPublishService,
    private readonly learning: LearningService,
  ) {}

  async run(task: 'recover' | 'cookie-health' | 'cleanup' | 'metrics' | 'daily' | 'auto-publish' | 'weekly-review') {
    if (task === 'weekly-review') return this.learning.runWeekly();
    if (task === 'daily') return this.daily.runScheduled();
    if (task === 'auto-publish') return this.autoPublish.runDue();
    if (task === 'recover') return this.recover();
    if (task === 'metrics') return this.metrics.collectDue();
    if (task === 'cookie-health') return this.cookieHealth();
    if (task === 'cleanup') return this.cleanup();
  }

  private async pendingJobIds(queue: 'campaign' | 'render', key: 'campaignId' | 'reelId'): Promise<Set<string>> {
    const jobs = await this.queues.q[queue].getJobs(['waiting', 'active', 'delayed', 'paused']);
    return new Set(jobs.filter(Boolean).map((j) => String(j.data?.[key])));
  }

  async recover() {
    // Publishing housekeeping first; it must never stop campaign recovery below.
    try {
      await this.publishing.resumeReconnectBlocked();
      await this.publishing.requeueStuck();
    } catch (err) {
      this.logger.warn(`Publish recovery failed: ${errMsg(err)}`);
    }
    const session = await this.session.state();
    // Re-login happened → release blocked sources.
    if (session.status === 'ok') {
      const blocked = await this.sources.find({ stage: 'blocked' }).select('youtubeId').lean();
      for (const b of blocked) {
        await this.sources.updateOne({ youtubeId: b.youtubeId, stage: 'blocked' }, { $set: { stage: 'queued', error: null } });
        await this.queues.download(b.youtubeId);
      }
    }

    const stale = await this.campaigns
      .find({ status: { $nin: TERMINAL_CAMPAIGN_STATUSES }, updatedAt: { $lt: new Date(Date.now() - STALE_CAMPAIGN_MS) } })
      .lean();
    if (!stale.length) return;
    const pendingCampaigns = await this.pendingJobIds('campaign', 'campaignId');
    const pendingRenders = await this.pendingJobIds('render', 'reelId');

    for (const c of stale) {
      const id = String(c._id);
      try {
        if (c.cancelRequested) continue;
        switch (c.status) {
          case 'queued':
          case 'researching':
            if (!pendingCampaigns.has(id)) await this.queues.campaign('research', id);
            break;
          case 'sourcing':
            if (!pendingCampaigns.has(id)) await this.queues.campaign('source', id);
            break;
          case 'composing':
            if (!pendingCampaigns.has(id)) await this.queues.campaign('compose', id);
            break;
          case 'preparing':
            for (const ref of c.sources.filter((s) => s.status === 'pending')) await this.runner.kickSource(ref, c.channelId);
            await this.orchestrator.refreshPreparing(id);
            break;
          case 'rendering': {
            const stuck = await this.reels
              .find({ campaignId: c._id, status: { $in: ['queued', 'rendering'] }, updatedAt: { $lt: new Date(Date.now() - STALE_RENDER_MS) } })
              .select('_id')
              .lean();
            for (const r of stuck) if (!pendingRenders.has(String(r._id))) await this.queues.render(String(r._id));
            await this.orchestrator.onReelSettled(id);
            break;
          }
        }
        await this.campaigns.updateOne({ _id: c._id }, { $set: { updatedAt: new Date() } });
      } catch (err) {
        this.logger.warn(`Recovery of campaign ${id} failed: ${errMsg(err)}`);
      }
    }
  }

  private async cookieHealth() {
    const s = await this.session.state();
    if (s.status === 'ok') await this.session.check();
  }

  private async cleanup() {
    // 1) Orphan job dirs (crashed jobs) older than 3h.
    const jobs = path.join(this.cfg.REEL_WORK_DIR, 'jobs');
    if (fs.existsSync(jobs)) {
      for (const d of fs.readdirSync(jobs)) {
        const full = path.join(jobs, d);
        try {
          if (Date.now() - fs.statSync(full).mtimeMs > 3 * 3600_000) removeDir(full);
        } catch {
          /* ignore */
        }
      }
    }

    // 2) Source-video cache (LRU). Transcripts/moments/audio stay; only the large mp4 is evicted.
    const capBytes = this.cfg.REEL_SOURCE_CACHE_GB * 1024 ** 3;
    await this.cleanupUploads();
    const present = await this.sources.find({ videoPresent: true, kind: { $ne: 'upload' } }).sort({ lastUsedAt: 1 }).select('youtubeId videoKey sizeBytes lastUsedAt').lean();
    let total = present.reduce((n, s) => n + (s.sizeBytes ?? 0), 0);
    if (total <= capBytes) return;
    const busy = new Set(
      (await this.reels.find({ status: { $in: ['queued', 'rendering'] } }).select('clips.youtubeId').lean()).flatMap((r) => r.clips.map((c) => c.youtubeId)),
    );
    for (const s of present) {
      if (total <= capBytes * 0.85) break;
      if (busy.has(s.youtubeId) || !s.videoKey) continue;
      await this.storage.remove(BUCKETS.sources, s.videoKey);
      await this.sources.updateOne({ youtubeId: s.youtubeId }, { $set: { videoPresent: false } });
      total -= s.sizeBytes ?? 0;
      this.logger.log(`Evicted cached source ${s.youtubeId} (${((s.sizeBytes ?? 0) / 1e6).toFixed(0)}MB)`);
    }
  }

  /** Raw uploads: delete the original 24 h after its working copy exists (7 days at most); drop uploads abandoned for 3 days. */
  private async cleanupUploads() {
    const uploads = this.campaigns.db.collection('reel_uploads');
    const now = Date.now();
    const done = await uploads.find({ status: 'uploaded', rawDeletedAt: null }).toArray();
    for (const u of done) {
      const src = await this.sources.findOne({ youtubeId: u.sourceId }).select('videoPresent stage').lean();
      const age = now - new Date(u.completedAt ?? u.updatedAt).getTime();
      const ready = !!src?.videoPresent;
      if ((ready && age > 24 * 3600_000) || age > 7 * 24 * 3600_000) {
        fs.rmSync(path.dirname(String(u.rawPath)), { recursive: true, force: true });
        await uploads.updateOne({ _id: u._id }, { $set: { rawDeletedAt: new Date() } });
        await this.sources.updateOne({ youtubeId: u.sourceId }, { $unset: { rawPath: '' } });
        this.logger.log(`Deleted raw upload ${u._id} (${ready ? 'working copy ready' : 'expired'})`);
      }
    }
    const stale = await uploads.find({ status: 'uploading', updatedAt: { $lt: new Date(now - 3 * 24 * 3600_000) } }).toArray();
    for (const u of stale) {
      fs.rmSync(path.dirname(String(u.rawPath)), { recursive: true, force: true });
      await uploads.updateOne({ _id: u._id }, { $set: { status: 'expired', rawDeletedAt: new Date() } });
      this.logger.log(`Dropped abandoned upload ${u._id}`);
    }
  }
}
