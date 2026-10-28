import { estimateCostUsd, mergeModelTokens, parsePrices } from '../ai/task-routing';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppConfig, CONFIG } from '../config/config';
import { campaignFamily, familyStatus } from '../common/campaign-family';
import { truncate } from '../common/text';
import { ReelCampaign, ReelCampaignDocument, TERMINAL_CAMPAIGN_STATUSES } from '../db/schemas/reel-campaign.schema';
import { Reel, ReelDocument } from '../db/schemas/reel.schema';
import { ReelMoment, ReelMomentDocument } from '../db/schemas/reel-moment.schema';
import { ReelSource, ReelSourceDocument } from '../db/schemas/reel-source.schema';
import { ReelEntity, ReelEntityDocument } from '../db/schemas/reel-misc.schema';
import { SourceVideo, SourceVideoDocument } from '../db/schemas/shared.readonly';
import { QueueService } from '../queue/queue.service';
import { OrchestratorService } from '../queue/orchestrator.service';
import { fullVideoLine, withFullVideoLine } from '../publishing/description';
import { PublishService } from '../publishing/publish.service';
import { AnalyticsService } from '../publishing/analytics.service';
import { VisualsService } from '../pipeline/visuals.service';
import { ThumbnailService } from '../pipeline/thumbnail.service';
import { UploadsService } from './uploads.service';
import { CreateCampaignInput, PatchReelInput } from './dto';

const MAX_ACTIVE_CAMPAIGNS = 2;
const MEDIA_TOKEN_TTL = '12h';

@Injectable()
export class ReelsApiService {
  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @InjectModel(ReelCampaign.name) private readonly campaigns: Model<ReelCampaignDocument>,
    @InjectModel(Reel.name) private readonly reels: Model<ReelDocument>,
    @InjectModel(ReelMoment.name) private readonly moments: Model<ReelMomentDocument>,
    @InjectModel(ReelSource.name) private readonly sources: Model<ReelSourceDocument>,
    @InjectModel(ReelEntity.name) private readonly entities: Model<ReelEntityDocument>,
    @InjectModel(SourceVideo.name) private readonly videos: Model<SourceVideoDocument>,
    private readonly queues: QueueService,
    private readonly orchestrator: OrchestratorService,
    private readonly jwt: JwtService,
    private readonly publish: PublishService,
    private readonly analytics: AnalyticsService,
    private readonly visualsSvc: VisualsService,
    private readonly thumbs: ThumbnailService,
    private readonly uploads: UploadsService,
  ) {}

  // ------------------------------------------------------------------ media tokens

  private mediaSecret() {
    return `${this.cfg.JWT_SECRET}::reel-media`;
  }

  mediaToken(reelId: string, userId: string) {
    return this.jwt.sign({ rid: reelId, uid: userId }, { secret: this.mediaSecret(), expiresIn: MEDIA_TOKEN_TTL });
  }

  async verifyMediaToken(token: string, reelId: string) {
    try {
      const p = await this.jwt.verifyAsync<{ rid: string }>(token, { secret: this.mediaSecret() });
      return p.rid === reelId;
    } catch {
      return false;
    }
  }

  private visualsOut(r: any, userId: string) {
    const list = (r.visuals ?? []).filter((v: any) => v.status !== 'removed');
    if (!list.length) return [];
    const t = encodeURIComponent(this.mediaToken(String(r._id), userId));
    // planned reel time → time in the finished (paced) file
    const map = (sec: number) => {
      const cuts: Array<[number, number]> = r.timing?.cuts ?? [];
      let removed = 0;
      for (const [a, b] of cuts) if (sec > a) removed += Math.min(sec, b) - a;
      return (sec - removed) / (r.timing?.speed ?? 1);
    };
    const r1 = (n: number) => Math.round(n * 10) / 10;
    return list.map((v: any) => ({
      id: v.id,
      at: r1(map(v.start)),
      duration: r1(map(v.end) - map(v.start)),
      purpose: v.purpose,
      phrase: v.phrase ?? null,
      status: v.status,
      realPerson: !!v.realPerson,
      url: v.status === 'ready' && v.key ? `/api/reels/media/${r._id}/beat-${v.id}?t=${t}&v=${v.variant ?? 0}` : null,
    }));
  }

  private thumbnailsOut(r: any, userId: string) {
    const list = (r.thumbnails ?? []).filter((t: any) => t.status === 'ready' && t.key);
    if (!list.length) return [];
    const tok = encodeURIComponent(this.mediaToken(String(r._id), userId));
    return list.map((t: any) => ({
      id: t.id,
      headline: t.headline,
      chosen: (r.thumbnailChoice ?? list[0].id) === t.id,
      source: t.source,
      url: `/api/reels/media/${r._id}/thumb-${t.id}?t=${tok}`,
    }));
  }

  async regenerateThumbnails(channelId: string, reelId: string, userId: string) {
    const r = await this.reels.findOne({ _id: reelId, channelId }).select('status').lean();
    if (!r) throw new NotFoundException('Reel not found');
    if (!['todo', 'posted', 'rejected'].includes(r.status)) throw new ConflictException('Thumbnails can be made once the reel has finished rendering.');
    await this.thumbs.regenerate(reelId);
    return this.getReel(channelId, reelId, userId);
  }

  async chooseThumbnail(channelId: string, reelId: string, thumbId: string, userId: string) {
    const r = await this.reels.exists({ _id: reelId, channelId });
    if (!r) throw new NotFoundException('Reel not found');
    await this.thumbs.choose(reelId, thumbId);
    return this.getReel(channelId, reelId, userId);
  }

  async changeVisual(channelId: string, reelId: string, visualId: string, action: 'replace' | 'remove') {
    const r = await this.reels.findOne({ _id: reelId, channelId }).select('status').lean();
    if (!r) throw new NotFoundException('Reel not found');
    if (['queued', 'rendering'].includes(r.status)) throw new ConflictException('This reel is being rendered right now. Try again in a minute.');
    if (action === 'replace') await this.visualsSvc.replace(reelId, visualId);
    else await this.visualsSvc.remove(reelId, visualId);
    return this.rerender(channelId, reelId);
  }

  private media(reelId: string, userId: string, ready: boolean) {
    if (!ready) return null;
    const t = encodeURIComponent(this.mediaToken(reelId, userId));
    const base = `/api/reels/media/${reelId}`;
    return { video: `${base}/video?t=${t}`, cover: `${base}/cover?t=${t}`, download: `${base}/download?t=${t}`, srt: `${base}/srt?t=${t}` };
  }

  // ------------------------------------------------------------------ campaigns

  async createCampaign(channelId: string, userId: string, dto: CreateCampaignInput) {
    if (!this.cfg.REELS_ENABLED) throw new ServiceUnavailableException('Reel generation is turned off');
    if (dto.targetReels > this.cfg.REEL_MAX_REELS_PER_CAMPAIGN) {
      throw new BadRequestException(`Max ${this.cfg.REEL_MAX_REELS_PER_CAMPAIGN} reels per campaign`);
    }
    const active = await this.campaigns.countDocuments({ channelId, origin: { $in: ['manual', null] }, status: { $nin: TERMINAL_CAMPAIGN_STATUSES } });
    if (active >= MAX_ACTIVE_CAMPAIGNS) {
      throw new HttpException(`${active} campaigns are already running. Wait for one to finish.`, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (dto.seedVideoIds.length) {
      const found = await this.videos.countDocuments({ channelId: new Types.ObjectId(channelId), youtubeId: { $in: dto.seedVideoIds } });
      if (found !== dto.seedVideoIds.length) throw new BadRequestException('Some seed videos are not from this channel');
    }
    const campaign = await this.campaigns.create({
      channelId: new Types.ObjectId(channelId),
      userId: new Types.ObjectId(userId),
      name: dto.name || truncate(dto.brief, 80),
      brief: dto.brief,
      status: 'queued',
      settings: {
        targetReels: dto.targetReels,
        minSec: dto.minSec,
        maxSec: dto.maxSec,
        allowCrossVideo: dto.allowCrossVideo,
        templateName: 'default',
        seedVideoIds: dto.seedVideoIds,
      },
      progress: { stage: 'queued', message: 'Queued — starting research' },
      log: [{ at: new Date(), level: 'info', msg: 'Campaign created' }],
    });
    await this.queues.campaign('research', String(campaign._id));
    return this.campaignSummary(campaign.toObject(), {});
  }

  /** Upload finished → a campaign built only from that video. Not limited by the running-campaign cap. */
  async createVideoCampaign(channelId: string, userId: string, uploadId: string, opts: { brief?: string; targetReels: number }) {
    if (!this.cfg.REELS_ENABLED) throw new ServiceUnavailableException('Reel generation is turned off');
    const up = await this.uploads.complete(channelId, uploadId);
    if (up.campaignId) {
      const existing = await this.campaigns.findById(up.campaignId).lean();
      if (existing) return this.campaignSummary(existing, {});
    }
    const target = Math.min(opts.targetReels, this.cfg.REEL_MAX_REELS_PER_CAMPAIGN);
    const brief = opts.brief?.trim() || `Reels from my new video "${up.title}"`;
    const campaign = await this.campaigns.create({
      channelId: new Types.ObjectId(channelId),
      userId: new Types.ObjectId(userId),
      origin: 'video',
      name: truncate(up.title, 80),
      brief,
      status: 'queued',
      settings: { targetReels: target, minSec: 30, maxSec: 60, allowCrossVideo: false, templateName: 'default', seedVideoIds: [], uploadSourceId: up.sourceId },
      progress: { stage: 'queued', message: 'Preparing your uploaded video' },
      log: [{ at: new Date(), level: 'info', msg: `Campaign created from upload "${up.fileName}"` }],
    });
    await this.uploads.attachCampaign(up._id, campaign._id);
    await this.queues.campaign('research', String(campaign._id));
    return this.campaignSummary(campaign.toObject(), {});
  }

  /** Recent channel videos that could be the published version of an uploaded video (best match first). */
  async linkCandidates(channelId: string, campaignId: string) {
    const c = await this.campaigns.findOne({ _id: campaignId, channelId }).select('settings createdAt').lean();
    if (!c?.settings?.uploadSourceId) throw new NotFoundException('This campaign is not from an uploaded video');
    const src = await this.sources.findOne({ youtubeId: c.settings.uploadSourceId }).select('durationSec title linkedYoutubeId').lean();
    const since = new Date(new Date(c.createdAt as Date).getTime() - 2 * 86_400_000);
    const vids = await this.videos
      .find({ channelId: new Types.ObjectId(channelId), publishedAt: { $gte: since }, deletedFromYoutube: { $ne: true } })
      .sort({ publishedAt: -1 })
      .limit(15)
      .select('youtubeId title publishedAt durationSeconds')
      .lean();
    const dur = src?.durationSec ?? 0;
    return {
      linked: src?.linkedYoutubeId ?? null,
      candidates: vids
        .map((v: any) => ({ youtubeId: v.youtubeId, title: v.title, publishedAt: v.publishedAt, durationSec: v.durationSeconds ?? null, likely: !!dur && !!v.durationSeconds && Math.abs(v.durationSeconds - dur) <= 3 }))
        .sort((a, b) => Number(b.likely) - Number(a.likely)),
    };
  }

  /** Link the uploaded video to its published YouTube video: reels not yet posted get the "Full breakdown" link. */
  async linkVideo(channelId: string, campaignId: string, youtubeId: string) {
    const c = await this.campaigns.findOne({ _id: campaignId, channelId }).select('settings').lean();
    if (!c?.settings?.uploadSourceId) throw new NotFoundException('This campaign is not from an uploaded video');
    const owned = await this.videos.findOne({ channelId: new Types.ObjectId(channelId), youtubeId }).select('title').lean();
    if (!owned) throw new BadRequestException('That video is not on this channel');
    await this.sources.updateOne({ youtubeId: c.settings.uploadSourceId }, { $set: { linkedYoutubeId: youtubeId } });
    const reels = await this.reels.find({ campaignId, status: { $in: ['queued', 'rendering', 'todo', 'failed'] } }).select('clips packaging.description').lean();
    for (const r of reels) {
      const main = [...r.clips].sort((a, b) => b.end - b.start - (a.end - a.start))[0];
      const line = fullVideoLine(owned.title, `https://youtu.be/${youtubeId}?t=${Math.floor(main?.start ?? 0)}`);
      const desc = withFullVideoLine(r.packaging?.description ?? '', line);
      await this.reels.updateOne({ _id: r._id }, { $set: { 'packaging.description': desc } });
    }
    return { ok: true, updated: reels.length };
  }

  async listCampaigns(channelId: string, limit = 30) {
    // The hidden explore part of a daily campaign is never a card of its own: it is folded into its parent.
    const docs = await this.campaigns
      .find({ channelId, parentCampaignId: null })
      .sort({ createdAt: -1 })
      .limit(Math.min(100, limit))
      .select('-log -research.memo')
      .lean();
    const kidIds = docs.map((d) => d.exploreCampaignId).filter(Boolean) as Types.ObjectId[];
    const kids = kidIds.length ? await this.campaigns.find({ _id: { $in: kidIds } }).select('status progress usage').lean() : [];
    const kidById = new Map(kids.map((k) => [String(k._id), k]));
    const allIds = [...docs.map((d) => d._id), ...kidIds];
    const counts = await this.reels.aggregate<{ _id: { c: Types.ObjectId; s: string }; n: number }>([
      { $match: { campaignId: { $in: allIds } } },
      { $group: { _id: { c: '$campaignId', s: '$status' }, n: { $sum: 1 } } },
    ]);
    const views = await this.analytics.viewsByCampaign(allIds);
    return docs.map((d) => {
      const kid = d.exploreCampaignId ? kidById.get(String(d.exploreCampaignId)) : undefined;
      const mine = [String(d._id), ...(kid ? [String(kid._id)] : [])];
      const byStatus: Record<string, number> = {};
      for (const c of counts) if (mine.includes(String(c._id.c))) byStatus[c._id.s] = (byStatus[c._id.s] ?? 0) + c.n;
      const v = mine.reduce((a, id) => ({ views: a.views + (views.get(id)?.views ?? 0), posts: a.posts + (views.get(id)?.posts ?? 0) }), { views: 0, posts: 0 });
      const shown = familyStatus(d.status, kid ?? null, TERMINAL_CAMPAIGN_STATUSES);
      return {
        ...this.campaignSummary({ ...d, status: shown.status, progress: shown.progressMessage ? { ...d.progress, message: shown.progressMessage } : d.progress, usage: this.sumUsage(d.usage, kid?.usage) }, byStatus),
        performance: v,
      };
    });
  }

  private sumUsage(a: Record<string, any> | undefined, b: Record<string, any> | undefined) {
    if (!b) return a;
    const out: Record<string, any> = { ...(a ?? {}) };
    for (const [k, v] of Object.entries(b)) if (typeof v === 'number') out[k] = (out[k] ?? 0) + v;
    if (a?.models || b.models) out.models = mergeModelTokens(a?.models, b.models);
    return out;
  }

  /** Token usage plus an estimated model cost in US dollars (prices: OPENAI_REEL_PRICES). */
  private withCost(u: Record<string, any> | undefined) {
    if (!u) return u;
    return { ...u, costUsd: estimateCostUsd(u.models, u, parsePrices(this.cfg.OPENAI_REEL_PRICES), this.cfg.OPENAI_REEL_MODEL) };
  }

  private campaignSummary(d: any, reelCounts: Record<string, number>) {
    return {
      id: String(d._id),
      origin: d.origin ?? 'manual',
      dailyDate: d.dailyDate ?? null,
      name: d.name,
      brief: d.brief,
      status: d.status,
      progress: d.progress,
      blockedReason: d.blockedReason ?? null,
      settings: d.settings,
      stats: d.stats,
      usage: this.withCost(d.usage),
      sourceCount: d.sources?.length ?? 0,
      reelCounts,
      error: d.error ?? null,
      createdAt: d.createdAt,
      finishedAt: d.finishedAt ?? null,
    };
  }

  async getCampaign(channelId: string, campaignId: string, userId: string) {
    const fam = await campaignFamily(this.campaigns, campaignId, { channelId });
    if (!fam) throw new NotFoundException('Campaign not found');
    const d = (await this.campaigns.findById(fam.root._id).select('-research.memo').lean())!;
    const reels = await this.reels.find({ campaignId: { $in: fam.ids } }).sort({ campaignId: 1, index: 1 }).lean();
    const trackOf = new Map<string, 'main' | 'explore'>([[String(d._id), 'main'], ...(fam.child ? ([[String(fam.child._id), 'explore']] as Array<[string, 'main' | 'explore']>) : [])]);
    const explore = fam.child
      ? {
          campaignId: String(fam.child._id),
          name: fam.child.name,
          brief: fam.child.brief,
          status: fam.child.status,
          progress: fam.child.progress,
          error: fam.child.error ?? null,
          topicSummary: fam.child.research?.topicSummary ?? null,
        }
      : null;
    const srcStages = await this.sources
      .find({ youtubeId: { $in: d.sources.map((s) => s.youtubeId) } })
      .select('youtubeId stage error height momentCount')
      .lean();
    const stageById = new Map(srcStages.map((s) => [s.youtubeId, s]));
    const postMap = await this.publish.summariesForReels(reels.map((r) => r._id));
    const counts: Record<string, number> = {};
    for (const r of reels) counts[r.status] = (counts[r.status] ?? 0) + 1;
    const shown = familyStatus(d.status, fam.child, TERMINAL_CAMPAIGN_STATUSES);
    return {
      ...this.campaignSummary({ ...d, status: shown.status, progress: shown.progressMessage ? { ...d.progress, message: shown.progressMessage } : d.progress, usage: this.sumUsage(d.usage as any, fam.child?.usage as any) }, counts),
      track: 'main' as const,
      explore,
      research: d.research
        ? {
            topicSummary: d.research.topicSummary,
            angles: d.research.angles,
            hookPatterns: d.research.hookPatterns,
            externalExamples: d.research.externalExamples,
            audienceQuestions: d.research.audienceQuestions,
            webSources: d.research.webSources,
          }
        : null,
      sources: d.sources.map((s) => {
        const st = stageById.get(s.youtubeId);
        return { ...s, stage: st?.stage ?? 'queued', stageError: st?.error ?? null, height: st?.height ?? null, momentCount: st?.momentCount ?? 0 };
      }),
      log: (d.log ?? []).slice(-80),
      candidates: d.candidates ?? [],
      reels: reels.map((r) => ({ ...this.reelSummary(r, userId, postMap.get(String(r._id))), track: trackOf.get(String(r.campaignId)) ?? 'main' })),
    };
  }

  async cancelCampaign(channelId: string, campaignId: string) {
    const fam = await campaignFamily(this.campaigns, campaignId, { channelId });
    if (!fam) throw new NotFoundException('Campaign not found');
    let status = fam.root.status as string;
    for (const c of [fam.root, fam.child].filter(Boolean)) {
      if (TERMINAL_CAMPAIGN_STATUSES.includes(c.status)) continue;
      await this.campaigns.updateOne(
        { _id: c._id },
        {
          $set: { cancelRequested: true, status: 'cancelled', finishedAt: new Date(), 'progress.stage': 'cancelled', 'progress.message': 'Cancelled by user' },
          $push: { log: { $each: [{ at: new Date(), level: 'warn', msg: 'Cancelled by user' }], $slice: -300 } },
        },
      );
      const reelIds = new Set((await this.reels.find({ campaignId: c._id, status: 'queued' }).select('_id').lean()).map((r) => String(r._id)));
      const jobs = await this.queues.q.render.getJobs(['waiting', 'delayed', 'paused']);
      for (const j of jobs) if (j && reelIds.has(String(j.data?.reelId))) await j.remove().catch(() => undefined);
      await this.reels.updateMany({ campaignId: c._id, status: 'queued' }, { $set: { status: 'failed', error: 'Campaign cancelled' } });
      if (c._id.equals(fam.root._id)) status = 'cancelled';
    }
    return { ok: true, status };
  }

  /** "Find more reels": runs more composing rounds over the moments this campaign has not reviewed yet. No new downloads, speech-to-text or mining. */
  async topUp(channelId: string, campaignId: string, count?: number) {
    if (!this.cfg.REELS_ENABLED) throw new ServiceUnavailableException('Reel generation is turned off');
    const c = await this.campaigns.findOne({ _id: campaignId, channelId });
    if (!c) throw new NotFoundException('Campaign not found');
    if (!['partial', 'completed'].includes(c.status)) throw new BadRequestException('Only finished campaigns can be topped up');
    if (!c.sources.some((s) => s.status === 'ready')) throw new BadRequestException('This campaign has no analyzed source videos');
    const active = await this.campaigns.countDocuments({ channelId, parentCampaignId: null, status: { $nin: TERMINAL_CAMPAIGN_STATUSES } });
    if (active >= MAX_ACTIVE_CAMPAIGNS) throw new HttpException(`${active} campaigns are already running. Wait for one to finish.`, HttpStatus.TOO_MANY_REQUESTS);

    const existing = await this.reels.countDocuments({ campaignId: c._id, status: { $in: ['queued', 'rendering', 'todo', 'posted'] } });
    const add = Math.max(1, Math.min(10, Math.floor(count ?? (existing < c.settings.targetReels ? c.settings.targetReels - existing : 3))));
    if (existing + add > 25) throw new BadRequestException('A campaign can hold at most 25 reels');
    await this.campaigns.updateOne(
      { _id: c._id },
      {
        $set: {
          status: 'composing',
          'settings.targetReels': existing + add,
          cancelRequested: false,
          finishedAt: null,
          error: null,
          blockedReason: null,
          'progress.stage': 'composing',
          'progress.message': `Looking for ${add} more reel${add === 1 ? '' : 's'} in the unreviewed moments`,
        },
        $push: { log: { $each: [{ at: new Date(), level: 'info', msg: `Top-up requested: ${add} more reel${add === 1 ? '' : 's'}` }], $slice: -300 } },
      },
    );
    await this.queues.campaign('topup', String(c._id));
    return { ok: true, adding: add };
  }

  /** "Refresh look": re-make every reel that is not posted yet (both parts of a daily campaign) with the latest voice, picture placement and style. */
  async refreshLook(channelId: string, campaignId: string) {
    const fam = await campaignFamily(this.campaigns, campaignId, { channelId });
    if (!fam) throw new NotFoundException('Campaign not found');
    const parts = [fam.root, fam.child].filter(Boolean);
    if (parts.some((c) => !TERMINAL_CAMPAIGN_STATUSES.includes(c.status))) throw new ConflictException('Wait until this campaign has finished.');
    let queued = 0;
    for (const c of parts) {
      const list = await this.reels.find({ campaignId: c._id, status: 'todo' }).select('_id').lean();
      if (!list.length) continue;
      await this.campaigns.updateOne(
        { _id: c._id },
        { $set: { status: 'rendering', finishedAt: null, cancelRequested: false, 'progress.stage': 'rendering', 'progress.message': `Refreshing ${list.length} reels with the latest voice and pictures` } },
      );
      for (const r of list) {
        await this.reels.updateOne({ _id: r._id }, { $set: { status: 'queued', error: null } });
        await this.queues.render(String(r._id));
      }
      queued += list.length;
    }
    return { queued };
  }

  async retryFailedRenders(channelId: string, campaignId: string) {
    const fam = await campaignFamily(this.campaigns, campaignId, { channelId });
    if (!fam) throw new NotFoundException('Campaign not found');
    let retried = 0;
    for (const c of [fam.root, fam.child].filter(Boolean)) {
      const failed = await this.reels.find({ campaignId: c._id, status: 'failed', error: { $ne: 'Campaign cancelled' } }).select('_id').lean();
      if (!failed.length) continue;
      await this.campaigns.updateOne(
        { _id: c._id },
        { $set: { status: 'rendering', finishedAt: null, cancelRequested: false, 'progress.stage': 'rendering', 'progress.message': `Retrying ${failed.length} renders` } },
      );
      for (const r of failed) {
        await this.reels.updateOne({ _id: r._id }, { $set: { status: 'queued', error: null } });
        await this.queues.render(String(r._id));
      }
      retried += failed.length;
    }
    return { retried };
  }

  // ------------------------------------------------------------------ reels

  reelSummary(r: any, userId: string, posts: Array<{ platform: string; status: string; url: string | null; views: number | null }> = []) {
    const ready = !!r.assets?.videoKey && ['todo', 'posted', 'rejected'].includes(r.status);
    return {
      id: String(r._id),
      campaignId: String(r.campaignId),
      index: r.index,
      status: r.status,
      shape: r.shape,
      concept: r.concept,
      angle: r.angle,
      hookText: r.hookText,
      payoffText: r.payoffText,
      whyItWorks: r.whyItWorks,
      durationSec: r.durationSec,
      clips: (r.clips ?? []).map((c: any) => ({
        youtubeId: c.youtubeId,
        sourceTitle: c.sourceTitle,
        role: c.role,
        start: c.start,
        end: c.end,
        text: c.text,
        sourceUrl: c.youtubeId.startsWith('up_') ? null : `https://youtu.be/${c.youtubeId}?t=${Math.floor(c.start)}`,
      })),
      scores: r.scores,
      critique: r.critique,
      packaging: r.packaging,
      entityNames: r.entityNames,
      themes: r.themes,
      qa: r.qa,
      error: r.error ?? null,
      postedAt: r.postedAt ?? null,
      postedUrl: r.postedUrl ?? null,
      rejectReason: r.rejectReason ?? null,
      createdAt: r.createdAt,
      media: this.media(String(r._id), userId, ready),
      visuals: this.visualsOut(r, userId),
      thumbnails: this.thumbnailsOut(r, userId),
      posts,
    };
  }

  async listReels(channelId: string, userId: string, q: { status?: string; campaignId?: string; entity?: string; period: string; limit: number; skip: number }) {
    const filter: Record<string, unknown> = { channelId: new Types.ObjectId(channelId) };
    if (q.status) filter.status = q.status;
    else filter.status = { $in: ['todo', 'posted', 'rejected', 'queued', 'rendering', 'failed'] };
    if (q.campaignId) {
      // a daily campaign's reels live in two campaigns (main + hidden explore part): list both under the parent
      const fam = Types.ObjectId.isValid(q.campaignId) ? await campaignFamily(this.campaigns, q.campaignId, { channelId }) : null;
      filter.campaignId = fam ? { $in: fam.ids } : new Types.ObjectId(q.campaignId);
    }
    if (q.entity) filter.entitySlugs = q.entity;
    if (q.period !== 'all') filter.createdAt = { $gte: new Date(Date.now() - (q.period === '7d' ? 7 : 30) * 86_400_000) };
    const [items, total] = await Promise.all([
      this.reels.find(filter).sort({ createdAt: -1 }).skip(q.skip).limit(q.limit).lean(),
      this.reels.countDocuments(filter),
    ]);
    const postMap = await this.publish.summariesForReels(items.map((r) => r._id));
    return { total, items: items.map((r) => this.reelSummary(r, userId, postMap.get(String(r._id)))) };
  }

  async getReel(channelId: string, reelId: string, userId: string) {
    const r = await this.reels.findOne({ _id: reelId, channelId }).lean();
    if (!r) throw new NotFoundException('Reel not found');
    const postMap = await this.publish.summariesForReels([r._id]);
    return this.reelSummary(r, userId, postMap.get(String(r._id)));
  }

  async patchReel(channelId: string, reelId: string, userId: string, dto: PatchReelInput) {
    const r = await this.reels.findOne({ _id: reelId, channelId });
    if (!r) throw new NotFoundException('Reel not found');
    const set: Record<string, unknown> = {};
    const unset: Record<string, ''> = {};
    let needsRerender = false;

    if (dto.status && dto.status !== r.status) {
      const allowed: Record<string, string[]> = { todo: ['posted', 'rejected'], posted: ['todo', 'rejected'], rejected: ['todo'] };
      if (!allowed[r.status]?.includes(dto.status)) throw new BadRequestException(`Cannot change a ${r.status} reel to ${dto.status}`);
      set.status = dto.status;
      if (dto.status === 'posted') {
        set.postedAt = new Date();
        if (dto.postedUrl) set.postedUrl = dto.postedUrl;
      }
      if (dto.status === 'rejected') {
        set.rejectedAt = new Date();
        set.rejectReason = dto.rejectReason ?? '';
        // Give the material back to the bank unless the moment itself was the problem.
        await this.moments.updateMany(
          { _id: { $in: r.momentIds } },
          dto.rejectKind === 'bad_moment' ? { $set: { status: 'retired' } } : { $set: { status: 'unused' }, $inc: { rejectedCount: 1 } },
        );
      }
      if (dto.status === 'todo') {
        unset.postedAt = '';
        unset.rejectedAt = '';
        unset.rejectReason = '';
        await this.moments.updateMany({ _id: { $in: r.momentIds } }, { $set: { status: 'used', lastUsedAt: new Date() } });
      }
    } else if (dto.status === 'posted' && dto.postedUrl !== undefined) {
      set.postedUrl = dto.postedUrl;
    }

    if (dto.packaging) {
      for (const [k, v] of Object.entries(dto.packaging)) if (v !== undefined) set[`packaging.${k}`] = v;
      if (dto.packaging.headline && dto.packaging.headline !== r.packaging?.headline) needsRerender = true;
    }
    if (Object.keys(set).length || Object.keys(unset).length) {
      await this.reels.updateOne({ _id: r._id }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) });
    }
    return { ...(await this.getReel(channelId, reelId, userId)), needsRerender };
  }

  async rerender(channelId: string, reelId: string) {
    const r = await this.reels.findOne({ _id: reelId, channelId }).select('status').lean();
    if (!r) throw new NotFoundException('Reel not found');
    if (['queued', 'rendering'].includes(r.status)) return { ok: true, status: r.status };
    await this.reels.updateOne({ _id: reelId }, { $set: { status: 'queued', error: null } });
    await this.queues.render(reelId);
    return { ok: true, status: 'queued' };
  }

  // ------------------------------------------------------------------ memory: coverage + insights

  async coverage(channelId: string) {
    const cid = new Types.ObjectId(channelId);
    const [byEntity, untapped, ents, totals] = await Promise.all([
      this.reels.aggregate<{ _id: string; total: number; todo: number; posted: number; rejected: number; last: Date }>([
        { $match: { channelId: cid, status: { $in: ['todo', 'posted', 'rejected', 'queued', 'rendering'] } } },
        { $unwind: '$entitySlugs' },
        {
          $group: {
            _id: '$entitySlugs',
            total: { $sum: 1 },
            todo: { $sum: { $cond: [{ $eq: ['$status', 'todo'] }, 1, 0] } },
            posted: { $sum: { $cond: [{ $eq: ['$status', 'posted'] }, 1, 0] } },
            rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
            last: { $max: '$createdAt' },
          },
        },
      ]),
      this.moments.aggregate<{ _id: string; n: number }>([
        { $match: { channelId: cid, status: 'unused', standalone: { $gte: 7 } } },
        { $unwind: '$entitySlugs' },
        { $group: { _id: '$entitySlugs', n: { $sum: 1 } } },
      ]),
      this.entities.find({ channelId: cid }).select('slug name').lean(),
      this.moments.aggregate<{ _id: string; n: number }>([{ $match: { channelId: cid } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);
    const names = new Map(ents.map((e) => [e.slug, e.name]));
    const untappedMap = new Map(untapped.map((u) => [u._id, u.n]));
    const rows = new Map<string, any>();
    for (const e of byEntity) rows.set(e._id, { slug: e._id, name: names.get(e._id) ?? e._id, ...e, untappedStrongMoments: untappedMap.get(e._id) ?? 0 });
    for (const [slug, n] of untappedMap) if (!rows.has(slug)) rows.set(slug, { slug, name: names.get(slug) ?? slug, total: 0, todo: 0, posted: 0, rejected: 0, last: null, untappedStrongMoments: n });
    const momentTotals = Object.fromEntries(totals.map((t) => [t._id, t.n]));
    return {
      momentBank: { unused: momentTotals.unused ?? 0, used: momentTotals.used ?? 0, retired: momentTotals.retired ?? 0 },
      entities: [...rows.values()]
        .map(({ _id, ...rest }) => rest)
        .sort((a, b) => b.total - a.total || b.untappedStrongMoments - a.untappedStrongMoments)
        .slice(0, 60),
    };
  }

  async insights(channelId: string, period: 'week' | 'month') {
    const cid = new Types.ObjectId(channelId);
    const since = new Date(Date.now() - (period === 'week' ? 7 : 30) * 86_400_000);
    const [statusAgg, perDay, campaignAgg, usageAgg] = await Promise.all([
      this.reels.aggregate<{ _id: string; n: number }>([{ $match: { channelId: cid, createdAt: { $gte: since } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      this.reels.aggregate<{ _id: string; n: number }>([
        { $match: { channelId: cid, createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, n: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      this.campaigns.aggregate<{ _id: string; n: number }>([{ $match: { channelId: cid, createdAt: { $gte: since } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      this.campaigns.aggregate<{ prompt: number; completion: number; stt: number }>([
        { $match: { channelId: cid, createdAt: { $gte: since } } },
        { $group: { _id: null, prompt: { $sum: '$usage.promptTokens' }, completion: { $sum: '$usage.completionTokens' }, stt: { $sum: '$usage.sttSeconds' } } },
      ]),
    ]);
    const reelsByStatus = Object.fromEntries(statusAgg.map((s) => [s._id, s.n]));
    const posted = await this.reels.countDocuments({ channelId: cid, postedAt: { $gte: since } });
    return {
      period,
      since,
      reelsByStatus,
      reelsCreated: statusAgg.reduce((n, s) => n + s.n, 0),
      reelsPosted: posted,
      perDay: perDay.map((d) => ({ date: d._id, reels: d.n })),
      campaignsByStatus: Object.fromEntries(campaignAgg.map((s) => [s._id, s.n])),
      usage: {
        promptTokens: usageAgg[0]?.prompt ?? 0,
        completionTokens: usageAgg[0]?.completion ?? 0,
        transcribedMinutes: Math.round((usageAgg[0]?.stt ?? 0) / 60),
      },
    };
  }
}
