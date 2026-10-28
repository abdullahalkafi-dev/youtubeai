import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppConfig, CONFIG } from '../config/config';
import { AiService } from '../ai/ai.service';
import { errMsg } from '../common/errors';
import { compactNumber, cosine, escapeRegex, fmtTime, parseIsoDuration, truncate } from '../common/text';
import { CampaignSourceRef, ReelCampaignDocument } from '../db/schemas/reel-campaign.schema';
import { ReelMoment, ReelMomentDocument } from '../db/schemas/reel-moment.schema';
import { ReelSource, ReelSourceDocument } from '../db/schemas/reel-source.schema';
import { SourceVideo, SourceVideoDocument } from '../db/schemas/shared.readonly';
import { MINING_VERSION } from '../prompts/mining.prompt';
import type { ResearchResult } from '../prompts/research.prompt';
import {
  buildSourceSelectUser,
  buildTitleScanUser,
  SOURCE_SELECT_SYSTEM,
  SourceSelectSchema,
  TITLE_SCAN_SYSTEM,
  TitleScanSchema,
} from '../prompts/sourcing.prompt';
import { OrchestratorService } from '../queue/orchestrator.service';
import { freshnessBonus } from './lanes';

interface CatalogItem {
  _id: Types.ObjectId;
  youtubeId: string;
  title: string;
  tags: string[];
  description: string;
  viewCount: number;
  publishedAt?: Date;
  durationSec: number;
}

interface Candidate extends CatalogItem {
  keywordScore: number;
  speechHits: number;
  scanRelevance: number;
  bankScore: number;
  fromBank: boolean;
  seeded: boolean;
  score: number;
}

const GENERIC_TERMS = new Set(['prison', 'jail', 'federal', 'feds', 'street', 'streets', 'life', 'money', 'case', 'court']);

/**
 * Picks the 4-10 of the host's own public long-form videos that hold the best material for a campaign.
 * Signals: keyword/alias matches, how often the subject is actually SPOKEN, an LLM scan of every title,
 * already-analyzed moment-bank relevance, then a final choice by the primary model with transcript evidence.
 */
@Injectable()
export class SourcingService {
  private readonly logger = new Logger(SourcingService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @InjectModel(SourceVideo.name) private readonly videos: Model<SourceVideoDocument>,
    @InjectModel(ReelMoment.name) private readonly moments: Model<ReelMomentDocument>,
    @InjectModel(ReelSource.name) private readonly sources: Model<ReelSourceDocument>,
    private readonly ai: AiService,
    private readonly orchestrator: OrchestratorService,
  ) {}

  async select(campaign: ReelCampaignDocument, research: ResearchResult): Promise<CampaignSourceRef[]> {
    const id = String(campaign._id);
    const usage = this.orchestrator.usageSink(id);
    const target = campaign.settings.targetReels;
    const minVideos = Math.min(8, Math.max(2, Math.ceil(target / 2) + 1));
    const maxVideos = Math.min(this.cfg.REEL_MAX_SOURCES_PER_CAMPAIGN, Math.max(minVideos + 1, target + 2));

    const catalog = await this.loadCatalog(campaign.channelId);
    if (!catalog.length) throw new Error('No public long-form videos found for this channel');

    const terms = this.searchTerms(research);
    const specific = terms.filter((t) => !GENERIC_TERMS.has(t));
    const cands = new Map<string, Candidate>();
    const get = (v: CatalogItem) => {
      let c = cands.get(v.youtubeId);
      if (!c) {
        c = { ...v, keywordScore: 0, speechHits: 0, scanRelevance: 0, bankScore: 0, fromBank: false, seeded: false, score: 0 };
        cands.set(v.youtubeId, c);
      }
      return c;
    };

    // 1) Keyword / alias matches in title, tags, description.
    for (const v of catalog) {
      const title = v.title.toLowerCase();
      const tags = v.tags.join(' | ').toLowerCase();
      const desc = v.description.toLowerCase();
      let s = 0;
      for (const t of terms) {
        const w = GENERIC_TERMS.has(t) ? 0.3 : 1;
        if (title.includes(t)) s += 6 * w;
        if (tags.includes(t)) s += 3 * w;
        if (desc.includes(t)) s += 1 * w;
      }
      if (s > 0) get(v).keywordScore = s;
    }

    // 2) How often the subject is actually spoken (existing YouTube transcripts, read-only).
    if (specific.length) {
      try {
        const rx = specific.slice(0, 14).map(escapeRegex).join('|');
        const hits = await this.videos.aggregate<{ youtubeId: string; hits: number }>([
          { $match: { channelId: campaign.channelId, privacyStatus: 'public', transcriptText: { $exists: true } } },
          { $project: { youtubeId: 1, hits: { $size: { $regexFindAll: { input: { $ifNull: ['$transcriptText', ''] }, regex: rx, options: 'i' } } } } },
          { $match: { hits: { $gt: 0 } } },
          { $sort: { hits: -1 } },
          { $limit: 40 },
        ]);
        const byId = new Map(catalog.map((v) => [v.youtubeId, v]));
        for (const h of hits) {
          const v = byId.get(h.youtubeId);
          if (v) get(v).speechHits = h.hits;
        }
      } catch (err) {
        this.logger.warn(`Speech-hit search failed: ${errMsg(err)}`);
      }
    }

    // 3) LLM scan of every title (semantic recall for theme briefs).
    try {
      const lines = catalog.map(
        (v, i) => `${i} | ${truncate(v.title, 110)} | ${compactNumber(v.viewCount)} | ${v.publishedAt ? new Date(v.publishedAt).getFullYear() : '?'} | ${Math.round(v.durationSec / 60)}`,
      );
      const scan = await this.ai.generateJson({
        task: `title-scan:${id}`,
        tier: 'fast',
        system: TITLE_SCAN_SYSTEM,
        user: buildTitleScanUser(campaign.brief, terms.slice(0, 25), lines),
        schema: TitleScanSchema,
        schemaName: 'title_scan',
        reasoningEffort: 'low',
        usage,
      });
      for (const p of scan.picks.slice(0, 30)) {
        const v = catalog[p.index];
        if (v) get(v).scanRelevance = Math.max(1, Math.min(10, p.relevance));
      }
    } catch (err) {
      this.logger.warn(`Title scan failed: ${errMsg(err)}`);
    }

    // 4) Moment bank: already-analyzed videos with relevant unused moments are free to reuse.
    try {
      const [qv] = await this.ai.embed([this.campaignQueryText(campaign.brief, research)], usage);
      const bank = await this.moments
        .find({ channelId: campaign.channelId, status: 'unused', promptVersion: MINING_VERSION, embedding: { $exists: true } })
        .select('+embedding youtubeId standalone')
        .lean();
      const best = new Map<string, number>();
      for (const m of bank) {
        const s = cosine(qv, m.embedding ?? []) * (0.7 + 0.03 * (m.standalone ?? 5));
        best.set(m.youtubeId, Math.max(best.get(m.youtubeId) ?? 0, s));
      }
      const byId = new Map(catalog.map((v) => [v.youtubeId, v]));
      [...best.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .forEach(([yt, s]) => {
          const v = byId.get(yt);
          if (v && s > 0.3) get(v).bankScore = s;
        });
    } catch (err) {
      this.logger.warn(`Moment-bank lookup skipped: ${errMsg(err)}`);
    }

    // 5) Seeds the user asked for are always considered.
    const byId = new Map(catalog.map((v) => [v.youtubeId, v]));
    for (const yt of campaign.settings.seedVideoIds ?? []) {
      const v = byId.get(yt);
      if (v) get(v).seeded = true;
    }

    const readySet = new Set(
      (await this.sources.find({ youtubeId: { $in: [...cands.keys()] }, stage: 'ready', minedVersion: MINING_VERSION }).select('youtubeId').lean()).map(
        (s) => s.youtubeId,
      ),
    );
    const maxKw = Math.max(1, ...[...cands.values()].map((c) => c.keywordScore));
    const maxHits = Math.max(1, ...[...cands.values()].map((c) => c.speechHits));
    const maxViews = Math.max(1, ...catalog.map((v) => v.viewCount));
    for (const c of cands.values()) {
      c.fromBank = readySet.has(c.youtubeId);
      c.score =
        (c.keywordScore / maxKw) * 3 +
        (Math.log1p(c.speechHits) / Math.log1p(maxHits)) * 3 +
        (c.scanRelevance / 10) * 3 +
        c.bankScore * 3 +
        (Math.log1p(c.viewCount) / Math.log1p(maxViews)) * 1 +
        (c.fromBank ? 0.5 : 0) +
        freshnessBonus(c.publishedAt) +
        (c.seeded ? 100 : 0);
    }
    const pool = [...cands.values()].sort((a, b) => b.score - a.score).slice(0, 36);
    if (!pool.length) throw new Error('No videos in the catalog match this brief. Try a broader brief or add seed videos.');
    await this.orchestrator.log(id, 'info', `Shortlisted ${pool.length} candidate videos from ${catalog.length} in the catalog`);

    // 6) Evidence + final decision by the primary model.
    const evidence = await this.evidence(pool, specific.length ? specific : terms);
    const lines = pool.map((c) =>
      [
        `- youtubeId=${c.youtubeId} | "${c.title}" | ${compactNumber(c.viewCount)} views | ${c.publishedAt ? new Date(c.publishedAt).toISOString().slice(0, 10) : '?'} | ${Math.round(c.durationSec / 60)} min` +
          ` | term hits in speech: ${c.speechHits}${c.fromBank ? ' | already analyzed' : ''}${c.seeded ? ' | REQUESTED BY CLIENT' : ''}`,
        ...(evidence.get(c.youtubeId) ?? []).map((e) => `    · ${e}`),
      ].join('\n'),
    );
    const decision = await this.ai.generateJson({
      task: `source-select:${id}`,
      system: SOURCE_SELECT_SYSTEM,
      user: buildSourceSelectUser({
        brief: campaign.brief,
        angles: research.angles.map((a) => a.angle),
        minVideos,
        maxVideos,
        candidates: lines,
      }),
      schema: SourceSelectSchema,
      schemaName: 'source_selection',
      reasoningEffort: 'medium',
      usage,
    });

    const poolById = new Map(pool.map((c) => [c.youtubeId, c]));
    const chosen: Candidate[] = [];
    const reasons = new Map<string, string>();
    for (const s of decision.selections.sort((a, b) => a.priority - b.priority)) {
      const c = poolById.get(s.youtubeId);
      if (c && !chosen.includes(c)) {
        chosen.push(c);
        reasons.set(c.youtubeId, s.reason);
      }
    }
    for (const c of pool) if (c.seeded && !chosen.includes(c)) chosen.unshift(c);
    for (const c of pool) {
      if (chosen.length >= minVideos) break;
      if (!chosen.includes(c)) chosen.push(c);
    }
    const final = chosen.slice(0, Math.max(maxVideos, chosen.filter((c) => c.seeded).length));
    if (decision.notes) await this.orchestrator.log(id, 'info', `Producer notes: ${decision.notes}`, false);

    return final.map((c) => ({
      youtubeId: c.youtubeId,
      videoId: String(c._id),
      title: c.title,
      viewCount: c.viewCount,
      durationSec: c.durationSec,
      publishedAt: c.publishedAt,
      reason: reasons.get(c.youtubeId) ?? (c.seeded ? 'Requested by client' : 'Strong match for the brief'),
      fromBank: c.fromBank,
      status: 'pending' as const,
    }));
  }

  /** Footage-first lanes: the sources are exactly the videos chosen for the campaign (its seed videos), in order. */
  async fromSeeds(campaign: ReelCampaignDocument): Promise<CampaignSourceRef[]> {
    const catalog = await this.loadCatalog(campaign.channelId);
    const byId = new Map(catalog.map((v) => [v.youtubeId, v]));
    const chosen = (campaign.settings.seedVideoIds ?? []).map((yt) => byId.get(yt)).filter((v): v is CatalogItem => !!v);
    if (!chosen.length) throw new Error('None of the chosen videos is available');
    const ready = new Set((await this.sources.find({ youtubeId: { $in: chosen.map((c) => c.youtubeId) }, stage: 'ready', minedVersion: MINING_VERSION }).select('youtubeId').lean()).map((s) => s.youtubeId));
    return chosen.map((c) => ({
      youtubeId: c.youtubeId,
      videoId: String(c._id),
      title: c.title,
      viewCount: c.viewCount,
      durationSec: c.durationSec,
      publishedAt: c.publishedAt,
      reason: 'Chosen for this lane',
      fromBank: ready.has(c.youtubeId),
      status: 'pending' as const,
    }));
  }

  campaignQueryText(brief: string, research: ResearchResult): string {
    return [
      brief,
      research.topicSummary,
      research.primaryEntities.map((e) => [e.name, ...e.aliases].join(' / ')).join('; '),
      research.angles.map((a) => a.angle).join('; '),
    ].join('\n');
  }

  private searchTerms(research: ResearchResult): string[] {
    const raw = [
      ...research.primaryEntities.flatMap((e) => [e.name, ...e.aliases]),
      ...research.catalogKeywords,
    ];
    return [...new Set(raw.map((t) => t.toLowerCase().trim()).filter((t) => t.length >= 3))].slice(0, 40);
  }

  private async loadCatalog(channelId: Types.ObjectId): Promise<CatalogItem[]> {
    const docs = await this.videos
      .find({ channelId, privacyStatus: 'public', deletedAt: null })
      .select('youtubeId title tags description viewCount publishedAt duration durationSeconds liveBroadcastContent')
      .lean();
    return docs
      .map((d) => ({
        _id: d._id as Types.ObjectId,
        youtubeId: d.youtubeId,
        title: d.title ?? '',
        tags: d.tags ?? [],
        description: (d.description ?? '').slice(0, 600),
        viewCount: d.viewCount ?? 0,
        publishedAt: d.publishedAt,
        durationSec: d.durationSeconds || parseIsoDuration(d.duration),
        live: d.liveBroadcastContent,
      }))
      .filter((d) => d.youtubeId && d.durationSec > 240 && d.live !== 'live' && d.live !== 'upcoming')
      .map(({ live: _live, ...rest }) => rest);
  }

  /** Up to 3 short spoken excerpts per candidate where the key terms occur (from existing YouTube transcripts). */
  private async evidence(pool: Candidate[], terms: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (!terms.length) return out;
    const rx = new RegExp(terms.slice(0, 14).map(escapeRegex).join('|'), 'i');
    const docs = await this.videos
      .find({ youtubeId: { $in: pool.map((p) => p.youtubeId) } })
      .select('youtubeId transcriptSegments')
      .lean();
    for (const d of docs) {
      const segs = d.transcriptSegments ?? [];
      const picks: string[] = [];
      for (let i = 0; i < segs.length && picks.length < 3; i++) {
        if (!rx.test(segs[i].text)) continue;
        const text = segs
          .slice(Math.max(0, i - 1), i + 3)
          .map((s) => s.text)
          .join(' ');
        picks.push(`[${fmtTime(segs[i].startSeconds)}] "${truncate(text, 220)}"`);
        i += 6;
      }
      if (picks.length) out.set(d.youtubeId, picks);
    }
    return out;
  }
}
