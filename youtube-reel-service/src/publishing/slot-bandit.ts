import { seededRandom } from './auto-plan';

/**
 * Learning which publishing times work. Each automatic post is scored by its RANK among that day's automatic posts (0 = weakest,
 * 1 = strongest), not by raw views: a news spike or a quiet weekday moves every post of that day together, so ranking inside the
 * day cancels it. A slot's score is the mean rank of the posts it got. Until there is enough data the order is random (see
 * assignRotation); after that slots are chosen by Thompson sampling with an exploration floor, so a slot that looked bad early
 * keeps getting tested.
 */

export interface DayPost {
  id: string;
  date: string;
  slot: string;
  views: number;
}
export interface SlotObs {
  slot: string;
  rank: number;
}
export interface SlotPosterior {
  slot: string;
  n: number;
  mean: number;
  /** Standard deviation of the estimate of the slot's mean rank. */
  sd: number;
}

/** A uniform rank has standard deviation 1/sqrt(12). */
const RANK_SD = Math.sqrt(1 / 12);
const PRIOR_N = 4;
export const MIN_POSTS_PER_DAY_FOR_RANK = 3;

/** Rank of every post inside its own day (ties share the middle rank). Days with fewer than 3 posts say nothing and are skipped. */
export function rankObservations(posts: DayPost[]): SlotObs[] {
  const byDay = new Map<string, DayPost[]>();
  for (const p of posts) byDay.set(p.date, [...(byDay.get(p.date) ?? []), p]);
  const out: SlotObs[] = [];
  for (const day of byDay.values()) {
    if (day.length < MIN_POSTS_PER_DAY_FOR_RANK) continue;
    for (const p of day) {
      const below = day.filter((q) => q.views < p.views).length;
      const ties = day.filter((q) => q.views === p.views).length - 1;
      out.push({ slot: p.slot, rank: (below + ties / 2) / (day.length - 1) });
    }
  }
  return out;
}

export function posteriors(obs: SlotObs[], slots: string[]): SlotPosterior[] {
  return slots.map((slot) => {
    const mine = obs.filter((o) => o.slot === slot);
    const n = mine.length;
    const mean = (0.5 * PRIOR_N + mine.reduce((s, o) => s + o.rank, 0)) / (PRIOR_N + n); // shrunk towards "no difference"
    return { slot, n, mean, sd: RANK_SD / Math.sqrt(PRIOR_N + n) };
  });
}

/** Enough data to trust the slots at all: this many observations in total and in every slot. */
export function banditReady(obs: SlotObs[], slots: string[], minTotal = 25, minPerSlot = 4): boolean {
  return obs.length >= minTotal && slots.every((s) => obs.filter((o) => o.slot === s).length >= minPerSlot);
}

function normal(rnd: () => number): number {
  // Box-Muller
  const u = Math.max(1e-12, rnd());
  const v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Thompson sampling: draw each slot's likely mean rank, give the strongest reels (items are best-first) the best draws, then with
 * probability `epsilon` per reel swap its slot with a random other one. The swap is the exploration floor: the slot order never
 * becomes fixed, and the learning keeps seeing every slot with every quality of reel.
 */
export function assignBandit<T>(items: T[], slots: string[], post: SlotPosterior[], seed: string, epsilon = 0.25): Array<{ item: T; slot: string; explored: boolean }> {
  const rnd = seededRandom(seed);
  const drawn = slots
    .map((slot) => {
      const p = post.find((x) => x.slot === slot) ?? { slot, n: 0, mean: 0.5, sd: RANK_SD / Math.sqrt(PRIOR_N) };
      return { slot, value: p.mean + p.sd * normal(rnd) };
    })
    .sort((a, b) => b.value - a.value);
  const pairs = items.slice(0, drawn.length).map((item, i) => ({ item, slot: drawn[i].slot, explored: false }));
  for (let i = 0; i < pairs.length; i++) {
    if (pairs.length > 1 && rnd() < epsilon) {
      let j = Math.floor(rnd() * (pairs.length - 1));
      if (j >= i) j++;
      [pairs[i].slot, pairs[j].slot] = [pairs[j].slot, pairs[i].slot];
      pairs[i].explored = true;
      pairs[j].explored = true;
    }
  }
  return pairs;
}
