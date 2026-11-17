/**
 * Hot videos: the newest long videos get the day's reels first (Nov 17 2026 audit, rebuilt the same day after the client's point that a
 * trending topic is not the same as a long video with many views).
 *
 * Why: reels cut from a video under 3 days old earned a median 2,289 views at 48 h against about 1,200 for older footage; the three
 * live streams of Nov 11-15 (51k, 42k, 36k views) got 1-2 reels each because the daily topic was chosen from the whole archive on how
 * much footage it had, and the lane built for new videos had been switched off.
 *
 * RECENCY decides who is eligible: every analyzed long video of the last 15 days, whatever its views. What ranks them is recency first,
 * then how much attention the topic has (views per day, the audience share of its person, a current trend: the best of the three),
 * how much strong footage is left, and a fair share: a recent video with no reel yet goes before one that already gave several.
 * How much views count is learned from the channel's own reels (hotCheck in publishing/appeal-model.ts). Pure: no database.
 */
import { ageDays, LaneVideo, MIN_LONG_SEC, pickBackup } from './lanes';

/** A video is hot for this many days after it goes up (priority fades from day 7). */
export const HOT_DAYS = 15;
export const HOT_FULL_DAYS = 7;
/** A video newer than this gets the relaxed opening rules (the story is current: the viewers know who it is about). */
export const RELAXED_DAYS = 7;
/** A video needs this many strong unused moments before a campaign is built on it. */
export const HOT_MIN_STRONG = 3;
/** Below this many strong moments over all hot videos the day falls back to the topic brain (the old way). */
export const HOT_MIN_SUPPLY = 6;
/** A group scoring under this share of the best group does not take a slot from the archive topic. */
export const HOT_MIN_RELATIVE = 0.3;
/** Of the day's reels this many always come from hot videos (new-video lane included); one more when something is strongly hot. */
export const HOT_RESERVED = 2;
/** A video whose topic has this much attention (0..1) is strongly hot: it earns the day's third reel. */
export const STRONG_INTEREST = 0.75;
/** Reels one hot campaign makes at most, and videos it is built from (the director reviews the best moments, so more videos cost little). */
export const HOT_MAX_GROUP_REELS = 3;
export const HOT_MAX_SEEDS = 5;
/** How much of a hot score is the topic's attention rather than recency (learned: hotCheck raises it when views predict reel views). */
export const DEFAULT_INTEREST_WEIGHT = 0.4;
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
/** A video nobody has cut yet goes first; one already mined a lot gives way. */
const coverage = (used: number) => (used === 0 ? 1.25 : used <= 2 ? 1 : used <= 5 ? 0.8 : 0.6);

/**
 * 0..1: how much attention the video's topic has right now, the best of: its views per day (10,000 a day = 1), the audience's share
 * for the person it is about (the channel's own last-3-day traffic, 25% = 1) and a match with a current trend. A normal-view video on a
 * trending topic counts as hot even though its own views are low.
 */
export function interest(v: LaneVideo, now: Date): number {
  const age = ageDays(v, now);
  const velocity = v.views / Math.max(1.5, Number.isFinite(age) ? age : 1.5);
  const views = Math.min(1, Math.log1p(velocity) / Math.log1p(10_000));
  const audience = Math.min(1, Math.max(0, v.demand ?? 0) / 0.25);
  const trend = Math.min(1, Math.max(0, v.trend ?? 0));
  return Math.max(views, audience, trend);
}

/** How much a video deserves the day's reels. 0 = not hot (too old, not analyzed, too short or no strong footage left). */
export function hotScore(v: LaneVideo, now: Date, interestWeight = DEFAULT_INTEREST_WEIGHT): number {
  const age = ageDays(v, now);
  const rec = hotRecency(age);
  if (!rec || !v.analyzed || v.durationSec < MIN_LONG_SEC) return 0;
  const room = headroom(v.strongMoments);
  if (!room) return 0;
  const w = Math.max(0, Math.min(1, interestWeight));
  return rec * (age <= 3 ? 1.3 : 1) * (1 - w + w * interest(v, now)) * room * coverage(v.usedMoments);
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
export function hotVideos(videos: LaneVideo[], now: Date, interestWeight = DEFAULT_INTEREST_WEIGHT): LaneVideo[] {
  return videos
    .map((v) => ({ v, s: hotScore(v, now, interestWeight) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.v);
}

/** Hot videos grouped by the person they are about; the videos of a group are cut across so the director has a real choice. */
export function hotGroups(videos: LaneVideo[], now: Date, interestWeight = DEFAULT_INTEREST_WEIGHT): HotGroup[] {
  const by = new Map<string, LaneVideo[]>();
  for (const v of hotVideos(videos, now, interestWeight)) {
    const k = v.entity || v.youtubeId;
    by.set(k, [...(by.get(k) ?? []), v]);
  }
  const groups: HotGroup[] = [];
  for (const [key, list] of by) {
    const seeds = list.slice(0, HOT_MAX_SEEDS);
    const scores = seeds.map((v) => hotScore(v, now, interestWeight));
    const score = scores[0] + 0.25 * scores.slice(1).reduce((a, b) => a + b, 0);
    const strong = seeds.reduce((a, v) => a + v.strongMoments, 0);
    const capacity = Math.max(1, Math.min(HOT_MAX_GROUP_REELS, seeds.reduce((a, v) => a + hotVideoCap(v), 0), Math.floor(strong / MOMENTS_PER_REEL)));
    groups.push({ key, videos: seeds, score, capacity, reels: 0 });
  }
  return groups.sort((a, b) => b.score - a.score);
}

const supply = (groups: HotGroup[]) => groups.reduce((a, g) => a + g.videos.reduce((x, v) => x + v.strongMoments, 0), 0);

/** Gives `budget` reels to the groups, one at a time, to the group with the best score after a discount for the reels it already has. */
function allocate(all: HotGroup[], budget: number): HotGroup[] {
  const groups = all.filter((g) => g.score >= all[0].score * HOT_MIN_RELATIVE);
  for (let i = 0; i < budget; i++) {
    const open = groups.filter((g) => g.reels < g.capacity);
    if (!open.length) break;
    const best = open.reduce((a, b) => (b.score / (1 + REPEAT_DECAY * b.reels) > a.score / (1 + REPEAT_DECAY * a.reels) ? b : a));
    best.reels++;
  }
  return groups.filter((g) => g.reels > 0);
}

/**
 * Shares `budget` reels among the hot groups: a huge story gets more reels but a second story still gets one. Empty when the hot
 * videos hold too little strong footage (HOT_MIN_SUPPLY): the day then runs the old way.
 */
export function planHot(videos: LaneVideo[], now: Date, budget: number, interestWeight = DEFAULT_INTEREST_WEIGHT): HotGroup[] {
  if (budget <= 0) return [];
  const groups = hotGroups(videos, now, interestWeight);
  if (!groups.length || supply(groups) < HOT_MIN_SUPPLY) return [];
  return allocate(groups, budget);
}

/**
 * The day's hot allocation: HOT_RESERVED reels of the `target` always come from hot videos (the new-video lane's reels count), and one
 * more when something is strongly hot (STRONG_INTEREST). What this leaves goes to the topic brain.
 */
export function planHotDay(videos: LaneVideo[], now: Date, input: { target: number; newsReels: number; interestWeight?: number }): { groups: HotGroup[]; hotTarget: number; strong: boolean } {
  const w = input.interestWeight ?? DEFAULT_INTEREST_WEIGHT;
  const groups = hotGroups(videos, now, w);
  const strong = groups.some((g) => g.videos.some((v) => interest(v, now) >= STRONG_INTEREST));
  const hotTarget = Math.min(input.target, HOT_RESERVED + (strong ? 1 : 0));
  const budget = Math.max(0, hotTarget - input.newsReels);
  if (!budget || !groups.length || supply(groups) < HOT_MIN_SUPPLY) return { groups: [], hotTarget, strong };
  return { groups: allocate(groups, budget), hotTarget, strong };
}

/** The brief of a hot campaign: the newest videos, different incidents, a clear first sentence. */
export function hotBrief(group: Pick<HotGroup, 'videos' | 'reels'>): string {
  const list = group.videos.map((v) => `"${v.title}"`).join('; ');
  return (
    `Make ${group.reels} reel${group.reels === 1 ? '' : 's'} from the host's newest videos, the ones his audience is watching right now: ${list}. ` +
    `Every reel must come from these videos. Each reel is a DIFFERENT incident or angle: never two reels about the same moment. Open on a ` +
    `complete, concrete sentence about the incident or the host's own experience, then a hard verdict or a story told in full. Each reel must ` +
    `stand alone for a viewer who has not seen the video.`
  );
}

/** Does a campaign built on these videos use the relaxed opening rules? Only when its best (first) video is under RELAXED_DAYS old. */
export const isRelaxedCampaign = (picks: LaneVideo[], now: Date) => !!picks.length && ageDays(picks[0], now) <= RELAXED_DAYS;

/**
 * The day's backup in hot mode: hot videos first (whatever the day already used, except videos whose campaign failed), then the
 * strongest footage of any age. `failedToday` are the videos of today's failed campaigns: trying them again would fail the same way.
 */
export function pickHotBackup(videos: LaneVideo[], failedToday: Set<string>, now: Date, take = 3, interestWeight = DEFAULT_INTEREST_WEIGHT): LaneVideo[] {
  const hot = hotVideos(videos, now, interestWeight).filter((v) => !failedToday.has(v.youtubeId)).slice(0, take);
  if (hot.length >= take) return hot;
  return [...hot, ...pickBackup(videos, new Set([...failedToday, ...hot.map((v) => v.youtubeId)]), take - hot.length)];
}
