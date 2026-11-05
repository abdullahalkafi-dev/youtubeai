/**
 * Comment auto-reply lanes (Nov 6 2026, client ask: "the main 3 recent long-form videos must always be
 * responded to"). Reels uploaded as Shorts had taken 8 of the 10 reply slots and pushed the long videos out.
 *
 * - Two lists: up to 10 long videos and up to 10 Shorts. A Short never takes a long video's slot.
 * - Two round robins, both stepping every 15-minute tick:
 *     lane A ("top")   = the 3 newest long videos       -> each checked every 45 min
 *     lane B ("other") = the other long videos + Shorts -> each checked about every 4 h
 * - One shared daily reply cap. Lane B stops at OTHER_LANE_DAILY_CAP so the top 3 always keep some replies.
 */

export const SHORT_MAX_SECONDS = 180;
export const TOP_LANE_SIZE = 3;

export type ReplyKind = 'long' | 'short';
export type ReplyLane = 'top' | 'other';

export interface LaneVideo {
  _id: unknown;
  durationSeconds?: number | null;
  publishedAt?: Date | string | null;
  autoReplyLastRanAt?: Date | string | null;
}

/** A Short is 1-180 s. An unknown length counts as long, so a long video is never pushed out by mistake. */
export function replyKind(v: { durationSeconds?: number | null }): ReplyKind {
  const d = Number(v.durationSeconds ?? 0);
  return d > 0 && d <= SHORT_MAX_SECONDS ? 'short' : 'long';
}

const ms = (d?: Date | string | null) => {
  if (!d) return 0;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : 0;
};

const newestFirst = <T extends LaneVideo>(a: T, b: T) => ms(b.publishedAt) - ms(a.publishedAt) || String(b._id).localeCompare(String(a._id));

/** Split the active set into lane A (3 newest long videos) and lane B (everything else). */
export function splitLanes<T extends LaneVideo>(active: T[], topSize = TOP_LANE_SIZE): { top: T[]; other: T[] } {
  const long = active.filter((v) => replyKind(v) === 'long').sort(newestFirst);
  const top = long.slice(0, topSize);
  const topIds = new Set(top.map((v) => String(v._id)));
  return { top, other: active.filter((v) => !topIds.has(String(v._id))) };
}

/** Round robin within a lane: the video checked longest ago (never checked = first); ties go to the newest upload. */
export function nextInLane<T extends LaneVideo>(lane: T[]): T | undefined {
  return [...lane].sort((a, b) => ms(a.autoReplyLastRanAt) - ms(b.autoReplyLastRanAt) || newestFirst(a, b))[0];
}

/** Replies lane B may still post today: it stops at its own cap so lane A keeps the rest of the day's replies. */
export function otherLaneRemaining(todayCount: number, dailyCap: number, otherCap: number): number {
  return Math.max(0, Math.min(dailyCap, otherCap) - todayCount);
}
