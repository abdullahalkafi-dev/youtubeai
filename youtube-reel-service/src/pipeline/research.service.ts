import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AiService } from '../ai/ai.service';
import { compactNumber } from '../common/text';
import { errMsg } from '../common/errors';
import { ReelCampaignDocument } from '../db/schemas/reel-campaign.schema';
import { SourceVideo, SourceVideoDocument } from '../db/schemas/shared.readonly';
import {
  buildResearchSynthUser,
  buildWebResearchUser,
  RESEARCH_SYNTH_SYSTEM,
  RESEARCH_VERSION,
  ResearchSchema,
  WEB_RESEARCH_SYSTEM,
} from '../prompts/research.prompt';
import { OrchestratorService } from '../queue/orchestrator.service';
import { EntityService } from './entity.service';

@Injectable()
export class ResearchService {
  private readonly logger = new Logger(ResearchService.name);

  constructor(
    @InjectModel(SourceVideo.name) private readonly videos: Model<SourceVideoDocument>,
    private readonly ai: AiService,
    private readonly entities: EntityService,
    private readonly orchestrator: OrchestratorService,
  ) {}

  async research(campaign: ReelCampaignDocument) {
    const id = String(campaign._id);
    const usage = this.orchestrator.usageSink(id);

    let memo = '';
    let webSources: Array<{ title: string; url: string }> = [];
    try {
      const web = await this.ai.webResearch({
        task: `research:${id}`,
        system: WEB_RESEARCH_SYSTEM,
        user: buildWebResearchUser(campaign.brief),
        usage,
      });
      memo = web.text;
      webSources = web.sources;
      await this.orchestrator.log(id, 'info', `Web research done (${webSources.length} sources)`);
    } catch (err) {
      await this.orchestrator.log(id, 'warn', `Web research unavailable, continuing with channel data only: ${errMsg(err)}`);
    }

    const top = await this.videos
      .find({ channelId: campaign.channelId, privacyStatus: 'public', durationSeconds: { $gt: 240 } })
      .sort({ viewCount: -1 })
      .limit(25)
      .select('title viewCount')
      .lean();

    const result = await this.ai.generateJson({
      task: `research-synth:${id}`,
      system: RESEARCH_SYNTH_SYSTEM,
      user: buildResearchSynthUser(
        campaign.brief,
        memo,
        top.map((v) => `${v.title} (${compactNumber(v.viewCount ?? 0)} views)`),
      ),
      schema: ResearchSchema,
      schemaName: 'research_brief',
      reasoningEffort: 'medium',
      usage,
    });

    await this.entities.upsertWithAliases(campaign.channelId, result.primaryEntities);
    return { ...result, webSources, memo: memo.slice(0, 20_000), version: RESEARCH_VERSION, at: new Date() };
  }
}
