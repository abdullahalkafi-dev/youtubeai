/**
 * What makes a reel get views on THIS channel, learned from its own results (Nov 13 2026 audit, 76 posted reels):
 * - the opening line: "I / my ..." openers had a median of 2,263 views, a famous name 1,606, a general statement 1,294;
 * - the topic: prison-life details (cell, guard, toilet, ADX...) 1,896; court procedure (prosecutors, defense, trial, bond...) 396;
 * - the critic's quality score had NO relation to views (Spearman -0.07), so it is only a gate, not a ranking input.
 * Each level gets a "lift" in ranking points: 20 x log2(level median / overall median), shrunk toward 0 for small samples and refit
 * from the posted reels' 48-hour views (fitAppealModel). Pure: no database.
 */

export type OpenerKind = 'first-person' | 'named' | 'you' | 'general';
export type TopicKind = 'prison-life' | 'legal' | 'other';

export interface AppealModel {
  opener: Record<OpenerKind, number>;
  topic: Record<TopicKind, number>;
  /** Posts the lifts were fitted on (0 = the audit defaults). */
  n: number;
  fittedAt?: string;
}

/** The Nov 13 audit's numbers (overall median 1,306): first-person +16, named +6, you -2, general 0; prison-life +11, legal -34. */
export const DEFAULT_APPEAL_MODEL: AppealModel = {
  opener: { 'first-person': 16, named: 6, you: -2, general: 0 },
  topic: { 'prison-life': 11, legal: -34, other: 0 },
  n: 0,
};

const FAMOUS = /\b(diddy|combs|chapo|el mayo|keefe|durk|tory lanez|mutulu|50 cent|fifty|yella beezy|tupac|foolio|gotti|pooh shiesty|big ?30|rick ross|big meech|irv gotti|suge|boosie|kai cenat|young thug|ybn|nba youngboy|tekashi|6ix9ine|r\. kelly|meek mill)\b/i;
const FIRST_PERSON_START = /^\s*(?:["“]?\s*)?(?:and |but |so |now |man,? )?(i|i'm|i've|i'd|i was|my|me|we|we had|our)\b/i;
const YOU = /\b(you|your|you're)\b/i;

/** What the first spoken line does: the host's own experience, a famous name, talking to "you", or a general statement. */
export function openerKind(hook: string | null | undefined): OpenerKind {
  const h = String(hook ?? '').trim();
  if (!h) return 'general';
  if (FIRST_PERSON_START.test(h)) return 'first-person';
  if (FAMOUS.test(h)) return 'named';
  if (/\b(i|my|me|i'm|i've)\b/i.test(h) && h.split(/\s+/).length <= 18) return 'first-person';
  if (YOU.test(h)) return 'you';
  return 'general';
}

const LEGAL = /\b(prosecut\w*|defen[cs]e|defense attorney|trial|bond|bail|convict\w*|plea|witness\w*|testif\w*|transcript|cooperat\w*|indict\w*|jury|juror|verdict|court|judge|motion|appeal|evidence|charge[sd]?|case file|discovery)\b/i;
const PRISON_LIFE = /\b(cell|guard|officer|c\.?o\.?|toilet|flush|hole|shu|solitary|adx|supermax|yard|intake|first night|lockdown|laundry|commissary|chow|cellmate|bunk|shakedown|strip[- ]search|count time|handcuff\w*|shackle\w*|visiting room|visit|mail call|recreation|23[- ]hour|federal prison|penitentiary|years? inside|26 years|life plus)\b/i;

/** What the reel is about: a detail of prison life, the legal procedure of a case, or something else. */
export function topicKind(text: string | null | undefined): TopicKind {
  const t = String(text ?? '');
  const life = PRISON_LIFE.test(t);
  const legal = LEGAL.test(t);
  if (life && !legal) return 'prison-life';
  if (legal && !life) return 'legal';
  if (life && legal) {
    // both: whichever has more hits
    const n = (re: RegExp) => (t.match(new RegExp(re.source, 'gi')) ?? []).length;
    return n(PRISON_LIFE) >= n(LEGAL) ? 'prison-life' : 'legal';
  }
  return 'other';
}

export const median = (a: number[]) => {
  const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Points for one level: 20 x log2(level median / overall median), shrunk by n/(n+SHRINK), clamped. */
export const SHRINK = 8;
const lift = (levelViews: number[], overall: number, prior: number) => {
  const n = levelViews.length;
  if (!n || overall <= 0) return prior;
  const raw = 20 * Math.log2(Math.max(1, median(levelViews)) / overall);
  const w = n / (n + SHRINK);
  return Math.round(Math.max(-40, Math.min(30, w * raw + (1 - w) * prior)));
};

/**
 * Refits the lifts from posted reels (views about 48 hours after posting). Levels with few posts stay near the audit defaults.
 * Under MIN_FIT_POSTS posts the defaults are kept.
 */
export const MIN_FIT_POSTS = 20;
export function fitAppealModel(rows: Array<{ hook: string; text: string; views: number }>, now = new Date()): AppealModel {
  if (rows.length < MIN_FIT_POSTS) return DEFAULT_APPEAL_MODEL;
  const overall = Math.max(1, median(rows.map((r) => r.views)));
  const opener = { ...DEFAULT_APPEAL_MODEL.opener };
  for (const k of Object.keys(opener) as OpenerKind[]) opener[k] = lift(rows.filter((r) => openerKind(r.hook) === k).map((r) => r.views), overall, DEFAULT_APPEAL_MODEL.opener[k]);
  const topic = { ...DEFAULT_APPEAL_MODEL.topic };
  for (const k of Object.keys(topic) as TopicKind[]) topic[k] = lift(rows.filter((r) => topicKind(r.text) === k).map((r) => r.views), overall, DEFAULT_APPEAL_MODEL.topic[k]);
  return { opener, topic, n: rows.length, fittedAt: now.toISOString() };
}

/** Cosine similarity of two embeddings (0 when either is missing). */
export function cosine(a?: number[] | null, b?: number[] | null): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let s = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? s / Math.sqrt(na * nb) : 0;
}

/**
 * Two reels at or above this similarity tell the same story (calibrated on the posted reels: the re-posted toilet story was 0.706 and
 * earned 260 views after 13,148 the first time; unrelated reels sit around 0.38, the 99th percentile of all pairs is 0.62).
 */
export const SAME_STORY = 0.68;
/** A story is not posted again within this many days. */
export const SAME_STORY_DAYS = 30;
/** Posts per source video within SOURCE_WINDOW_DAYS before it is rested (Keefe D's "His Own Words": 5 reels, 4 under 450 views). */
export const MAX_POSTS_PER_SOURCE = 2;
export const SOURCE_WINDOW_DAYS = 14;
