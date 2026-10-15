import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppConfig, CONFIG } from '../config/config';
import { AiService, UsageSink } from '../ai/ai.service';
import { errMsg, FatalJobError } from '../common/errors';
import { compactNumber, cosine, overlapSec, truncate } from '../common/text';
import { ReelCampaign, ReelCampaignDocument } from '../db/schemas/reel-campaign.schema';
import { Reel, ReelDocument, ReelScores } from '../db/schemas/reel.schema';
import { ReelMoment, ReelMomentDocument } from '../db/schemas/reel-moment.schema';
import { ReelTranscript, ReelTranscriptDocument } from '../db/schemas/reel-transcript.schema';
import { MINING_VERSION } from '../prompts/mining.prompt';
import type { ResearchResult } from '../prompts/research.prompt';
import {
  buildDirectorUser,
  buildRevisionUser,
  DIRECTOR_SYSTEM,
  DirectorSchema,
  ReelPlan,
  REVISION_SYSTEM,
  RevisionSchema,
} from '../prompts/director.prompt';
import { buildCriticUser, CRITIC_SYSTEM, CriticReview, CriticSchema, overallScore, passesBar } from '../prompts/critic.prompt';
import { buildPackagingUser, PACKAGING_SYSTEM, PackagingResult, PackagingSchema } from '../prompts/packaging.prompt';
import { OrchestratorService } from '../queue/orchestrator.service';
import { QueueService } from '../queue/queue.service';
import { assemble, Assembled, AssembleRules, Material } from './assembly';
import { EntityService } from './entity.service';
import { formatLine } from './transcript';

interface Candidate {
  ref: string;
  plan: ReelPlan;
  asm: Assembled;
  review?: CriticReview;
  overall?: number;
  revised: boolean;
  lastErrors: string[];
  embedding?: number[];
}

type UsedRanges = Map<string, Array<[number, number]>>;

const MIN_KEEP = 70;

@Injectable()
export class ComposerService {
  private readonly logger = new Logger(ComposerService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @InjectModel(ReelCampaign.name) private readonly campaigns: Model<ReelCampaignDocument>,
    @InjectModel(Reel.name) private readonly reels: Model<ReelDocument>,
    @InjectModel(ReelMoment.name) private readonly moments: Model<ReelMomentDocument>,
    @InjectModel(ReelTranscript.name) private readonly transcripts: Model<ReelTranscriptDocument>,
    private readonly ai: AiService,
    private readonly orchestrator: OrchestratorService,
    private readonly entities: EntityService,
    private readonly queues: QueueService,
  ) {}

  /** Returns the number of reels queued for rendering. Idempotent: re-running after a crash only re-queues renders. */
  async compose(campaignId: string): Promise<number> {
    const campaign = await this.campaigns.findById(campaignId);
    if (!campaign) throw new Error('Campaign not found');

    const existing = await this.reels.find({ campaignId: campaign._id }).select('_id status').lean();
    if (existing.length) {
      await this.orchestrator.transition(campaignId, ['composing'], 'rendering', `Rendering ${existing.length} reels`);
      for (const r of existing) if (r.status === 'queued' || r.status === 'rendering') await this.queues.render(String(r._id));
      return existing.length;
    }

    const usage = this.orchestrator.usageSink(campaignId);
    const s = campaign.settings;
    const rules: AssembleRules = { minSec: s.minSec, maxSec: s.maxSec, allowCrossVideo: s.allowCrossVideo };
    const research = (campaign.research ?? {}) as ResearchResult;
    this.assertBudget(campaign);

    // ---------- 1. Material: transcripts of the ready source videos ----------
    const readyRefs = campaign.sources.filter((x) => x.status === 'ready');
    const materials = new Map<string, Material>();
    const keyByYt = new Map<string, string>();
    for (const ref of readyRefs) {
      const t = await this.transcripts.findOne({ youtubeId: ref.youtubeId }).lean();
      if (!t?.lines?.length) continue;
      const key = `V${materials.size + 1}`;
      materials.set(key, {
        key,
        youtubeId: ref.youtubeId,
        videoId: ref.videoId,
        title: ref.title,
        viewCount: ref.viewCount,
        publishedAt: ref.publishedAt,
        durationSec: t.durationSec || ref.durationSec,
        lines: t.lines,
        words: t.words,
      });
      keyByYt.set(ref.youtubeId, key);
    }
    if (!materials.size) throw new FatalJobError('No analyzed source material available');

    // ---------- 2. Moments: relevant, unused, not overlapping earlier reels ----------
    const used = await this.usedRanges(campaign.channelId);
    const cooldownMs = this.cfg.REEL_RANGE_COOLDOWN_DAYS * 86_400_000;
    const all = await this.moments
      .find({ youtubeId: { $in: [...keyByYt.keys()] }, promptVersion: MINING_VERSION, status: { $ne: 'retired' } })
      .select('+embedding')
      .lean();
    const fresh = all.filter((m) => {
      if (m.status === 'used' && m.lastUsedAt && Date.now() - new Date(m.lastUsedAt).getTime() < cooldownMs) return false;
      const ranges = used.get(m.youtubeId) ?? [];
      const ov = ranges.reduce((n, [a, b]) => n + overlapSec(m.start, m.end, a, b), 0);
      return ov / Math.max(1, m.end - m.start) <= 0.5;
    });
    if (!fresh.length) throw new FatalJobError('Every strong moment in these videos was already used in earlier reels.');

    let qv: number[] = [];
    try {
      [qv] = await this.ai.embed([this.queryText(campaign.brief, research)], usage);
    } catch (err) {
      this.logger.warn(`Campaign embedding failed: ${errMsg(err)}`);
    }
    const scored = fresh
      .map((m) => ({ m, score: (qv.length && m.embedding?.length ? cosine(qv, m.embedding) * 10 : 3) * 0.55 + m.standalone * 0.3 + m.intensity * 0.15 }))
      .sort((a, b) => b.score - a.score);
    const k = Math.min(40, Math.max(18, s.targetReels * 5));
    const picked: typeof scored = [];
    const perVideo = new Map<string, number>();
    for (const x of scored) if ((perVideo.get(x.m.youtubeId) ?? 0) < 2) (picked.push(x), perVideo.set(x.m.youtubeId, (perVideo.get(x.m.youtubeId) ?? 0) + 1));
    for (const x of scored) if (picked.length < k && !picked.includes(x)) picked.push(x);
    const momentRefs = new Map<string, (typeof fresh)[number]>();
    picked.forEach((x, i) => momentRefs.set(`M${i + 1}`, x.m));
    await this.orchestrator.log(campaignId, 'info', `Director is reviewing ${momentRefs.size} moments from ${materials.size} videos`);

    const material = this.materialText(materials, momentRefs, keyByYt, used);
    const doNotRepeat = await this.doNotRepeat(campaign.channelId);
    const researchText = this.researchText(research);

    // ---------- 3. Director ----------
    const requestCount = Math.min(s.targetReels + 4, Math.ceil(s.targetReels * 1.6));
    const directed = await this.ai.generateJson({
      task: `director:${campaignId}`,
      system: DIRECTOR_SYSTEM,
      user: buildDirectorUser({
        brief: campaign.brief,
        targetReels: s.targetReels,
        minSec: s.minSec,
        maxSec: s.maxSec,
        allowCrossVideo: s.allowCrossVideo,
        research: researchText,
        doNotRepeat,
        material,
        requestCount,
      }),
      schema: DirectorSchema,
      schemaName: 'reel_plans',
      usage,
    });
    if (directed.materialNotes) await this.orchestrator.log(campaignId, 'info', `Director: ${directed.materialNotes}`, false);

    const cands: Candidate[] = directed.reels.map((plan, i) => {
      const asm = assemble(plan.clips, materials, rules);
      return { ref: `R${i + 1}`, plan, asm, revised: false, lastErrors: asm.errors };
    });
    await this.orchestrator.log(
      campaignId,
      'info',
      `Director proposed ${cands.length} reels (${cands.filter((c) => c.asm.ok).length} passed structural checks); critic reviewing`,
    );

    // ---------- 4. Critic ----------
    await this.critique(campaign, cands.filter((c) => c.asm.ok), usage);

    // ---------- 5. One revision round for fixable reels ----------
    const toRevise = cands.filter((c) => !c.asm.ok || c.review?.verdict === 'revise' || (c.review && c.review.verdict === 'keep' && !passesBar(c.review, MIN_KEEP)));
    if (toRevise.length) {
      await this.orchestrator.log(campaignId, 'info', `Revising ${toRevise.length} reels`);
      try {
        const revised = await this.ai.generateJson({
          task: `revise:${campaignId}`,
          system: REVISION_SYSTEM,
          user: buildRevisionUser({
            header: [
              `Campaign brief: "${campaign.brief}"`,
              `Duration per reel: ${s.minSec}-${s.maxSec} s. Cross-video allowed: ${s.allowCrossVideo ? 'yes' : 'no'}.`,
            ].join('\n'),
            items: toRevise.map((c) => this.revisionItem(c)),
            material,
          }),
          schema: RevisionSchema,
          schemaName: 'reel_revisions',
          usage,
        });
        const changed: Candidate[] = [];
        for (const r of revised.reels) {
          const c = toRevise.find((x) => x.ref === r.ref);
          if (!c) continue;
          const { ref: _ref, ...plan } = r;
          c.plan = plan;
          c.asm = assemble(plan.clips, materials, rules);
          c.review = undefined;
          c.overall = undefined;
          c.revised = true;
          c.lastErrors = c.asm.errors;
          if (c.asm.ok) changed.push(c);
        }
        await this.critique(campaign, changed, usage);
      } catch (err) {
        await this.orchestrator.log(campaignId, 'warn', `Revision round failed, keeping first-pass results: ${errMsg(err)}`);
      }
    }

    // ---------- 6. Quality bar, diversity, ledger, semantic dedupe ----------
    const finals = await this.selectFinals(campaign, cands, used, keyByYt, usage);
    await this.campaigns.updateOne(
      { _id: campaign._id },
      { $set: { 'stats.candidates': cands.length, 'stats.kept': finals.length, 'stats.dropped': cands.length - finals.length } },
    );
    if (!finals.length) {
      const issues = cands
        .flatMap((c) => c.review?.issues ?? c.lastErrors)
        .slice(0, 6)
        .join(' | ');
      throw new FatalJobError(`No reel cleared the quality bar. Main issues: ${issues || 'weak material for this brief'}`);
    }

    // ---------- 7. Packaging ----------
    const packs = await this.package(campaign, research, finals, usage);

    // ---------- 8. Persist + queue renders ----------
    let index = 0;
    for (const c of finals) {
      index++;
      const pack = packs.get(c.ref);
      const ents = await this.entities.resolve(campaign.channelId, pack?.entities ?? []);
      const momentIds = c.plan.momentIds.map((id) => momentRefs.get(id)?._id).filter(Boolean) as Types.ObjectId[];
      const main = [...c.asm.clips].sort((a, b) => b.end - b.start - (a.end - a.start))[0];
      const link = `https://youtu.be/${main.material.youtubeId}?t=${Math.floor(main.start)}`;
      const scores: ReelScores = {
        hook: c.review!.hook,
        clarity: c.review!.clarity,
        flow: c.review!.flow,
        payoff: c.review!.payoff,
        ending: c.review!.ending,
        retention: c.review!.retention,
        safety: c.review!.safety,
        overall: c.overall ?? overallScore(c.review!),
      };
      const reel = await this.reels.create({
        campaignId: campaign._id,
        channelId: campaign.channelId,
        index,
        status: 'queued',
        shape: c.plan.shape,
        concept: c.plan.concept,
        angle: c.plan.angle,
        hookText: c.plan.hookText,
        payoffText: c.plan.payoffText,
        whyItWorks: c.plan.whyItWillPerform,
        clips: c.asm.clips.map((x) => ({
          youtubeId: x.material.youtubeId,
          videoId: x.material.videoId,
          sourceTitle: x.material.title,
          role: x.role,
          startLine: x.startLine,
          endLine: x.endLine,
          start: x.start,
          end: x.end,
          text: x.text,
        })),
        durationSec: c.asm.duration,
        words: c.asm.words,
        scores,
        critique: { verdict: c.review!.verdict, issues: c.review!.issues, revised: c.revised },
        packaging: {
          headline: pack?.headline || truncate(c.plan.concept, 34),
          title: pack?.title || truncate(c.plan.concept, 70),
          altTitles: pack?.altTitles ?? [],
          description: `${(pack?.description || c.plan.concept).trim()}\n\nFull breakdown: ${link}`,
          tags: normaliseTags(pack?.tags ?? []),
          hashtags: normaliseHashtags(pack?.hashtags ?? []),
          pinnedComment: pack?.pinnedComment ?? '',
          summary: pack?.summary ?? c.plan.concept,
        },
        entitySlugs: ents.map((e) => e.slug),
        entityNames: ents.map((e) => e.name),
        themes: (pack?.themes ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean).slice(0, 3),
        momentIds,
        embedding: c.embedding,
        templateName: s.templateName,
      });
      if (momentIds.length) {
        await this.moments.updateMany(
          { _id: { $in: momentIds } },
          { $set: { status: 'used', lastUsedAt: new Date() }, $addToSet: { usedByReelIds: reel._id } },
        );
      }
    }

    const moved = await this.orchestrator.transition(campaignId, ['composing'], 'rendering', `Rendering ${finals.length} reels`);
    if (moved) {
      const queued = await this.reels.find({ campaignId: campaign._id, status: 'queued' }).select('_id').lean();
      for (const r of queued) await this.queues.render(String(r._id));
    }
    return finals.length;
  }

  // ------------------------------------------------------------------ helpers

  private assertBudget(c: ReelCampaignDocument) {
    const spent = (c.usage?.promptTokens ?? 0) + (c.usage?.completionTokens ?? 0);
    if (spent > this.cfg.REEL_TOKEN_BUDGET) throw new FatalJobError(`Token budget exceeded (${spent.toLocaleString()} tokens)`);
  }

  private async critique(campaign: ReelCampaignDocument, cands: Candidate[], usage: UsageSink) {
    if (!cands.length) return;
    const blocks = cands.map((c) =>
      [
        `## ${c.ref} · ${c.plan.shape} · ${c.asm.duration.toFixed(1)}s · videos: ${c.asm.videoKeys.join(' + ')}`,
        `Concept: ${c.plan.concept}`,
        c.asm.warnings.length ? `Automatic checks: ${c.asm.warnings.join('; ')}` : '',
        'VIEWER HEARS:',
        c.asm.script,
        '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
    const res = await this.ai.generateJson({
      task: `critic:${campaign._id}`,
      system: CRITIC_SYSTEM,
      user: buildCriticUser(campaign.brief, blocks),
      schema: CriticSchema,
      schemaName: 'reel_reviews',
      usage,
    });
    for (const r of res.reviews) {
      const c = cands.find((x) => x.ref === r.ref);
      if (!c) continue;
      c.review = r;
      c.overall = overallScore(r);
    }
  }

  private revisionItem(c: Candidate): string {
    const clips = c.plan.clips.map((x) => `${x.video} L${x.startLine}–L${x.endLine} (${x.role})`).join(', ');
    const problems = [...c.lastErrors, ...(c.review?.issues ?? []), ...c.asm.warnings];
    return [
      `## ${c.ref} (current: ${c.plan.shape}, ${c.asm.duration.toFixed(1)}s)`,
      `Concept: ${c.plan.concept}`,
      `Current clips: ${clips}`,
      c.review ? `Reviewer scores: hook ${c.review.hook}, clarity ${c.review.clarity}, flow ${c.review.flow}, payoff ${c.review.payoff}, ending ${c.review.ending}, retention ${c.review.retention}, safety ${c.review.safety}` : '',
      problems.length ? `Problems: ${problems.join(' | ')}` : '',
      c.review?.revision ? `Reviewer fix: ${c.review.revision}` : '',
      c.asm.ok ? `Current cut:\n${c.asm.script}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private async selectFinals(
    campaign: ReelCampaignDocument,
    cands: Candidate[],
    used: UsedRanges,
    keyByYt: Map<string, string>,
    usage: UsageSink,
  ): Promise<Candidate[]> {
    const id = String(campaign._id);
    const target = campaign.settings.targetReels;
    const reviewed = cands.filter((c) => c.asm.ok && c.review && c.review.verdict !== 'drop');
    let pool = reviewed.filter((c) => passesBar(c.review!, MIN_KEEP));
    if (pool.length < Math.min(2, target)) {
      // Borderline tier — only to avoid an empty campaign, never below a solid floor.
      const borderline = reviewed.filter(
        (c) => !pool.includes(c) && (c.overall ?? 0) >= 64 && c.review!.safety >= 7 && Math.min(c.review!.hook, c.review!.clarity, c.review!.flow, c.review!.payoff, c.review!.ending) >= 5,
      );
      pool = [...pool, ...borderline.sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0)).slice(0, Math.min(2, target) - pool.length)];
    }
    pool.sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));

    // Semantic memory of earlier reels (same story told in another episode).
    let library: Array<{ embedding: number[]; headline: string }> = [];
    try {
      const vecs = await this.ai.embed(pool.map((c) => this.reelText(c)), usage);
      pool.forEach((c, i) => (c.embedding = vecs[i]));
      const since = new Date(Date.now() - 365 * 86_400_000);
      const prior = await this.reels
        .find({ channelId: campaign.channelId, status: { $in: ['queued', 'rendering', 'todo', 'posted'] }, createdAt: { $gte: since } })
        .select('+embedding packaging.headline concept')
        .lean();
      library = prior.filter((r) => r.embedding?.length).map((r) => ({ embedding: r.embedding!, headline: r.packaging?.headline ?? r.concept }));
    } catch (err) {
      this.logger.warn(`Semantic dedupe skipped: ${errMsg(err)}`);
    }

    const maxPerVideo = Math.max(2, Math.ceil(target / Math.max(1, keyByYt.size)) + 1);
    const finals: Candidate[] = [];
    const perVideo = new Map<string, number>();
    for (const c of pool) {
      if (finals.length >= target) break;
      const mainYt = c.asm.clips[0].material.youtubeId;
      if ((perVideo.get(mainYt) ?? 0) >= maxPerVideo) continue;

      const ledgerOverlap = c.asm.clips.reduce(
        (n, x) => n + (used.get(x.material.youtubeId) ?? []).reduce((m, [a, b]) => m + overlapSec(x.start, x.end, a, b), 0),
        0,
      );
      if (ledgerOverlap / c.asm.duration > 0.4) {
        await this.orchestrator.log(id, 'info', `Skipped ${c.ref}: reuses footage from an earlier reel`, false);
        continue;
      }
      const clash = finals.find((f) =>
        f.asm.clips.some((fc) =>
          c.asm.clips.some(
            (cc) =>
              fc.material.youtubeId === cc.material.youtubeId &&
              overlapSec(fc.start, fc.end, cc.start, cc.end) / Math.min(fc.end - fc.start, cc.end - cc.start) > 0.25,
          ),
        ),
      );
      if (clash) continue;
      if (c.embedding?.length) {
        const dupe = library.find((l) => cosine(l.embedding, c.embedding!) >= 0.9);
        if (dupe) {
          await this.orchestrator.log(id, 'info', `Skipped ${c.ref}: too similar to existing reel "${dupe.headline}"`, false);
          continue;
        }
        if (finals.some((f) => f.embedding && cosine(f.embedding, c.embedding!) >= 0.92)) continue;
      }
      finals.push(c);
      perVideo.set(mainYt, (perVideo.get(mainYt) ?? 0) + 1);
    }
    return finals;
  }

  private async package(campaign: ReelCampaignDocument, research: ResearchResult, finals: Candidate[], usage: UsageSink) {
    const past = await this.reels
      .find({ channelId: campaign.channelId, status: { $in: ['todo', 'posted'] } })
      .sort({ createdAt: -1 })
      .limit(40)
      .select('packaging.title packaging.headline')
      .lean();
    const blocks = finals.map((c) =>
      [
        `## ${c.ref} · ${c.asm.duration.toFixed(0)}s · from: ${[...new Set(c.asm.clips.map((x) => `"${x.material.title}"`))].join(' + ')}`,
        `Concept: ${c.plan.concept}`,
        `Angle: ${c.plan.angle}`,
        'Full spoken text:',
        c.asm.clips.map((x) => x.text).join(' … '),
        '',
      ].join('\n'),
    );
    const out = new Map<string, PackagingResult>();
    try {
      const res = await this.ai.generateJson({
        task: `packaging:${campaign._id}`,
        system: PACKAGING_SYSTEM,
        user: buildPackagingUser({
          brief: campaign.brief,
          hookPatterns: research.hookPatterns ?? [],
          keywords: (research.catalogKeywords ?? []).slice(0, 20),
          pastTitles: past.flatMap((p) => [p.packaging?.title, p.packaging?.headline].filter(Boolean) as string[]).slice(0, 60),
          reels: blocks,
        }),
        schema: PackagingSchema,
        schemaName: 'reel_packaging',
        reasoningEffort: 'medium',
        usage,
      });
      for (const p of res.reels) out.set(p.ref, p);
    } catch (err) {
      await this.orchestrator.log(String(campaign._id), 'warn', `Packaging failed, using fallbacks: ${errMsg(err)}`);
    }
    return out;
  }

  /** Time ranges already used by this channel's reels within the cooldown window (ledger). */
  private async usedRanges(channelId: Types.ObjectId): Promise<UsedRanges> {
    const since = new Date(Date.now() - this.cfg.REEL_RANGE_COOLDOWN_DAYS * 86_400_000);
    const prior = await this.reels
      .find({ channelId, status: { $in: ['queued', 'rendering', 'todo', 'posted'] }, createdAt: { $gte: since } })
      .select('clips.youtubeId clips.start clips.end')
      .lean();
    const map: UsedRanges = new Map();
    for (const r of prior) for (const c of r.clips) map.set(c.youtubeId, [...(map.get(c.youtubeId) ?? []), [c.start, c.end]]);
    return map;
  }

  private async doNotRepeat(channelId: Types.ObjectId): Promise<string[]> {
    const prior = await this.reels
      .find({ channelId, status: { $in: ['queued', 'rendering', 'todo', 'posted'] } })
      .sort({ createdAt: -1 })
      .limit(40)
      .select('packaging.headline concept hookText')
      .lean();
    return prior.map((r) => `"${r.packaging?.headline || r.concept}" — hook: "${truncate(r.hookText ?? '', 120)}"`);
  }

  private researchText(r: ResearchResult): string {
    if (!r?.topicSummary) return '(no research available)';
    return [
      `Topic: ${r.topicSummary}`,
      r.angles?.length ? `Angles:\n${r.angles.map((a) => `- ${a.angle} — ${a.whyItWorks}`).join('\n')}` : '',
      r.hookPatterns?.length ? `Hook patterns:\n${r.hookPatterns.map((h) => `- ${h}`).join('\n')}` : '',
      r.audienceQuestions?.length ? `Audience questions:\n${r.audienceQuestions.map((q) => `- ${q}`).join('\n')}` : '',
      r.externalExamples?.length
        ? `What performs elsewhere:\n${r.externalExamples.map((e) => `- "${e.title}" (${e.platform}${e.views ? `, ${e.views}` : ''}): ${e.whatWorked}`).join('\n')}`
        : '',
      r.avoid?.length ? `Avoid:\n${r.avoid.map((a) => `- ${a}`).join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private queryText(brief: string, r: ResearchResult): string {
    return [brief, r?.topicSummary ?? '', (r?.angles ?? []).map((a) => a.angle).join('; '), (r?.primaryEntities ?? []).map((e) => e.name).join(', ')].join('\n');
  }

  private reelText(c: Candidate): string {
    return [c.plan.concept, c.plan.hookText, c.plan.payoffText, c.asm.clips.map((x) => x.text).join(' ').slice(0, 2000)].join('\n');
  }

  /** Per video: mined moments + merged transcript windows around them, plus already-used ranges as line ids. */
  private materialText(
    materials: Map<string, Material>,
    momentRefs: Map<string, { youtubeId: string; startLine: number; endLine: number; type: string; standalone: number; intensity: number; title: string; summary: string; hookLines: number[]; payoffLine: number; contextNeeded?: string | null }>,
    keyByYt: Map<string, string>,
    used: UsedRanges,
  ): string {
    const out: string[] = [];
    for (const [key, m] of materials) {
      const mine = [...momentRefs.entries()].filter(([, mo]) => keyByYt.get(mo.youtubeId) === key);
      if (!mine.length) continue;
      const date = m.publishedAt ? new Date(m.publishedAt).toISOString().slice(0, 10) : '?';
      out.push(`## ${key} — "${m.title}" (${date} · ${compactNumber(m.viewCount)} views · ${Math.round(m.durationSec / 60)} min)`);

      const usedLines = (used.get(m.youtubeId) ?? [])
        .map(([a, b]) => {
          const s = m.lines.findIndex((l) => l.e > a);
          let e = s;
          while (e + 1 < m.lines.length && m.lines[e + 1].s < b) e++;
          return s >= 0 ? `L${pad(s)}–L${pad(e)}` : '';
        })
        .filter(Boolean);
      if (usedLines.length) out.push(`ALREADY USED (avoid): ${usedLines.join(', ')}`);

      out.push('Mined moments:');
      for (const [mid, mo] of mine) {
        out.push(
          `- ${mid} [${mo.type} · standalone ${mo.standalone}/10 · intensity ${mo.intensity}/10] L${pad(mo.startLine)}–L${pad(mo.endLine)} "${mo.title}": ${mo.summary}` +
            ` | hooks: ${mo.hookLines.map((h) => `L${pad(h)}`).join(', ') || '—'} | payoff: L${pad(mo.payoffLine)}` +
            (mo.contextNeeded ? ` | context needed: ${mo.contextNeeded}` : ''),
        );
      }

      const windows = mine
        .map(([, mo]) => [Math.max(0, mo.startLine - 4), Math.min(m.lines.length - 1, mo.endLine + 3)] as [number, number])
        .sort((a, b) => a[0] - b[0]);
      const merged: Array<[number, number]> = [];
      for (const w of windows) {
        const last = merged[merged.length - 1];
        if (last && w[0] <= last[1] + 3) last[1] = Math.max(last[1], w[1]);
        else merged.push([...w]);
      }
      out.push('Transcript excerpts:');
      merged.forEach(([a, b], i) => {
        if (i > 0) out.push('…');
        for (let li = a; li <= b; li++) out.push(formatLine(li, m.lines[li]));
      });
      out.push('');
    }
    return out.join('\n');
  }
}

function pad(n: number) {
  return String(n).padStart(4, '0');
}

function normaliseTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.toLowerCase().replace(/[#"]/g, '').trim()).filter((t) => t && t.length <= 60))].slice(0, 25);
}

function normaliseHashtags(tags: string[]): string[] {
  const out = tags
    .map((t) => '#' + t.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, ''))
    .filter((t) => t.length > 1);
  if (!out.some((t) => t.toLowerCase() === '#shorts')) out.push('#shorts');
  return [...new Set(out)].slice(0, 5);
}
