import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppConfig, CONFIG } from '../config/config';
import { AiService, UsageSink } from '../ai/ai.service';
import { CancelledError, errMsg, FatalJobError } from '../common/errors';
import { compactNumber, cosine, overlapSec, truncate } from '../common/text';
import { CandidateLedgerEntry, ReelCampaign, ReelCampaignDocument } from '../db/schemas/reel-campaign.schema';
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
  round: number;
  plan: ReelPlan;
  momentIds: Types.ObjectId[];
  outcome?: { status: 'kept' | 'spare' | 'dropped'; reason: string };
  asm: Assembled;
  review?: CriticReview;
  overall?: number;
  revised: boolean;
  lastErrors: string[];
  embedding?: number[];
}

type UsedRanges = Map<string, Array<[number, number]>>;

const MIN_KEEP = 70;
const MAX_ROUNDS = 3;

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

  /**
   * Builds the reels for a campaign, in ROUNDS. Each round shows the director a fresh batch of moments it has not
   * seen yet, has the critic review them (with one revision pass), and keeps what clears the quality bar. It keeps
   * going until the requested number is reached or the material is exhausted — never padding with weak reels.
   * Idempotent: after a crash, existing reels are just re-queued for rendering.
   */
  async compose(campaignId: string, opts: { topUp?: boolean } = {}): Promise<number> {
    const topUp = !!opts.topUp;
    const campaign = await this.campaigns.findById(campaignId);
    if (!campaign) throw new Error('Campaign not found');

    if (!topUp) {
      const existing = await this.reels.find({ campaignId: campaign._id }).select('_id status').lean();
      if (existing.length) {
        await this.orchestrator.transition(campaignId, ['composing'], 'rendering', `Rendering ${existing.length} reels`);
        for (const r of existing) if (r.status === 'queued' || r.status === 'rendering') await this.queues.render(String(r._id));
        return existing.length;
      }
    }

    const usage = this.orchestrator.usageSink(campaignId);
    const s = campaign.settings;
    const rules: AssembleRules = { minSec: s.minSec, maxSec: s.maxSec, allowCrossVideo: s.allowCrossVideo };
    const research = (campaign.research ?? {}) as ResearchResult;
    this.assertBudget(campaign);

    const existingCount = topUp ? await this.reels.countDocuments({ campaignId: campaign._id, status: { $in: ['queued', 'rendering', 'todo', 'posted'] } }) : 0;
    const need = s.targetReels - existingCount;
    if (need <= 0) throw new FatalJobError('This campaign already has the requested number of reels.');
    const baseIndex = topUp ? ((await this.reels.find({ campaignId: campaign._id }).sort({ index: -1 }).limit(1).select('index').lean())[0]?.index ?? 0) : 0;

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

    // ---------- 2. Every usable moment, ranked by relevance to the brief ----------
    const used = await this.usedRanges(campaign.channelId);
    const cooldownMs = this.cfg.REEL_RANGE_COOLDOWN_DAYS * 86_400_000;
    const all = await this.moments
      .find({ youtubeId: { $in: [...keyByYt.keys()] }, promptVersion: MINING_VERSION, status: { $ne: 'retired' } })
      .select('+embedding')
      .lean();
    const usable = all.filter((m) => !(m.status === 'used' && m.lastUsedAt && Date.now() - new Date(m.lastUsedAt).getTime() < cooldownMs));
    if (!usable.length) throw new FatalJobError('Every strong moment in these videos was already used in earlier reels.');

    let qv: number[] = [];
    try {
      [qv] = await this.ai.embed([this.queryText(campaign.brief, research)], usage);
    } catch (err) {
      this.logger.warn(`Campaign embedding failed: ${errMsg(err)}`);
    }
    const scored = usable
      .map((m) => ({ m, score: (qv.length && m.embedding?.length ? cosine(qv, m.embedding) * 10 : 3) * 0.55 + m.standalone * 0.3 + m.intensity * 0.15 }))
      .sort((a, b) => b.score - a.score);

    const doNotRepeatBase = await this.doNotRepeat(campaign.channelId);
    const researchText = this.researchText(research);
    const finals: Candidate[] = [];
    const allCands: Candidate[] = [];
    const shown = new Set<string>();
    let refCounter = 0;
    let rounds = 0;

    // ---------- 3. Rounds ----------
    while (rounds < MAX_ROUNDS && finals.length < need) {
      rounds++;
      const live = await this.campaigns.findById(campaignId).select('usage cancelRequested status').lean();
      if (!live || live.cancelRequested || live.status === 'cancelled') throw new CancelledError();
      this.assertBudget(live);

      const remaining = need - finals.length;
      const pool = scored.filter((x) => !shown.has(String(x.m._id)) && this.freeOfUsed(x.m, used));
      if (pool.length < 3) {
        await this.orchestrator.log(campaignId, 'info', `Round ${rounds}: no unseen moments left to review`, false);
        break;
      }
      const k = Math.min(rounds === 1 ? 60 : 45, Math.max(20, remaining * 6));
      const picked = this.pickDiverse(pool, k, rounds === 1 ? 2 : 4);
      picked.forEach((x) => shown.add(String(x.m._id)));
      const momentRefs = new Map<string, (typeof usable)[number]>();
      picked.forEach((x, i) => momentRefs.set(`M${i + 1}`, x.m));
      await this.orchestrator.log(
        campaignId,
        'info',
        `Round ${rounds}: director is reviewing ${picked.length} moments (${shown.size} of ${scored.length} seen so far) — need ${remaining} more reel${remaining === 1 ? '' : 's'}`,
      );

      // ---- director (two parallel batches when there is a lot to choose from) ----
      const requestCount = Math.min(remaining + 4, Math.ceil(remaining * 1.6));
      const groups = this.splitGroups(picked, requestCount);
      const doNotRepeat = [...doNotRepeatBase, ...finals.map((f) => `"${f.plan.concept}" — hook: "${truncate(f.plan.hookText, 120)}"`)];
      const directed = await Promise.all(
        groups.map((g, gi) => {
          const groupRefs = new Map([...momentRefs].filter(([, m]) => g.some((x) => x.m === m)));
          return this.ai.generateJson({
            task: `director:${campaignId}:r${rounds}g${gi + 1}`,
            system: DIRECTOR_SYSTEM,
            user: buildDirectorUser({
              brief: campaign.brief,
              targetReels: remaining,
              minSec: s.minSec,
              maxSec: s.maxSec,
              allowCrossVideo: s.allowCrossVideo,
              research: researchText,
              doNotRepeat,
              material: this.materialText(materials, groupRefs, keyByYt, used),
              requestCount: Math.max(2, Math.round((requestCount * g.length) / picked.length)),
            }),
            schema: DirectorSchema,
            schemaName: 'reel_plans',
            usage,
          });
        }),
      );

      const cands: Candidate[] = [];
      for (const d of directed) {
        if (d.materialNotes) await this.orchestrator.log(campaignId, 'info', `Director: ${d.materialNotes}`, false);
        for (const plan of d.reels) {
          const asm = assemble(plan.clips, materials, rules);
          const momentIds = plan.momentIds.map((id) => momentRefs.get(id)?._id).filter(Boolean) as Types.ObjectId[];
          cands.push({ ref: `R${++refCounter}`, round: rounds, plan, asm, momentIds, revised: false, lastErrors: asm.errors });
        }
      }
      await this.orchestrator.log(
        campaignId,
        'info',
        `Round ${rounds}: director proposed ${cands.length} reels (${cands.filter((c) => c.asm.ok).length} passed structural checks); critic reviewing`,
      );

      // ---- critic, then one revision pass for fixable ideas ----
      await this.critique(campaign, cands.filter((c) => c.asm.ok), usage);
      const material = this.materialText(materials, momentRefs, keyByYt, used);
      const toRevise = cands.filter((c) => !c.asm.ok || c.review?.verdict === 'revise' || (c.review && c.review.verdict === 'keep' && !passesBar(c.review, MIN_KEEP)));
      if (toRevise.length) {
        await this.orchestrator.log(campaignId, 'info', `Round ${rounds}: revising ${toRevise.length} reels`);
        try {
          const revised = await this.ai.generateJson({
            task: `revise:${campaignId}:r${rounds}`,
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
            c.momentIds = plan.momentIds.map((id) => momentRefs.get(id)?._id).filter(Boolean) as Types.ObjectId[];
            c.review = undefined;
            c.overall = undefined;
            c.revised = true;
            c.lastErrors = c.asm.errors;
            if (c.asm.ok) changed.push(c);
          }
          await this.critique(campaign, changed, usage);
        } catch (err) {
          await this.orchestrator.log(campaignId, 'warn', `Revision failed, keeping first-pass results: ${errMsg(err)}`);
        }
      }

      // ---- quality bar, diversity, footage ledger, semantic dedupe ----
      const roundFinals = await this.selectFinals(campaign, cands, used, finals, need, rounds, keyByYt, usage);
      finals.push(...roundFinals);
      for (const f of roundFinals) for (const c of f.asm.clips) used.set(c.material.youtubeId, [...(used.get(c.material.youtubeId) ?? []), [c.start, c.end]]);
      allCands.push(...cands);
      await this.orchestrator.log(
        campaignId,
        'info',
        `Round ${rounds}: kept ${roundFinals.length} of ${cands.length} ideas — ${finals.length}/${need} reels so far`,
      );
      await this.campaigns.updateOne({ _id: campaign._id }, { $push: { candidates: { $each: cands.map((c) => this.ledgerEntry(c)) } } });
    }

    await this.campaigns.updateOne(
      { _id: campaign._id },
      {
        $inc: { 'stats.candidates': allCands.length, 'stats.kept': finals.length, 'stats.dropped': allCands.length - finals.length, 'stats.rounds': rounds, 'stats.momentsShown': shown.size },
        $set: { 'stats.momentsAvailable': scored.length },
      },
    );
    if (!finals.length) {
      const issues = allCands.flatMap((c) => c.review?.issues ?? c.lastErrors).slice(0, 5).join(' | ');
      throw new FatalJobError(`No reel cleared the quality bar after ${rounds} round(s) over ${shown.size} moments. Main issues: ${issues || 'weak material for this brief'}`);
    }

    // ---------- 4. Packaging ----------
    const packs = await this.package(campaign, research, finals, usage);

    // ---------- 5. Persist + queue renders ----------
    let index = baseIndex;
    for (const c of finals) {
      index++;
      const pack = packs.get(c.ref);
      const ents = await this.entities.resolve(campaign.channelId, pack?.entities ?? []);
      const main = [...c.asm.clips].sort((a, b) => b.end - b.start - (a.end - a.start))[0];
      const link = await this.fullVideoLink(main.material.youtubeId, main.start);
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
          description: `${(pack?.description || c.plan.concept).trim()}\n\n${link ? `Full breakdown: ${link}` : 'Full video on the channel.'}`,
          tags: normaliseTags(pack?.tags ?? []),
          hashtags: normaliseHashtags(pack?.hashtags ?? []),
          pinnedComment: pack?.pinnedComment ?? '',
          summary: pack?.summary ?? c.plan.concept,
        },
        entitySlugs: ents.map((e) => e.slug),
        entityNames: ents.map((e) => e.name),
        themes: (pack?.themes ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean).slice(0, 3),
        momentIds: c.momentIds,
        embedding: c.embedding,
        templateName: s.templateName,
      });
      if (c.momentIds.length) {
        await this.moments.updateMany(
          { _id: { $in: c.momentIds } },
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

  private freeOfUsed(m: { youtubeId: string; start: number; end: number }, used: UsedRanges): boolean {
    const ov = (used.get(m.youtubeId) ?? []).reduce((n, [a, b]) => n + overlapSec(m.start, m.end, a, b), 0);
    return ov / Math.max(1, m.end - m.start) <= 0.5;
  }

  /** Best-first, but limit how many come from any one video so the director sees variety. */
  private pickDiverse<T extends { m: { youtubeId: string } }>(pool: T[], k: number, perVideoCap: number): T[] {
    const out: T[] = [];
    const per = new Map<string, number>();
    for (const x of pool) {
      if (out.length >= k) break;
      if ((per.get(x.m.youtubeId) ?? 0) < perVideoCap) {
        out.push(x);
        per.set(x.m.youtubeId, (per.get(x.m.youtubeId) ?? 0) + 1);
      }
    }
    for (const x of pool) if (out.length < k && !out.includes(x)) out.push(x);
    return out;
  }

  /** Two director calls in parallel (split by video) when there is a lot to choose from; otherwise one. */
  private splitGroups<T extends { m: { youtubeId: string } }>(picked: T[], requestCount: number): T[][] {
    const byVideo = new Map<string, T[]>();
    for (const x of picked) byVideo.set(x.m.youtubeId, [...(byVideo.get(x.m.youtubeId) ?? []), x]);
    if (requestCount < 6 || byVideo.size < 4) return [picked];
    const groups: T[][] = [[], []];
    for (const items of [...byVideo.values()].sort((a, b) => b.length - a.length)) {
      (groups[0].length <= groups[1].length ? groups[0] : groups[1]).push(...items);
    }
    return groups.filter((g) => g.length);
  }

  private ledgerEntry(c: Candidate): CandidateLedgerEntry {
    return {
      round: c.round,
      ref: c.ref,
      concept: truncate(c.plan.concept, 140),
      shape: c.plan.shape,
      videos: [...new Set(c.asm.clips.map((x) => x.material.youtubeId))],
      durationSec: Math.round(c.asm.duration * 10) / 10,
      overall: c.overall ?? null,
      verdict: c.review?.verdict ?? null,
      issues: (c.review?.issues ?? c.lastErrors).slice(0, 4).map((i) => truncate(i, 200)),
      revised: c.revised,
      outcome: c.outcome?.status ?? 'dropped',
      reason: truncate(c.outcome?.reason ?? 'unknown', 240),
    };
  }

  private weakness(c: Candidate): string {
    const r = c.review!;
    const parts: Array<[string, number]> = [['hook', r.hook], ['clarity', r.clarity], ['flow', r.flow], ['payoff', r.payoff], ['ending', r.ending], ['retention', r.retention]];
    parts.sort((a, b) => a[1] - b[1]);
    return `overall ${c.overall ?? overallScore(r)}, weakest ${parts[0][0]} ${parts[0][1]}${r.safety < 7 ? `, safety ${r.safety}` : ''}`;
  }

  private assertBudget(c: { usage?: { promptTokens?: number; completionTokens?: number } }) {
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
    chosen: Candidate[],
    need: number,
    round: number,
    keyByYt: Map<string, string>,
    usage: UsageSink,
  ): Promise<Candidate[]> {
    const target = campaign.settings.targetReels;
    const drop = (c: Candidate, reason: string) => {
      c.outcome = { status: 'dropped', reason };
    };

    const reviewed = cands.filter((c) => c.asm.ok && c.review && c.review.verdict !== 'drop');
    let pool = reviewed.filter((c) => passesBar(c.review!, MIN_KEEP));
    if (!chosen.length && pool.length < Math.min(2, need)) {
      // Borderline tier — only to avoid an empty campaign, never below a solid floor.
      const borderline = reviewed.filter(
        (c) => !pool.includes(c) && (c.overall ?? 0) >= 64 && c.review!.safety >= 7 && Math.min(c.review!.hook, c.review!.clarity, c.review!.flow, c.review!.payoff, c.review!.ending) >= 5,
      );
      pool = [...pool, ...borderline.sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0)).slice(0, Math.min(2, need) - pool.length)];
    }
    for (const c of cands) {
      if (pool.includes(c)) continue;
      if (!c.asm.ok) drop(c, `Invalid cut: ${c.asm.errors[0] ?? 'structural check failed'}`);
      else if (!c.review) drop(c, 'Not reviewed by the critic');
      else if (c.review.verdict === 'drop') drop(c, `Critic dropped it: ${c.review.issues[0] ?? 'weak material'}`);
      else drop(c, `Below the quality bar (${this.weakness(c)})`);
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

    // The per-video cap loosens each round so a few rich videos can still fill the quota.
    const maxPerVideo = Math.max(2, Math.ceil(target / Math.max(1, keyByYt.size)) + 1) + (round - 1) * 2;
    const picked: Candidate[] = [];
    const perVideo = new Map<string, number>();
    for (const f of chosen) perVideo.set(f.asm.clips[0].material.youtubeId, (perVideo.get(f.asm.clips[0].material.youtubeId) ?? 0) + 1);

    for (const c of pool) {
      if (picked.length >= need) {
        c.outcome = { status: 'spare', reason: 'Passed review, but the requested number was already reached' };
        continue;
      }
      const mainYt = c.asm.clips[0].material.youtubeId;
      if ((perVideo.get(mainYt) ?? 0) >= maxPerVideo) {
        drop(c, `Too many reels from the same video already (limit ${maxPerVideo})`);
        continue;
      }
      const ledgerOverlap = c.asm.clips.reduce(
        (n, x) => n + (used.get(x.material.youtubeId) ?? []).reduce((m, [a, b]) => m + overlapSec(x.start, x.end, a, b), 0),
        0,
      );
      if (ledgerOverlap / c.asm.duration > 0.4) {
        drop(c, 'Reuses footage from an earlier reel');
        continue;
      }
      const others = [...chosen, ...picked];
      const clash = others.find((f) =>
        f.asm.clips.some((fc) =>
          c.asm.clips.some(
            (cc) =>
              fc.material.youtubeId === cc.material.youtubeId &&
              overlapSec(fc.start, fc.end, cc.start, cc.end) / Math.min(fc.end - fc.start, cc.end - cc.start) > 0.25,
          ),
        ),
      );
      if (clash) {
        drop(c, `Overlaps the footage of "${truncate(clash.plan.concept, 60)}"`);
        continue;
      }
      if (c.embedding?.length) {
        const dupe = library.find((l) => cosine(l.embedding, c.embedding!) >= 0.9);
        if (dupe) {
          drop(c, `Too similar to an existing reel: "${truncate(dupe.headline, 60)}"`);
          continue;
        }
        const twin = others.find((f) => f.embedding && cosine(f.embedding, c.embedding!) >= 0.92);
        if (twin) {
          drop(c, `Too similar to another new reel: "${truncate(twin.plan.concept, 60)}"`);
          continue;
        }
      }
      c.outcome = { status: 'kept', reason: `Cleared the bar (score ${c.overall})` };
      picked.push(c);
      perVideo.set(mainYt, (perVideo.get(mainYt) ?? 0) + 1);
    }
    return picked;
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
  /** The long video's link for the description: YouTube sources directly; uploads only once linked to their YouTube video. */
  private async fullVideoLink(sourceId: string, start: number): Promise<string | null> {
    if (!sourceId.startsWith('up_')) return `https://youtu.be/${sourceId}?t=${Math.floor(start)}`;
    const s = await this.reels.db.collection('reel_sources').findOne({ youtubeId: sourceId }, { projection: { linkedYoutubeId: 1 } });
    return s?.linkedYoutubeId ? `https://youtu.be/${s.linkedYoutubeId}?t=${Math.floor(start)}` : null;
  }

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
