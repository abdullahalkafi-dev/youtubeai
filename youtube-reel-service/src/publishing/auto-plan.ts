/**
 * Auto-publish planning: which reels go out, at which New York time, and when the system must stop on its own.
 * Pure functions (no database, no clock, no randomness of their own), so every rule is testable and a day can be replayed.
 */

export const AUTO_TZ = 'America/New_York';
/** The client's list (2026-10-24): 8 AM and 9 AM, then 8 PM, 9 PM and 10 PM (New York). Stored as 24-hour "HH:mm". */
export const DEFAULT_SLOTS = ['08:00', '09:00', '20:00', '21:00', '22:00'];
/** No extra slots: the day is five posts. */
export const DEFAULT_EXTRA_SLOTS: string[] = [];
/** A slot must be at least this far in the future when the plan is made (time to cancel or move it). */
export const MIN_LEAD_MIN = 20;
/**
 * A post goes out at a random time within this many minutes either side of its slot (8:00 is anywhere from 7:30 to 8:30, 9:00 from 8:30 to 9:30),
 * so the channel does not post on the dot every day. The slot stays the label the slot tests and the client see.
 */
export const JITTER_MIN = 30;
/** Two posts are never closer than this, whatever the dice say. */
export const MIN_GAP_MIN = 12;
/** The upload starts this long before the slot so the video is public at the slot time. */
export const UPLOAD_LEAD_MS = 2 * 60_000;

export interface AutoSettings {
  enabled: boolean;
  privacy: 'public' | 'unlisted';
  slots: string[];
  extraSlots: string[];
  /** Overall reel score (0-100) a reel needs to go out without a person looking at it. */
  minScore: number;
  maxPerDay: number;
  spacingMin: number;
  /** Set when the system stopped itself (or the client paused it). */
  pausedReason: string | null;
  pausedAt: Date | null;
  /** Posting is slowed to SLOW_POSTS a day until this time (a views slump, not a YouTube problem). */
  slowUntil?: Date | null;
  slowReason?: string | null;
}

export const DEFAULT_AUTO_SETTINGS: AutoSettings = {
  enabled: false,
  privacy: 'public',
  slots: DEFAULT_SLOTS,
  extraSlots: DEFAULT_EXTRA_SLOTS,
  minScore: 65,
  maxPerDay: 5,
  spacingMin: 60,
  pausedReason: null,
  pausedAt: null,
};

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const validSlot = (s: string) => HHMM.test(s);

/** "20:00" -> "8:00 PM" (everything the client reads uses the 12-hour clock). */
export function slot12(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!m) return String(hhmm);
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`;
}

/**
 * Reads a time the way people write it ("8:00 AM", "9pm", "20:00") and returns "HH:mm" (24-hour, how slots are stored),
 * or null when it is not a time.
 */
export function parseSlot(text: string): string | null {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\.?\s*$/i.exec(String(text ?? ''));
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0);
  } else if (h > 23) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** New York offset (minutes behind UTC, e.g. 240 in summer) at a UTC instant. */
function nyOffsetMin(utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: AUTO_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((utcMs - asUtc) / 60_000);
}

/** The UTC instant of a New York wall-clock time ('YYYY-MM-DD', 'HH:mm'), daylight saving included. */
export function nyToUtc(date: string, hhmm: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = hhmm.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, h, min);
  let t = wall + nyOffsetMin(wall) * 60_000;
  t = wall + nyOffsetMin(t) * 60_000; // second pass settles the hours around a daylight-saving change
  return new Date(t);
}

/**
 * The slots to use for `count` reels today: the base slots first (in time order), then the extra slots, only those still far enough
 * ahead, keeping the required spacing, returned in time order. May return fewer than `count` late in the day.
 */
export function pickSlots(input: { date: string; now: Date; count: number; slots: string[]; extraSlots: string[]; spacingMin: number; leadMin?: number }): string[] {
  const earliest = input.now.getTime() + (input.leadMin ?? MIN_LEAD_MIN) * 60_000;
  const usable = [...new Set([...input.slots, ...input.extraSlots])].filter(validSlot);
  const isFuture = (s: string) => nyToUtc(input.date, s).getTime() + JITTER_MIN * 60_000 >= earliest;
  const chosen: string[] = [];
  const farEnough = (s: string) => chosen.every((c) => Math.abs(nyToUtc(input.date, s).getTime() - nyToUtc(input.date, c).getTime()) >= input.spacingMin * 60_000);
  // base slots are preferred over extras whatever their time
  for (const s of [...input.slots.filter(validSlot).sort(), ...input.extraSlots.filter(validSlot).sort()]) {
    if (chosen.length >= input.count) break;
    if (usable.includes(s) && isFuture(s) && !chosen.includes(s) && farEnough(s)) chosen.push(s);
  }
  return chosen.sort();
}

/**
 * The moment a post in `slot` goes out: a random time within JITTER_MIN either side of the slot, never earlier than `earliest` and never within
 * MIN_GAP_MIN of another post (`others`, epoch ms). Reproducible from `seed`, so a day's plan can be replayed.
 */
export function jitterRunAt(input: { date: string; slot: string; seed: string; earliest: number; others: number[] }): Date {
  const centre = nyToUtc(input.date, input.slot).getTime();
  const lo = Math.max(centre - JITTER_MIN * 60_000, input.earliest);
  const hi = Math.max(centre + JITTER_MIN * 60_000, lo);
  const rnd = seededRandom(input.seed);
  const gap = MIN_GAP_MIN * 60_000;
  const clearance = (t: number) => Math.min(Infinity, ...input.others.map((o) => Math.abs(o - t)));
  let best = lo;
  let bestClear = -1;
  for (let i = 0; i < 40; i++) {
    const t = Math.round((lo + rnd() * (hi - lo)) / 1000) * 1000; // random to the second
    const c = clearance(t);
    if (c >= gap) return new Date(t);
    if (c > bestClear) {
      best = t;
      bestClear = c;
    }
  }
  return new Date(best); // a crowded window: the candidate farthest from every other post
}

/** From this New York time the day is locked: whatever is still empty is filled from the stock of finished reels. */
export const LOCK_TIME = '07:00';
export const lockAt = (date: string) => nyToUtc(date, LOCK_TIME);
/** The daily mix (client, 2026-10-28: his new uploads are the trending ones): up to 3 reels from the newest videos, 1 from the topic of the day, 1 from a second topic; the rest by score. */
export const DAILY_MIX: Array<[string, number]> = [['fresh', 3], ['main', 1], ['explore', 1]];
/** No more than this many reels about the same person in one day (the channel's own name is not a person). */
export const MAX_PER_PERSON = 2;

/** Slots that are still free today: in the future (with the lead time), not taken, and far enough from every taken or chosen slot. */
export function freeSlots(input: { date: string; now: Date; slots: string[]; extraSlots: string[]; taken: string[]; spacingMin: number; leadMin?: number }): string[] {
  const earliest = input.now.getTime() + (input.leadMin ?? MIN_LEAD_MIN) * 60_000;
  const at = (s: string) => nyToUtc(input.date, s).getTime();
  const near = new Set(input.taken.filter(validSlot));
  const out: string[] = [];
  for (const s of [...new Set([...input.slots.filter(validSlot).sort(), ...input.extraSlots.filter(validSlot).sort()])]) {
    if (near.has(s) || at(s) + JITTER_MIN * 60_000 < earliest) continue;
    if ([...near, ...out].every((c) => Math.abs(at(s) - at(c)) >= input.spacingMin * 60_000)) out.push(s);
  }
  return out.sort();
}

/**
 * How likely a reel is to be watched, used to rank reels (the Oct 28 audit found the critic's score had zero correlation with 24h views, r = 0.00
 * over 36 posts, so it stays only as the quality gate and as a small part of this). Starting weights from that audit, to be refit as posts come in:
 * naming a person or case (about 1,200 vs 800 first-day views), the channel's own traffic share for that person, and how fast the source video is growing.
 * A reel with none of those inputs ranks by 0.35 x score, so the order of plain scores is unchanged.
 */
export function appeal(r: Pick<PlanReel, 'score' | 'named' | 'demand' | 'sourceVelocity' | 'concrete' | 'recentSourceUses'>): number {
  return (
    0.35 * r.score +
    (r.named ? 20 : 0) +
    80 * Math.min(0.3, r.demand ?? 0) +
    3 * Math.log1p(Math.max(0, r.sourceVelocity ?? 0)) +
    CONCRETE_WEIGHT * (r.concrete ?? 0) -
    REPEAT_PENALTY * Math.min(2, r.recentSourceUses ?? 0)
  );
}

/** Up to this many points for a reel about a concrete event (the Oct 30 audit: the 1,500-1,700 view reels were incidents, the 150-300 ones abstract lessons). */
export const CONCRETE_WEIGHT = 15;
/** Points off per recent post cut from the same source video (the feed should not show the same picture again and again). */
export const REPEAT_PENALTY = 8;

const FIRST_PERSON = /\b(i|i'm|i've|i'd|i'll|my|me|we|our)\b/i;
const EVENT_WORDS =
  /\b(kill(?:ed|ing)?|murder(?:ed)?|stab(?:bed|bing)?|shot|shooting|fight|fought|arrest(?:ed)?|charged|denied|sentence[ds]?|hospital|escape[ds]?|riot|lockdown|cell|isolation|solitary|strip[- ]?search(?:ed)?|toilet|handcuff(?:ed|s)?|guard|testif(?:y|ied)|snitch(?:ed)?|informant|bail|bond|trial|verdict|plea)\b/i;
const ABSTRACT_WORDS = /\b(lesson|mindset|mentality|psycholog\w*|accountability|identity|perception|reputation trap|illusion|journey|reflection|discussion|analysis|thoughts? on)\b/i;

/**
 * 0..1: how concrete the story behind a reel's title and opening line is. A number, a first-person account and a real event add; an
 * abstract frame ("lesson", "mindset", "discussion") subtracts. A rough text check, not a judgement of the story: it only orders
 * reels that are otherwise close.
 */
export function concreteness(text: string | null | undefined): number {
  const t = String(text ?? '');
  if (!t.trim()) return 0;
  let s = 0;
  if (/\d/.test(t)) s += 0.25;
  if (FIRST_PERSON.test(t)) s += 0.35;
  if (EVENT_WORDS.test(t)) s += 0.4;
  if (ABSTRACT_WORDS.test(t)) s -= 0.4;
  return Math.max(0, Math.min(1, s));
}

/** A stock reel cut from a video older than this many days ranks lower, so a leftover slot goes to a recent one first. */
export const STALE_AFTER_DAYS = 21;
export const STALE_PENALTY = 5;
const stockRank = (r: PlanReel) => appeal(r) - ((r.sourceAgeDays ?? 0) > STALE_AFTER_DAYS ? STALE_PENALTY : 0);

export interface PlanReel {
  id: string;
  score: number;
  /** People in the reel (slugs). */
  entities: string[];
  createdAt?: number;
  /** Age in days of the video the reel was cut from (unknown = not penalised). */
  sourceAgeDays?: number;
  /** The reel is about a named person or case (not the channel's own name). */
  named?: boolean;
  /** 0..1: the channel's own last-3-day traffic share for the person the reel is about. */
  demand?: number;
  /** Views per day of the source video since it went up. */
  sourceVelocity?: number;
  /** The lane the reel came from (fresh, main, explore, bank, best); stock reels have none. */
  track?: string;
  /** 0..1: how concrete the reel's story is (see concreteness). */
  concrete?: number;
  /** The YouTube videos the reel was cut from. */
  sourceIds?: string[];
  /** How many recent posts (last 3 days) were cut from the same source videos. */
  recentSourceUses?: number;
}

/**
 * Which reels fill the empty slots. Today's own reels come first (best score first); the stock of earlier finished reels only
 * when `useStock` (after the 7 AM lock). A person may appear in at most `maxPerPerson` reels a day; if that leaves slots empty,
 * the limit is relaxed by one rather than posting fewer than the day needs.
 */
export function chooseReels(input: {
  need: number;
  fresh: PlanReel[];
  stock: PlanReel[];
  useStock: boolean;
  plannedEntities: string[][];
  ignore?: (slug: string) => boolean;
  maxPerPerson?: number;
  /** Lanes already used today (their reels count against the mix). */
  plannedTracks?: string[];
  mix?: Array<[string, number]>;
  /** Source videos of the reels already planned today. */
  plannedSources?: string[][];
  /** Reels from one source video per day: 1 first, 2 only when that is the only way to fill the day. */
  maxPerSource?: number;
}): Array<PlanReel & { source: 'fresh' | 'stock' }> {
  const ignore = input.ignore ?? (() => false);
  const people = (r: { entities: string[] }) => [...new Set(r.entities.filter((e) => !ignore(e)))];
  const byScore = (a: PlanReel, b: PlanReel) => appeal(b) - appeal(a) || (b.createdAt ?? 0) - (a.createdAt ?? 0);
  const pool: Array<PlanReel & { source: 'fresh' | 'stock' }> = [
    ...[...input.fresh].sort(byScore).map((r) => ({ ...r, source: 'fresh' as const })),
    ...(input.useStock ? [...input.stock].sort((a, b) => stockRank(b) - stockRank(a) || byScore(a, b)).map((r) => ({ ...r, source: 'stock' as const })) : []),
  ];
  const picked: Array<PlanReel & { source: 'fresh' | 'stock' }> = [];
  const count = new Map<string, number>();
  for (const e of input.plannedEntities.flatMap((x) => [...new Set(x.filter((y) => !ignore(y)))])) count.set(e, (count.get(e) ?? 0) + 1);
  const base = input.maxPerPerson ?? MAX_PER_PERSON;
  const srcCount = new Map<string, number>();
  const sources = (r: PlanReel) => [...new Set(r.sourceIds ?? [])];
  for (const s of (input.plannedSources ?? []).flatMap((x) => [...new Set(x)])) srcCount.set(s, (srcCount.get(s) ?? 0) + 1);
  const srcBase = input.maxPerSource ?? 1;
  const allowed = (r: PlanReel, cap: number, srcCap = srcBase) => !people(r).some((e) => (count.get(e) ?? 0) >= cap) && !sources(r).some((s) => (srcCount.get(s) ?? 0) >= srcCap);
  const take = (r: PlanReel & { source: 'fresh' | 'stock' }) => {
    picked.push(r);
    for (const e of people(r)) count.set(e, (count.get(e) ?? 0) + 1);
    for (const s of sources(r)) srcCount.set(s, (srcCount.get(s) ?? 0) + 1);
  };
  // The mix first: the best reels of each lane up to its share (counting lanes already planned today).
  const usedTracks = new Map<string, number>();
  for (const t of input.plannedTracks ?? []) usedTracks.set(t, (usedTracks.get(t) ?? 0) + 1);
  for (const [lane, share] of input.mix ?? DAILY_MIX) {
    for (const r of pool) {
      if (picked.length >= input.need || (usedTracks.get(lane) ?? 0) >= share) break;
      if (r.source !== 'fresh' || r.track !== lane || picked.includes(r) || !allowed(r, base)) continue;
      take(r);
      usedTracks.set(lane, (usedTracks.get(lane) ?? 0) + 1);
    }
  }
  // Fill the rest: one reel per source video and the person cap first, then two per source, then one more per person.
  for (const [cap, srcCap] of [[base, srcBase], [base, srcBase + 1], [base + 1, srcBase + 1]] as Array<[number, number]>) {
    for (const r of pool) {
      if (picked.length >= input.need) break;
      if (picked.includes(r)) continue;
      if (!allowed(r, cap, srcCap)) continue;
      take(r);
    }
  }
  return picked;
}

/** Small deterministic generator, so a day's plan can be reproduced from its date. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Weeks 1-2 (and whenever there is no data): reels go to slots in a RANDOM order, so every slot gets a fair mix of strong and weak
 * reels. If the best reel always took the best-looking slot, the slot would get the credit for the reel's quality.
 */
export function assignRotation<T>(items: T[], slots: string[], seed: string): Array<{ item: T; slot: string }> {
  const rnd = seededRandom(seed);
  const order = [...slots];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return items.slice(0, order.length).map((item, i) => ({ item, slot: order[i] }));
}

export interface GateInput {
  score: number | null;
  verdict: string | null;
  preflightErrors: string[];
  hasActivePost: boolean;
  minScore: number;
}

/** Why a reel may not go out without a person looking at it (null = it may). */
export function gateReason(g: GateInput): string | null {
  if (g.hasActivePost) return 'it already has a post';
  if (g.preflightErrors.length) return g.preflightErrors[0];
  if (g.verdict && g.verdict !== 'keep' && g.verdict !== 'ok' && g.verdict !== 'revise') return `the reviewer said "${g.verdict}"`;
  if (g.score === null || g.score < g.minScore) return `score ${g.score ?? '?'} is under ${g.minScore}`;
  return null;
}

export interface GuardPost {
  status: string;
  publishedAt: Date | null;
  views: number | null;
  warnings: string[];
  errorCode?: string | null;
}

// the texts YouTube's check produces (youtube.publisher.ts verify): forced private, rejected, copyright claim, visibility not honoured
const PLATFORM_TROUBLE = /set this video to private|youtube set it to|rejected|copyright|claim|removed|terms of use|policy|restricted/i;

/**
 * When the system must stop publishing by itself: YouTube flagged something, or three posts in a row (each at least a day old)
 * earned under 30% of the channel's usual Shorts views. Returns the reason, or null to carry on.
 */
export function evaluateGuardrails(posts: GuardPost[], shortsMedian: number | null, now = new Date()): string | null {
  const trouble = platformTrouble(posts);
  if (trouble) return trouble;
  const collapse = viewsCollapse(posts, shortsMedian, now);
  return collapse ? `Stopped by itself: ${collapse} Look at what changed, then resume.` : null;
}

/** A real problem on YouTube's side (flag, rejection, copyright claim, removal): the only thing that hard-stops posting. */
export function platformTrouble(posts: GuardPost[]): string | null {
  const trouble = posts.find((p) => p.errorCode === 'rejected' || p.status === 'removed' || p.warnings.some((w) => PLATFORM_TROUBLE.test(w)));
  if (!trouble) return null;
  const why = trouble.warnings.find((w) => PLATFORM_TROUBLE.test(w)) ?? (trouble.status === 'removed' ? 'a video was removed' : 'YouTube rejected a video');
  return `Stopped by itself: YouTube flagged an automatic post (${why}). Check YouTube Studio, then resume.`;
}

/** The last three settled automatic posts each earned under 30% of the baseline (null = fine, or not enough to judge). */
export function viewsCollapse(posts: GuardPost[], baseline: number | null, now = new Date()): string | null {
  if (!baseline || baseline <= 0) return null;
  const settled = posts
    .filter((p) => p.status === 'published' && p.publishedAt && now.getTime() - p.publishedAt.getTime() >= 24 * 3600_000 && p.views !== null)
    .sort((a, b) => b.publishedAt!.getTime() - a.publishedAt!.getTime())
    .slice(0, 3);
  if (settled.length === 3 && settled.every((p) => (p.views ?? 0) < 0.3 * baseline)) {
    return `the last 3 automatic posts each earned under 30% of your usual Shorts views (about ${Math.round(baseline)}).`;
  }
  return null;
}

/** A views slump does not stop the channel: it slows to this many posts a day for SLOW_DAYS, then is judged again. */
export const SLOW_POSTS = 3;
export const SLOW_DAYS = 3;
/** The text an older version of the guard wrote when it paused on views alone (such a pause is re-judged with the new rules). */
export const LEGACY_VIEWS_PAUSE = /earned under 30% of your usual Shorts views/i;

/** The slots used while slowed down: every other one, so mornings and evenings both stay (08:00, 20:00, 22:00 of five). */
export function slowSlots(slots: string[]): string[] {
  const sorted = [...slots].filter(validSlot).sort();
  return sorted.filter((_, i) => i % 2 === 0).slice(0, SLOW_POSTS);
}

/** The median views of the channel's own automatic posts from 3 to 17 days ago: what "normal" means for the reels themselves (null under 8 posts). */
export function autoBaseline(posts: Array<{ publishedAt: Date | null; views: number | null }>, now = new Date()): number | null {
  const from = now.getTime() - 17 * 86_400_000;
  const to = now.getTime() - 3 * 86_400_000;
  const v = posts
    .filter((p) => p.publishedAt && p.views !== null && p.publishedAt.getTime() >= from && p.publishedAt.getTime() <= to)
    .map((p) => p.views as number)
    .sort((a, b) => a - b);
  if (v.length < 8) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
