/**
 * The Daily Brain: explicit, logged scoring of the day's candidate topics, the coverage/saturation rules, and the
 * main/explore split. Pure functions (no database, no model), so every choice can be tested and replayed.
 * The model only proposes candidates and writes the brief; this file decides.
 */

export type DailySignal = 'trend' | 'performance' | 'archive' | 'explore';
export type Track = 'main' | 'explore';

export interface BrainCandidate {
  name: string;
  brief: string;
  why: string;
  keywords: string[];
  signal: DailySignal;
  /** One of the channel's content pillars (see PillarService), or null when unknown. */
  pillar: string | null;
  /** The person/case this topic is mostly about (lowercase key), or null. */
  entity: string | null;
}

export interface CandidateEvidence {
  /** Mined moments matching 2+ keywords. */
  moments: number;
  /** Catalog videos matching the main keywords. */
  videos: number;
  /** Unused, standalone-strong moments among the matching ones. */
  strongMoments: number;
  /** 0..1: best matching trending topic, weighted by opportunity and by how fresh the scan is. */
  trendMatch: number;
  trendTitle: string | null;
  /** 0..1: share of the channel's last-3-day views that went to videos about this topic. */
  velocityShare: number;
}

export interface PillarState {
  /** Days since one of our reels covered this pillar (null = never). */
  daysSinceCovered: number | null;
  /** 0.6..1.6: how this pillar performs against the channel median (1 = same). */
  lift: number;
  /** Posts behind the lift (0 = it is the catalog prior). */
  posts: number;
}

export interface BrainContext {
  /** Entities used by the MAIN track on each of the last 5 days, newest first. */
  recentMainEntities: Array<string | null>;
  pillars: Record<string, PillarState>;
  /** Reels the day should produce in total (4-7). */
  targetReels: number;
}

export interface ScoreComponents {
  demand: number;
  velocity: number;
  lift: number;
  need: number;
  supply: number;
  saturation: number;
}

export interface ScoredCandidate {
  c: BrainCandidate;
  ev: CandidateEvidence;
  components: ScoreComponents;
  score: number;
  exploreScore: number;
  spike: boolean;
  eligible: boolean;
  reason: string | null;
}

export const WEIGHTS = { demand: 0.35, velocity: 0.2, lift: 0.15, need: 0.15, supply: 0.15 };
export const MIN_STRONG_MOMENTS = 4;
export const MIN_ARCHIVE_EVIDENCE = 3;
/** An entity may lead the day this many times in the last 5 days (more during a real news spike). */
export const ENTITY_CAP = 2;
export const ENTITY_CAP_SPIKE = 4;
export const EXPLORE_MIN_DAYS = 7;

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

/** A real news spike: the channel's own views are concentrated on it AND the trend scan agrees. */
export function isSpike(ev: Pick<CandidateEvidence, 'velocityShare' | 'trendMatch'>): boolean {
  return ev.velocityShare >= 0.4 && ev.trendMatch >= 0.35;
}

export function coverageNeed(p: PillarState | undefined): number {
  if (!p || p.daysSinceCovered === null) return 1; // never covered
  return clamp((0.8 + 0.04 * p.daysSinceCovered - 0.8) / 0.6);
}

export function scoreCandidate(c: BrainCandidate, ev: CandidateEvidence, ctx: BrainContext): ScoredCandidate {
  const pillar = c.pillar ? ctx.pillars[c.pillar] : undefined;
  const entityUses = c.entity ? ctx.recentMainEntities.filter((e) => e === c.entity).length : 0;
  const spike = isSpike(ev);
  const cap = spike ? ENTITY_CAP_SPIKE : ENTITY_CAP;

  const components: ScoreComponents = {
    demand: round(clamp(ev.trendMatch)),
    velocity: round(clamp(ev.velocityShare / 0.5)),
    lift: round(clamp(((pillar?.lift ?? 1) - 0.6) / 1.0)),
    need: round(coverageNeed(pillar)),
    supply: round(clamp(ev.strongMoments / Math.max(1, ctx.targetReels * 2))),
    saturation: round(c.entity ? Math.max(0.25, 1 - 0.18 * entityUses) : 1),
  };

  let reason: string | null = null;
  if (ev.moments + ev.videos < MIN_ARCHIVE_EVIDENCE) reason = 'not enough matching footage';
  else if (ev.strongMoments < MIN_STRONG_MOMENTS) reason = `only ${ev.strongMoments} strong unused moments`;
  else if (c.entity && entityUses >= cap) reason = `${c.entity} already led ${entityUses} of the last 5 days`;

  const base =
    WEIGHTS.demand * components.demand +
    WEIGHTS.velocity * components.velocity +
    WEIGHTS.lift * components.lift +
    WEIGHTS.need * components.need +
    WEIGHTS.supply * components.supply;
  const score = round(100 * base * components.saturation, 1);
  // Explore ignores the channel's concentration on one story: it wants a fresh pillar with real material.
  const exploreScore = round(100 * (0.4 * components.demand + 0.4 * components.need + 0.2 * components.supply), 1);

  return { c, ev, components, score, exploreScore, spike, eligible: reason === null, reason };
}

export interface Portfolio {
  main: ScoredCandidate | null;
  explore: ScoredCandidate | null;
  mainReels: number;
  exploreReels: number;
}

/** 60% main / 40% explore; fewer than 5 reels means all main. */
export function splitReels(total: number): { main: number; explore: number } {
  const t = Math.max(0, Math.round(total));
  if (t < 5) return { main: t, explore: 0 };
  const main = Math.ceil(t * 0.6);
  return { main, explore: t - main };
}

export function selectPortfolio(scored: ScoredCandidate[], ctx: BrainContext): Portfolio {
  const main = [...scored].filter((s) => s.eligible).sort((a, b) => b.score - a.score)[0] ?? null;
  const split = splitReels(ctx.targetReels);
  if (!main) return { main: null, explore: null, mainReels: 0, exploreReels: 0 };

  let explore: ScoredCandidate | null = null;
  if (split.explore > 0) {
    explore =
      [...scored]
        .filter((s) => {
          if (!s.eligible || s === main) return false;
          if (main.c.entity && s.c.entity === main.c.entity) return false;
          if (main.c.pillar && s.c.pillar === main.c.pillar) return false;
          const p = s.c.pillar ? ctx.pillars[s.c.pillar] : undefined;
          return !p || p.daysSinceCovered === null || p.daysSinceCovered >= EXPLORE_MIN_DAYS;
        })
        .sort((a, b) => b.exploreScore - a.exploreScore)[0] ?? null;
  }
  // No usable explore topic: the day stays one topic rather than inventing a weak one.
  return explore ? { main, explore, mainReels: split.main, exploreReels: split.explore } : { main, explore: null, mainReels: Math.max(split.main + split.explore, 0), exploreReels: 0 };
}
