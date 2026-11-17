/**
 * Hot videos: the newest long videos the audience is watching right now get the day's reels first (Nov 17 2026 audit).
 *
 * Why: reels cut from a video under 3 days old earned a median 2,289 views at 48 h against about 1,200 for older footage; the three
 * live streams of Nov 11-15 (51k, 42k, 36k views) got 1-2 reels each because the daily topic was chosen from the whole archive on how
 * much footage it had, and the lane built for new videos had been switched off.
 *
 * The 15-day window only decides which videos are ELIGIBLE. What ranks them is how fast each is being watched now, how much of the
 * channel's recent traffic its person has, how new it is and how much strong footage is left. Pure: no database.
 */
import { ageDays, LaneVideo, MIN_LONG_SEC, pickBackup } from './lanes';

/** A video is hot for this many days after it goes up (priority fades from day 7). */
export const HOT_DAYS = 15;
export const HOT_FULL_DAYS = 7;
/** A video needs this many strong unused moments before a campaign is built on it. */
export const HOT_MIN_STRONG = 3;
/** Below this many strong moments over all hot videos the day falls back to the topic brain (the old way). */
export const HOT_MIN_SUPPLY = 6;
/** Views per day under which a video is not what the audience is watching. */
export const HOT_MIN_VELOCITY = 150;
/** A group scoring under this share of the best group does not take a slot from the archive topic. */
export const HOT_MIN_RELATIVE = 0.3;
/** Reels one hot campaign makes at most, and videos it is built from (the director reviews the best moments, so more videos cost little). */
export const HOT_MAX_GROUP_REELS = 3;
export const HOT_MAX_SEEDS = 5;
/** Strong moments one reel is assumed to use up. */
const MOMENTS_PER_REEL = 2;
/** Each extra reel given to the same group is worth this much less (variety across stories). */
const REPEAT_DECAY = 0.7;

/** 1 for the first week, fading to 0.55 on day 15, 0 after. */
export function hotRecency(age: number): number {
  if (!Number.isFinite(age) || age < 0 || age > HOT_DAYS) return 0;
  if (age <= HOT_FULL_DAYS) return 1;
  return 1 - ((age - HOT_FULL_DAYS) / (HOT_DAYS - HOT_FULL_DAYS)) * 0.45;
}

const headroom = (strong: number) => (strong >= 8 ? 1 : strong >= 5 ? 0.85 : strong >= HOT_MIN_STRONG ? 0.6 : 0);

/** How much a video deserves the day's reels. 0 = not hot. */
export function hotScore(v: LaneVideo, now: Date): number {
  const age = ageDays(v, now);
  const rec = hotRecency(age);
  if (!rec || !v.analyzed || v.durationSec < MIN_LONG_SEC) return 0;
  const velocity = v.views / Math.max(1.5, age);
  if (velocity < HOT_MIN_VELOCITY) return 0;
  const room = headroom(v.strongMoments);
  if (!room) return 0;
  const used = v.usedMoments >= 6 ? 0.6 : v.usedMoments >= 3 ? 0.85 : 1;
  return Math.log1p(velocity) * (1 + 2 * (v.demand ?? 0)) * rec * (age <= 3 ? 1.25 : 1) * room * used;
}

/** Reels one video can give in a day: a big one (30k+ views) two, any other one. */
export const hotVideoCap = (v: LaneVideo) => (v.views >= 30_000 ? 2 : 1);

export interface HotGroup {
  /** The person the videos are about (lowercase key), or the video id when none is known. */
  key: string;
  /** Seed videos of the campaign, best first. */
  videos: LaneVideo[];
  score: number;
  /** Most reels this group can give today. */
  capacity: number;
  /** Reels given to it (after planHot). */
  reels: number;
}

/** Hot videos of the catalog, best first. */
export function hotVideos(videos: LaneVideo[], now: Date): LaneVideo[] {
  return videos
    .map((v) => ({ v, s: hotScore(v, now) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.v);
}

/** Hot videos grouped by the person they are about; the videos of a group are cut across so the director has a real choice. */
export function hotGroups(videos: LaneVideo[], now: Date): HotGroup[] {
  const by = new Map<string, LaneVideo[]>();
  for (const v of hotVideos(videos, now)) {
    const k = v.entity || v.youtubeId;
    by.set(k, [...(by.get(k) ?? []), v]);
  }
  const groups: HotGroup[] = [];
  for (const [key, list] of by) {
    const seeds = list.slice(0, HOT_MAX_SEEDS);
    const scores = seeds.map((v) => hotScore(v, now));
    const score = scores[0] + 0.25 * scores.slice(1).reduce((a, b) => a + b, 0);
    const strong = seeds.reduce((a, v) => a + v.strongMoments, 0);
    const capacity = Math.max(1, Math.min(HOT_MAX_GROUP_REELS, seeds.reduce((a, v) => a + hotVideoCap(v), 0), Math.floor(strong / MOMENTS_PER_REEL)));
    groups.push({ key, videos: seeds, score, capacity, reels: 0 });
  }
  return groups.sort((a, b) => b.score - a.score);
}

/**
 * Shares `budget` reels among the hot groups: each reel goes to the group with the best score after a discount for the reels it already
 * has, so a huge story gets more reels but a second story still gets one. Empty when the hot videos hold too little strong footage
 * (HOT_MIN_SUPPLY): the day then runs the old way.
 */
export function planHot(videos: LaneVideo[], now: Date, budget: number): HotGroup[] {
  if (budget <= 0) return [];
  let groups = hotGroups(videos, now);
  if (!groups.length) return [];
  if (groups.reduce((a, g) => a + g.videos.reduce((x, v) => x + v.strongMoments, 0), 0) < HOT_MIN_SUPPLY) return [];
  groups = groups.filter((g) => g.score >= groups[0].score * HOT_MIN_RELATIVE);
  for (let i = 0; i < budget; i++) {
    const open = groups.filter((g) => g.reels < g.capacity);
    if (!open.length) break;
    const best = open.reduce((a, b) => (b.score / (1 + REPEAT_DECAY * b.reels) > a.score / (1 + REPEAT_DECAY * a.reels) ? b : a));
    best.reels++;
  }
  return groups.filter((g) => g.reels > 0);
}

/** The brief of a hot campaign: the newest videos, different incidents, the host's own words first. */
export function hotBrief(group: Pick<HotGroup, 'videos' | 'reels'>): string {
  const list = group.videos.map((v) => `"${v.title}"`).join('; ');
  return (
    `Make ${group.reels} reel${group.reels === 1 ? '' : 's'} from the host's newest videos, the ones his audience is watching right now: ${list}. ` +
    `Every reel must come from these videos. Each reel is a DIFFERENT incident or angle: never two reels about the same moment. The first line must be the ` +
    `host's own experience or the person's name in a concrete moment, then a hard verdict or a story told in full. Each reel must stand alone for a viewer ` +
    `who has not seen the video, and name the person or case in the first sentence.`
  );
}

/**
 * The day's backup in hot mode: hot videos first (whatever the day already used, except videos whose campaign failed), then the
 * strongest footage of any age. `failedToday` are the videos of today's failed campaigns: trying them again would fail the same way.
 */
export function pickHotBackup(videos: LaneVideo[], failedToday: Set<string>, now: Date, take = 3): LaneVideo[] {
  const hot = hotVideos(videos, now).filter((v) => !failedToday.has(v.youtubeId)).slice(0, take);
  if (hot.length >= take) return hot;
  return [...hot, ...pickBackup(videos, new Set([...failedToday, ...hot.map((v) => v.youtubeId)]), take - hot.length)];
}
