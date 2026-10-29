/**
 * The footage-first lanes of the day (client request, 2026-10-24: some reels from videos uploaded in the last 30 days, because they are
 * trending; some from the best of his older content). Unlike the topic lanes, these start from the footage, so there is no topic
 * the archive might not contain. Pure ranking, no database.
 */

export const FRESH_DAYS = 30;
export const MIN_LONG_SEC = 300;
/** Reels the fresh lane makes: more than the 3 posted from it, so one weak reel can be dropped without losing a slot. */
export const FRESH_LANE_REELS = 5;
/** Stock level the bank lane keeps: below this many finished, unposted reels it adds a campaign. */
export const STOCK_TARGET = 12;

export interface LaneVideo {
  youtubeId: string;
  /** The main app's video _id (string). */
  videoId: string;
  title: string;
  publishedAt: Date | null;
  views: number;
  durationSec: number;
  /** Already downloaded, transcribed and mined. */
  analyzed: boolean;
  /** Unused moments clear enough to stand alone (standalone >= 8, intensity >= 7). */
  strongMoments: number;
  /** Moments of this video already turned into reels. */
  usedMoments: number;
  /** The person or case the title is about (lowercase key), when known. */
  entity?: string | null;
  /** 0..1: the share of the channel's last-3-day views that went to that person. */
  demand?: number;
}

const DAY = 86_400_000;
export const ageDays = (v: { publishedAt: Date | null }, now: Date) => (v.publishedAt ? Math.max(0, (now.getTime() - new Date(v.publishedAt).getTime()) / DAY) : Infinity);

/** Newer is better: full weight for a week, fading to 40% at the edge of the window. */
export function recencyWeight(age: number): number {
  if (age <= 7) return 1;
  if (age >= FRESH_DAYS) return 0.4;
  return 1 - ((age - 7) / (FRESH_DAYS - 7)) * 0.6;
}

/**
 * Extra source-search points for a video from the last 30 days (1.5 at most, fading like recencyWeight), so the trending topic's
 * reels lean on his new uploads instead of old videos that only win on views and on being analysed already. Older videos get 0.
 */
export function freshnessBonus(publishedAt: Date | null | undefined, now: Date = new Date()): number {
  const age = ageDays({ publishedAt: publishedAt ?? null }, now);
  return age > FRESH_DAYS ? 0 : 1.5 * recencyWeight(age);
}

/**
 * Videos from the last 30 days, best first: how much people watch it, how new it is, and not one already mined out. Videos that are
 * already analyzed get a small lift (their reels are ready sooner); everything else is analyzed on the way.
 */
export function pickFresh(videos: LaneVideo[], now: Date, take = 3): LaneVideo[] {
  const ranked = videos
    .filter((v) => v.durationSec >= MIN_LONG_SEC && ageDays(v, now) <= FRESH_DAYS)
    .map((v) => ({ v, score: hitScore(v, now) }))
    .sort((a, b) => b.score - a.score);
  // at most MAX_PER_ENTITY of the picks about the same person, so one story does not take the whole lane
  const picked: LaneVideo[] = [];
  for (const { v } of ranked) {
    if (picked.length >= take) break;
    if (v.entity && picked.filter((p) => p.entity === v.entity).length >= MAX_PER_ENTITY) continue;
    picked.push(v);
  }
  return picked;
}

export const MAX_PER_ENTITY = 2;

/**
 * How much a video deserves reels now (hit-video-first, from the Oct 28 audit: the 66k, 54k and 32k videos made 2-3 reels each while
 * generic passages from weak videos filled the lane): views per day since it went up (not total views, which favour older videos),
 * lifted by the channel's own traffic share for the person it is about, cut when little footage is left to use.
 */
export function hitScore(v: LaneVideo, now: Date): number {
  const velocity = v.views / Math.max(3, ageDays(v, now));
  const headroom = !v.analyzed ? 1 : v.strongMoments >= 4 ? 1 : v.strongMoments >= 2 ? 0.7 : v.strongMoments === 1 ? 0.4 : 0.15;
  return Math.log1p(velocity) * (1 + 2 * (v.demand ?? 0)) * headroom * (v.usedMoments >= 3 ? 0.5 : 1) * (v.analyzed ? 1.1 : 1);
}

/** The person or case a video title is about: the longest known name found in it (lowercase key), or null. */
export function entityOf(title: string, entities: Array<{ key: string; names: string[] }>): string | null {
  const t = title.toLowerCase();
  let best: { key: string; len: number } | null = null;
  for (const e of entities) {
    for (const n of e.names) {
      if (n.length >= 3 && t.includes(n) && (!best || n.length > best.len)) best = { key: e.key, len: n.length };
    }
  }
  return best?.key ?? null;
}

/**
 * The best of the older content: analyzed videos from before the fresh window with the most strong unused moments, weighted by how
 * well the video itself did. Needs at least three strong moments, so a campaign has real choice.
 */
export function pickBank(videos: LaneVideo[], now: Date, take = 3): LaneVideo[] {
  return videos
    .filter((v) => v.analyzed && v.strongMoments >= 3 && ageDays(v, now) > FRESH_DAYS)
    .map((v) => ({ v, score: Math.min(v.strongMoments, 12) * Math.sqrt(Math.log1p(v.views) + 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, take)
    .map((x) => x.v);
}

export function freshBrief(videos: LaneVideo[]): string {
  const list = videos.map((v) => `"${v.title}"`).join('; ');
  return (
    `Make reels from the host's most-watched recent videos: ${list}. Pick the strongest, most self-contained passages about the real person or case ` +
    `those videos are about: a concrete incident, a first-person story or a hard verdict, not a general lesson. Each reel must stand alone for a viewer ` +
    `who has not seen the full video, and name the person or case in the first sentence.`
  );
}

export function bankBrief(videos: LaneVideo[]): string {
  const list = videos.map((v) => `"${v.title}"`).join('; ');
  return (
    `Make reels from the strongest passages of the host's best older videos: ${list}. Pick passages that stand on their own: a clear hook, ` +
    `a complete story or a lesson that still matters today. Each reel must make sense to a viewer who has not seen the full video.`
  );
}

/** Which new uploads still need analysis: published recently, long enough, and not yet downloaded or in progress. */
export function needsAnalysis(videos: Array<{ youtubeId: string; durationSec: number; publishedAt: Date | null; views?: number }>, known: Set<string>, now: Date, days = FRESH_DAYS): string[] {
  const speed = (v: { views?: number; publishedAt: Date | null }) => (v.views ?? 0) / Math.max(3, ageDays(v, now));
  return videos
    .filter((v) => v.durationSec >= MIN_LONG_SEC && ageDays(v, now) <= days && !known.has(v.youtubeId))
    // the videos people are watching most right now first (a 15k-view upload used to wait behind newer, weaker ones), then the newest
    .sort((a, b) => speed(b) - speed(a) || new Date(b.publishedAt ?? 0).getTime() - new Date(a.publishedAt ?? 0).getTime())
    .map((v) => v.youtubeId);
}
