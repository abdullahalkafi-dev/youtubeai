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
import { bankBrief, entityOf, FRESH_LANE_REELS, freshBrief, isSourceable, LaneVideo, needsAnalysis, pickBank, pickFresh, STOCK_TARGET } from './lanes';
import { freeDiskGb } from './media';
import { SignalsService } from './signals.service';

const UPLOAD_CHECK_EVERY_MS = 45 * 60_000;
const MAX_KICKS_PER_CHECK = 4;
/** Videos mined to nothing get this many more passes (the miner is not deterministic: a 17-minute video with 4,800 views once gave zero moments). */
const MAX_REMINES_PER_CHECK = 2;

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
    private readonly signals: SignalsService,
  ) {}

  /** The channel's public long videos with what we know about their analysis and footage. */
  async catalog(channelId: Types.ObjectId): Promise<LaneVideo[]> {
    const docs = await this.videos
      .find({ channelId, privacyStatus: 'public', deletedAt: null, deletedFromYoutube: { $ne: true } })
      .select('youtubeId title publishedAt viewCount duration durationSeconds liveBroadcastContent')
      .lean();
    const now = new Date();
    const rows = docs.filter((d) => d.youtubeId && isSourceable(d, now));
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
    // who each video is about, and how much of the channel's own last-3-day traffic that person has (demand the reels should follow)
    let entities: Array<{ key: string; names: string[] }> = [];
    const share = new Map<string, number>();
    try {
      entities = await this.signals.entityKeys(channelId);
      for (const e of (await this.signals.latest(channelId))?.own?.byEntity ?? []) share.set(e.key, e.share3d);
    } catch (err) {
      this.logger.warn(`Demand signals unavailable for the lanes: ${errMsg(err)}`);
    }
    return rows.map((d) => {
      const entity = entityOf(d.title ?? '', entities);
      return {
        youtubeId: d.youtubeId,
        videoId: String(d._id),
        title: d.title ?? '',
        publishedAt: d.publishedAt ? new Date(d.publishedAt) : null,
        views: d.viewCount ?? 0,
        durationSec: d.durationSeconds || parseIsoDuration(d.duration),
        analyzed: ready.has(d.youtubeId),
        strongMoments: byYt.get(d.youtubeId)?.strong ?? 0,
        usedMoments: byYt.get(d.youtubeId)?.used ?? 0,
        entity,
        demand: entity ? share.get(entity) ?? 0 : 0,
      };
    });
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

    await create('fresh', pickFresh(catalog, now, 3), freshBrief(pickFresh(catalog, now, 3)), FRESH_LANE_REELS, 'new videos');
    const stock = await this.reels.countDocuments({ channelId, status: 'todo' });
    if (stock < STOCK_TARGET) {
      const picks = pickBank(catalog, now, 3);
      await create('bank', picks, bankBrief(picks), 3, 'best of the older videos');
    }
    return made;
  }

  /** Videos become reel material: anything published in the last 30 days that is not downloaded yet is queued, the most-watched first. */
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
        const empty = await this.sources.find({ channelId: id, kind: 'youtube', stage: 'ready', momentCount: 0, remined: { $ne: true } }).select('youtubeId title').limit(MAX_REMINES_PER_CHECK).lean();
        for (const e of empty) {
          await this.sources.updateOne({ youtubeId: e.youtubeId }, { $set: { minedVersion: null, transcriptReady: false, remined: true } });
          await this.queues.analyze(e.youtubeId);
          kicked++;
          this.logger.log(`"${truncate(e.title ?? e.youtubeId, 70)}" gave no reel moments: mining it once more`);
        }
      } catch (err) {
        this.logger.warn(`New-upload check for channel ${id} failed: ${errMsg(err)}`);
      }
    }
    return kicked;
  }
}
