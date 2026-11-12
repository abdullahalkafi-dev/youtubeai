import { Inject, Injectable, Logger } from '@nestjs/common';
import { AutoPublishService } from '../publishing/auto-publish.service';
import { LanesService } from './lanes.service';
import { LearningService } from '../publishing/learning.service';
import { DailyService } from './daily.service';
import { OpsReportService } from './ops-report.service';
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
import { AlertService } from './alert.service';

const STALE_CAMPAIGN_MS = 20 * 60_000;
const STALE_RENDER_MS = 30 * 60_000;
/** A video in an analysis stage this long with no job on it is stuck; it is restarted at most MAX_SOURCE_RECOVERIES times. */
const STUCK_SOURCE_MS = 3 * 60 * 60_000;
const MAX_SOURCE_RECOVERIES = 3;

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
    private readonly lanes: LanesService,
    private readonly ops: OpsReportService,
    private readonly alerts: AlertService,
  ) {}

  async run(task: 'recover' | 'cookie-health' | 'cleanup' | 'metrics' | 'daily' | 'auto-publish' | 'weekly-review' | 'ops-report') {
    if (task === 'weekly-review') return this.learning.runWeekly();
    if (task === 'ops-report') return this.ops.buildAll();
    if (task === 'daily') return this.daily.runScheduled();
    if (task === 'auto-publish') return this.autoPublish.runDue();
    if (task === 'recover') return this.recover();
    if (task === 'metrics') return this.metrics.collectDue();
    if (task === 'cookie-health') return this.cookieHealth();
    if (task === 'cleanup') return this.cleanup();
  }

  private async pendingJobIds(queue: 'campaign' | 'render' | 'analyze', key: 'campaignId' | 'reelId' | 'youtubeId'): Promise<Set<string>> {
    const jobs = await this.queues.q[queue].getJobs(['waiting', 'active', 'delayed', 'paused']);
    return new Set(jobs.filter(Boolean).map((j) => String(j.data?.[key])));
  }

  /**
   * A video left in an analysis stage with no job working on it (the last retry timed out: a 107-minute, 15.8k-view video sat in
   * "transcribing" from Oct 30 to Nov 4, and nothing looks at a video that already has a record) is restarted, a few per tick. After
   * MAX_SOURCE_RECOVERIES restarts it is marked failed with the reason, which the ops report lists.
   */
  private async recoverStuckSources() {
    const cutoff = new Date(Date.now() - STUCK_SOURCE_MS);
    const stuck = await this.sources
      .find({ stage: { $in: ['downloaded', 'transcribing', 'mining'] }, updatedAt: { $lt: cutoff }, $or: [{ analyzeLockAt: null }, { analyzeLockAt: { $lt: cutoff } }] })
      .select('youtubeId stage recoveries')
      .limit(3)
      .lean();
    if (!stuck.length) return;
    const pending = await this.pendingJobIds('analyze', 'youtubeId');
    for (const s of stuck) {
      if (pending.has(s.youtubeId)) continue;
      if ((s.recoveries ?? 0) >= MAX_SOURCE_RECOVERIES) {
        await this.sources.updateOne({ youtubeId: s.youtubeId }, { $set: { stage: 'failed', analyzeLockAt: null, error: `stuck in ${s.stage} after ${s.recoveries} restarts` } });
        await this.orchestrator.onSourceSettled(s.youtubeId);
        this.logger.warn(`Video ${s.youtubeId} stayed stuck in ${s.stage} after ${s.recoveries} restarts: marked failed`);
        continue;
      }
      await this.sources.updateOne({ youtubeId: s.youtubeId }, { $inc: { recoveries: 1 }, $set: { analyzeLockAt: null } });
      await this.queues.analyze(s.youtubeId);
      this.logger.log(`Video ${s.youtubeId} was stuck in ${s.stage}: analysis restarted (${(s.recoveries ?? 0) + 1} of ${MAX_SOURCE_RECOVERIES})`);
    }
  }

  async recover() {
    // Publishing housekeeping first; it must never stop campaign recovery below.
    try {
      await this.publishing.resumeReconnectBlocked();
      await this.publishing.requeueStuck();
    } catch (err) {
      this.logger.warn(`Publish recovery failed: ${errMsg(err)}`);
    }
    try {
      await this.daily.rescue();
    } catch (err) {
      this.logger.warn(`Daily rescue failed: ${errMsg(err)}`);
    }
    try {
      await this.lanes.analyzeNewUploads(); // new uploads become reel material the same day (checked at most every 45 minutes)
    } catch (err) {
      this.logger.warn(`New-upload analysis failed: ${errMsg(err)}`);
    }
    try {
      await this.lanes.newsReels(); // a same-day reel from each new long video once it is analyzed
    } catch (err) {
      this.logger.warn(`News reels failed: ${errMsg(err)}`);
    }
    try {
      await this.recoverStuckSources();
    } catch (err) {
      this.logger.warn(`Stuck-video recovery failed: ${errMsg(err)}`);
    }
    try {
      await this.alerts.check(); // developer push alerts (pipeline/alerts.ts), at most once per problem per 12 h
    } catch (err) {
      this.logger.warn(`Alert check failed: ${errMsg(err)}`);
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
