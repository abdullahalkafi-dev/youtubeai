import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CampaignStatus,
  ReelCampaign,
  ReelCampaignDocument,
  TERMINAL_CAMPAIGN_STATUSES,
} from '../db/schemas/reel-campaign.schema';
import { Reel, ReelDocument } from '../db/schemas/reel.schema';
import { ReelSource, ReelSourceDocument } from '../db/schemas/reel-source.schema';
import { UsageDelta, UsageSink } from '../ai/ai.service';
import { CancelledError } from '../common/errors';
import { MINING_VERSION } from '../prompts/mining.prompt';
import { QueueService } from './queue.service';

/**
 * Campaign state machine. Every transition is an atomic findOneAndUpdate on the expected
 * current status, so retried / duplicated jobs can never run a step twice.
 */
@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);

  constructor(
    @InjectModel(ReelCampaign.name) private readonly campaigns: Model<ReelCampaignDocument>,
    @InjectModel(Reel.name) private readonly reels: Model<ReelDocument>,
    @InjectModel(ReelSource.name) private readonly sources: Model<ReelSourceDocument>,
    private readonly queues: QueueService,
  ) {}

  async log(campaignId: string | Types.ObjectId, level: 'info' | 'warn' | 'error', msg: string, stageMessage = true) {
    this.logger[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`[campaign ${campaignId}] ${msg}`);
    await this.campaigns.updateOne(
      { _id: campaignId },
      {
        $push: { log: { $each: [{ at: new Date(), level, msg }], $slice: -300 } },
        ...(stageMessage ? { $set: { 'progress.message': msg } } : {}),
      },
    );
  }

  usageSink(campaignId: string | Types.ObjectId): UsageSink {
    return async (d: UsageDelta) => {
      const inc: Record<string, number> = {};
      for (const [k, v] of Object.entries(d)) if (v) inc[`usage.${k}`] = v;
      if (Object.keys(inc).length) await this.campaigns.updateOne({ _id: campaignId }, { $inc: inc });
    };
  }

  /** Atomically move a campaign from one of `from` to `to`. Returns the updated doc, or null if someone else did. */
  async transition(campaignId: string, from: CampaignStatus[], to: CampaignStatus, message: string) {
    const doc = await this.campaigns.findOneAndUpdate(
      { _id: campaignId, status: { $in: from }, cancelRequested: { $ne: true } },
      {
        $set: { status: to, 'progress.stage': to, 'progress.message': message, ...(to === 'researching' ? { startedAt: new Date() } : {}) },
        $push: { log: { $each: [{ at: new Date(), level: 'info', msg: message }], $slice: -300 } },
      },
      { new: true },
    );
    return doc;
  }

  async finish(campaignId: string, status: 'completed' | 'partial' | 'failed', message: string) {
    await this.campaigns.updateOne(
      { _id: campaignId, status: { $nin: TERMINAL_CAMPAIGN_STATUSES } },
      {
        $set: {
          status,
          finishedAt: new Date(),
          blockedReason: null,
          'progress.stage': status,
          'progress.message': message,
          ...(status === 'failed' ? { error: message } : {}),
        },
        $push: { log: { $each: [{ at: new Date(), level: status === 'failed' ? 'error' : 'info', msg: message }], $slice: -300 } },
      },
    );
  }

  async assertActive(campaignId: string) {
    const c = await this.campaigns.findById(campaignId).select('status cancelRequested').lean();
    if (!c || c.cancelRequested || c.status === 'cancelled') throw new CancelledError();
    return c;
  }

  /**
   * Called whenever a source video changes stage (ready / failed / blocked).
   * Updates every campaign waiting on it and advances those whose sources are all settled.
   */
  async onSourceSettled(youtubeId: string) {
    const waiting = await this.campaigns.find({ status: 'preparing', 'sources.youtubeId': youtubeId }).select('_id').lean();
    for (const c of waiting) await this.refreshPreparing(String(c._id));
  }

  async refreshPreparing(campaignId: string) {
    const campaign = await this.campaigns.findById(campaignId).lean();
    if (!campaign || campaign.status !== 'preparing') return;
    const ids = campaign.sources.map((s) => s.youtubeId);
    const srcDocs = await this.sources.find({ youtubeId: { $in: ids } }).lean();
    const byId = new Map(srcDocs.map((s) => [s.youtubeId, s]));

    let blocked = 0;
    const updated = campaign.sources.map((ref) => {
      const s = byId.get(ref.youtubeId);
      if (ref.status === 'failed') return ref;
      if (s?.stage === 'ready' && s.minedVersion === MINING_VERSION) return { ...ref, status: 'ready' as const, error: undefined };
      if (s?.stage === 'failed') return { ...ref, status: 'failed' as const, error: s.error };
      if (s?.stage === 'blocked') blocked++;
      return { ...ref, status: 'pending' as const };
    });

    const pending = updated.filter((s) => s.status === 'pending').length;
    const ready = updated.filter((s) => s.status === 'ready').length;
    await this.campaigns.updateOne(
      { _id: campaignId },
      {
        $set: {
          sources: updated,
          blockedReason: blocked ? 'youtube_login_required' : null,
          'progress.message': pending
            ? `Preparing source videos: ${ready}/${updated.length} ready${blocked ? ' — waiting for YouTube reconnect' : ''}`
            : `All sources settled (${ready} ready)`,
        },
      },
    );

    if (pending > 0) return;
    if (ready === 0) {
      await this.finish(campaignId, 'failed', 'None of the selected videos could be downloaded or analyzed.');
      return;
    }
    const moved = await this.transition(campaignId, ['preparing'], 'composing', `Composing reels from ${ready} source videos`);
    if (moved) await this.queues.campaign('compose', campaignId);
  }

  /** Called after each render attempt settles. Finishes the campaign once no reel is still in flight. */
  async onReelSettled(campaignId: string) {
    const campaign = await this.campaigns.findById(campaignId).select('status settings').lean();
    if (!campaign || campaign.status !== 'rendering') return;
    const inFlight = await this.reels.countDocuments({ campaignId, status: { $in: ['queued', 'rendering'] } });
    if (inFlight > 0) return;
    const done = await this.reels.countDocuments({ campaignId, status: { $in: ['todo', 'posted', 'rejected'] } });
    const failed = await this.reels.countDocuments({ campaignId, status: 'failed' });
    await this.campaigns.updateOne({ _id: campaignId }, { $set: { 'stats.rendered': done, 'stats.failed': failed } });
    if (done === 0) return this.finish(campaignId, 'failed', 'All reel renders failed.');
    if (done >= campaign.settings.targetReels && failed === 0) {
      return this.finish(campaignId, 'completed', `${done} reels ready in To-do.`);
    }
    return this.finish(
      campaignId,
      'partial',
      `${done} of ${campaign.settings.targetReels} requested reels ready${failed ? ` (${failed} failed to render)` : ' — material only supported this many strong reels'}.`,
    );
  }
}
