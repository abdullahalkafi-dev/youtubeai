import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { errMsg } from '../common/errors';
import { parseIsoDuration, truncate } from '../common/text';
import { AppConfig, CONFIG } from '../config/config';
import { ReelCampaign, ReelCampaignDocument, ReelTrack } from '../db/schemas/reel-campaign.schema';
import { ReelMoment, ReelMomentDocument } from '../db/schemas/reel-moment.schema';
import { ReelSetting, ReelSettingDocument } from '../db/schemas/reel-misc.schema';
import { ReelSource, ReelSourceDocument } from '../db/schemas/reel-source.schema';
import { Reel, ReelDocument } from '../db/schemas/reel.schema';
import { SourceVideo, SourceVideoDocument } from '../db/schemas/shared.readonly';
import { MINING_VERSION } from '../prompts/mining.prompt';
import { QueueService } from '../queue/queue.service';
import { CampaignRunnerService } from './campaign-runner.service';
import { bankBrief, freshBrief, LaneVideo, needsAnalysis, pickBank, pickFresh, STOCK_TARGET } from './lanes';
import { freeDiskGb } from './media';

const UPLOAD_CHECK_EVERY_MS = 45 * 60_000;
const MAX_KICKS_PER_CHECK = 3;

/**
 * The footage-first lanes of the daily run: reels from videos uploaded in the last 30 days ("fresh") and from the best of the older
 * content ("bank"), plus keeping new uploads analyzed so their reels can be made the same day. The topic lanes (main, explore) stay in
 * DailyService; these never depend on the archive containing a topic.
 */
@Injectable()
export class LanesService {
  private readonly logger = new Logger(LanesService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @InjectModel(ReelCampaign.name) private readonly campaigns: Model<ReelCampaignDocument>,
    @InjectModel(ReelMoment.name) private readonly moments: Model<ReelMomentDocument>,
    @InjectModel(ReelSource.name) private readonly sources: Model<ReelSourceDocument>,
    @InjectModel(Reel.name) private readonly reels: Model<ReelDocument>,
    @InjectModel(SourceVideo.name) private readonly videos: Model<SourceVideoDocument>,
    @InjectModel(ReelSetting.name) private readonly settings: Model<ReelSettingDocument>,
    private readonly runner: CampaignRunnerService,
    private readonly queues: QueueService,
  ) {}

  /** The channel's public long videos with what we know about their analysis and footage. */
  async catalog(channelId: Types.ObjectId): Promise<LaneVideo[]> {
    const docs = await this.videos
      .find({ channelId, privacyStatus: 'public', deletedAt: null, deletedFromYoutube: { $ne: true } })
      .select('youtubeId title publishedAt viewCount duration durationSeconds liveBroadcastContent')
      .lean();
    const rows = docs.filter((d) => d.youtubeId && d.liveBroadcastContent !== 'live' && d.liveBroadcastContent !== 'upcoming');
    const ready = new Set(
      (await this.sources.find({ stage: 'ready', minedVersion: MINING_VERSION, youtubeId: { $in: rows.map((r) => r.youtubeId) } }).select('youtubeId').lean()).map((s) => s.youtubeId),
    );
    const stats = await this.moments.aggregate<{ _id: string; strong: number; used: number }>([
      { $match: { channelId, promptVersion: MINING_VERSION } },
      {
        $group: {
          _id: '$youtubeId',
          strong: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'unused'] }, { $gte: ['$standalone', 8] }, { $gte: ['$intensity', 7] }] }, 1, 0] } },
          used: { $sum: { $cond: [{ $eq: ['$status', 'used'] }, 1, 0] } },
        },
      },
    ]);
    const byYt = new Map(stats.map((s) => [s._id, s]));
    return rows.map((d) => ({
      youtubeId: d.youtubeId,
      videoId: String(d._id),
      title: d.title ?? '',
      publishedAt: d.publishedAt ? new Date(d.publishedAt) : null,
      views: d.viewCount ?? 0,
      durationSec: d.durationSeconds || parseIsoDuration(d.duration),
      analyzed: ready.has(d.youtubeId),
      strongMoments: byYt.get(d.youtubeId)?.strong ?? 0,
      usedMoments: byYt.get(d.youtubeId)?.used ?? 0,
    }));
  }

  /**
   * Creates today's footage-first campaigns (idempotent per day and lane): "fresh" always when there is a recent video, "bank" only when
   * the stock of finished unposted reels is below STOCK_TARGET. Returns what was created.
   */
  async createForDay(channelId: Types.ObjectId, date: string, userId: Types.ObjectId): Promise<Array<{ track: ReelTrack; campaignId: string; videos: string[] }>> {
    const made: Array<{ track: ReelTrack; campaignId: string; videos: string[] }> = [];
    const label = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const catalog = await this.catalog(channelId);
    const now = new Date();

    const create = async (track: 'fresh' | 'bank', picks: LaneVideo[], brief: string, reels: number, tag: string) => {
      if (!picks.length) return;
      if (await this.campaigns.exists({ channelId, origin: 'daily', dailyDate: date, track })) return;
      const campaign = await this.campaigns.create({
        channelId,
        userId,
        origin: 'daily',
        dailyDate: date,
        track,
        parentCampaignId: null,
        name: truncate(`Daily ${label} (${tag}): ${picks[0].title}`, 80),
        brief,
        status: 'queued',
        settings: { targetReels: reels, minSec: 30, maxSec: 60, allowCrossVideo: true, templateName: 'default', seedVideoIds: picks.map((p) => p.youtubeId), lane: track },
        progress: { stage: 'queued', message: `Daily ${tag} — starting` },
        log: [{ at: new Date(), level: 'info', msg: `Daily ${track} lane for ${date}: ${picks.map((p) => p.title).join(' | ')}` }],
      });
      await this.queues.campaign('research', String(campaign._id));
      made.push({ track, campaignId: String(campaign._id), videos: picks.map((p) => p.youtubeId) });
      this.logger.log(`Daily ${date}: ${track} lane campaign ${campaign._id} (${picks.length} video(s), ${reels} reels)`);
    };

    await create('fresh', pickFresh(catalog, now, 3), freshBrief(pickFresh(catalog, now, 3)), 3, 'new videos');
    const stock = await this.reels.countDocuments({ channelId, status: 'todo' });
    if (stock < STOCK_TARGET) {
      const picks = pickBank(catalog, now, 3);
      await create('bank', picks, bankBrief(picks), 3, 'best of the older videos');
    }
    return made;
  }

  /** New uploads become reel material the same day: anything published in the last 14 days that is not downloaded yet is queued. */
  async analyzeNewUploads(force = false): Promise<number> {
    if (!this.cfg.REELS_ENABLED) return 0;
    if (freeDiskGb(this.cfg.REEL_WORK_DIR) < this.cfg.REEL_MIN_FREE_DISK_GB) return 0;
    const key = 'lanes:uploads';
    const last = await this.settings.findOne({ key }).lean();
    if (!force && last?.value?.at && Date.now() - new Date(last.value.at).getTime() < UPLOAD_CHECK_EVERY_MS) return 0;
    await this.settings.updateOne({ key }, { $set: { value: { at: new Date() } } }, { upsert: true });

    let kicked = 0;
    for (const id of (await this.campaigns.distinct('channelId')) as Types.ObjectId[]) {
      try {
        const cat = await this.catalog(id);
        const known = new Set((await this.sources.find({ youtubeId: { $in: cat.map((c) => c.youtubeId) } }).select('youtubeId').lean()).map((s) => s.youtubeId));
        const todo = needsAnalysis(cat, known, new Date()).slice(0, MAX_KICKS_PER_CHECK - kicked);
        for (const yt of todo) {
          const v = cat.find((c) => c.youtubeId === yt)!;
          await this.runner.kickSource({ youtubeId: v.youtubeId, videoId: v.videoId, title: v.title }, id);
          kicked++;
          this.logger.log(`New upload "${truncate(v.title, 70)}" queued for analysis`);
        }
      } catch (err) {
        this.logger.warn(`New-upload check for channel ${id} failed: ${errMsg(err)}`);
      }
    }
    return kicked;
  }
}
