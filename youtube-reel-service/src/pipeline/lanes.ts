/**
 * The footage-first lanes of the day (client request, 2026-10-24: some reels from videos uploaded in the last 30 days, because they are
 * trending; some from the best of his older content). Unlike the topic lanes, these start from the footage, so there is no topic
 * the archive might not contain. Pure ranking, no database.
 */

export const FRESH_DAYS = 30;
export const MIN_LONG_SEC = 300;
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
 * Videos from the last 30 days, best first: how much people watch it, how new it is, and not one already mined out. Videos that are
 * already analyzed get a small lift (their reels are ready sooner); everything else is analyzed on the way.
 */
export function pickFresh(videos: LaneVideo[], now: Date, take = 3): LaneVideo[] {
  return videos
    .filter((v) => v.durationSec >= MIN_LONG_SEC && ageDays(v, now) <= FRESH_DAYS)
    .map((v) => ({ v, score: Math.log1p(v.views) * recencyWeight(ageDays(v, now)) * (v.usedMoments >= 3 ? 0.5 : 1) * (v.analyzed ? 1.15 : 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, take)
    .map((x) => x.v);
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
    `Make reels from the host's newest videos: ${list}. Pick the strongest, most self-contained passages: a clear hook, a complete story ` +
    `or a lesson. Each reel must stand alone for a viewer who has not seen the full video, and name the person or case in the first sentence when it is about one.`
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
export function needsAnalysis(videos: Array<{ youtubeId: string; durationSec: number; publishedAt: Date | null }>, known: Set<string>, now: Date, days = 14): string[] {
  return videos
    .filter((v) => v.durationSec >= MIN_LONG_SEC && ageDays(v, now) <= days && !known.has(v.youtubeId))
    .sort((a, b) => new Date(b.publishedAt ?? 0).getTime() - new Date(a.publishedAt ?? 0).getTime())
    .map((v) => v.youtubeId);
}
