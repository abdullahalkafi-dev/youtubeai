import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CampaignSourceRef, ReelCampaign, ReelCampaignDocument } from '../db/schemas/reel-campaign.schema';
import { ReelSource, ReelSourceDocument } from '../db/schemas/reel-source.schema';
import { MINING_VERSION } from '../prompts/mining.prompt';
import type { ResearchResult } from '../prompts/research.prompt';
import { OrchestratorService } from '../queue/orchestrator.service';
import { CampaignJob, QueueService } from '../queue/queue.service';
import { ComposerService } from './composer.service';
import { ResearchService } from './research.service';
import { SourcingService } from './sourcing.service';

/** Worker-side handlers for the campaign steps: research → source → (prepare) → compose. */
@Injectable()
export class CampaignRunnerService {
  private readonly logger = new Logger(CampaignRunnerService.name);

  constructor(
    @InjectModel(ReelCampaign.name) private readonly campaigns: Model<ReelCampaignDocument>,
    @InjectModel(ReelSource.name) private readonly sources: Model<ReelSourceDocument>,
    private readonly orchestrator: OrchestratorService,
    private readonly queues: QueueService,
    private readonly research: ResearchService,
    private readonly sourcing: SourcingService,
    private readonly composer: ComposerService,
  ) {}

  async run(job: CampaignJob) {
    const { campaignId, step } = job;
    await this.orchestrator.assertActive(campaignId);
    if (step === 'research') return this.stepResearch(campaignId);
    if (step === 'source') return this.stepSource(campaignId);
    if (step === 'compose') return this.stepCompose(campaignId);
    if (step === 'topup') return this.stepCompose(campaignId, true);
  }

  private async stepResearch(campaignId: string) {
    const c = await this.orchestrator.transition(campaignId, ['queued', 'researching'], 'researching', 'Researching what is working online right now');
    if (!c) return;
    const research = await this.research.research(c);
    await this.campaigns.updateOne({ _id: c._id }, { $set: { research } });
    const moved = await this.orchestrator.transition(campaignId, ['researching'], 'sourcing', 'Finding the best source videos in the catalog');
    if (moved) await this.queues.campaign('source', campaignId);
  }

  private async stepSource(campaignId: string) {
    const c = await this.campaigns.findOne({ _id: campaignId, status: 'sourcing' });
    if (!c) return;
    const refs = await this.sourcing.select(c, c.research as ResearchResult);
    await this.campaigns.updateOne({ _id: c._id }, { $set: { sources: refs } });
    const reused = refs.filter((r) => r.fromBank).length;
    const moved = await this.orchestrator.transition(
      campaignId,
      ['sourcing'],
      'preparing',
      `Selected ${refs.length} source videos${reused ? ` (${reused} already analyzed)` : ''}; downloading and analyzing`,
    );
    if (!moved) return;
    for (const ref of refs) await this.kickSource(ref, c.channelId);
    await this.orchestrator.refreshPreparing(campaignId);
  }

  private async stepCompose(campaignId: string, topUp = false) {
    const c = await this.campaigns.findOne({ _id: campaignId, status: 'composing' }).select('_id').lean();
    if (!c) return;
    const n = await this.composer.compose(campaignId, { topUp });
    this.logger.log(`Campaign ${campaignId}: ${n} reels queued for render`);
  }

  /** Make sure a source video is moving through download → analyze (idempotent). */
  async kickSource(ref: Pick<CampaignSourceRef, 'youtubeId' | 'videoId' | 'title'>, channelId: Types.ObjectId) {
    const src = await this.sources.findOneAndUpdate(
      { youtubeId: ref.youtubeId },
      { $setOnInsert: { youtubeId: ref.youtubeId, videoId: new Types.ObjectId(ref.videoId), channelId, title: ref.title, stage: 'queued' } },
      { upsert: true, new: true },
    );
    switch (src.stage) {
      case 'ready':
        if (src.minedVersion !== MINING_VERSION) await this.queues.analyze(src.youtubeId);
        return;
      case 'failed':
        if ((src.error ?? '').startsWith('unavailable')) return; // permanently unavailable — skip
        await this.sources.updateOne({ youtubeId: src.youtubeId }, { $set: { stage: 'queued', error: null } });
        await this.queues.download(src.youtubeId);
        return;
      case 'downloaded':
      case 'transcribing':
      case 'mining':
        await this.queues.analyze(src.youtubeId);
        return;
      default: // queued, downloading, blocked
        await this.queues.download(src.youtubeId);
    }
  }
}
