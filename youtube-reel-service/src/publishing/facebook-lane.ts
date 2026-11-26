/**
 * The Facebook lanes' rules (client decision 2026-11-23), kept pure so they can be tested without a database.
 *
 * Facebook gets up to 5 reels a day:
 *  - NEW lane (3): every reel that goes out on YouTube is mirrored at the same moment (YouTube is 2 a day), plus one extra new reel;
 *  - BACKLOG lane (2): reels published on YouTube in the last 30 days that are not on Facebook yet, newest first.
 * When the backlog is used up Facebook is just the 3 new a day. Nothing here touches YouTube.
 */
import { nyToUtc, parseSlot, validSlot } from './auto-plan';
import type { PostMetadata } from './types';

export interface LaneConfig {
  enabled: boolean;
  newPerDay: number;
  backlogPerDay: number;
  backlogDays: number;
  extraSlot: string;
  backlogSlots: string[];
  /** Which old reel goes next: 'retention' = the ones YouTube viewers watched most first; 'newest' = newest first (the original order). */
  backlogOrder: 'newest' | 'retention';
  /** Hard cap on lane posts per New York day (new + backlog). */
  dailyCap: number;
}

export function laneConfig(env: {
  FACEBOOK_AUTO?: string;
  FACEBOOK_NEW_PER_DAY?: number;
  FACEBOOK_BACKLOG_PER_DAY?: number;
  FACEBOOK_BACKLOG_DAYS?: number;
  FACEBOOK_EXTRA_SLOT_ET?: string;
  FACEBOOK_BACKLOG_SLOTS_ET?: string;
  FACEBOOK_BACKLOG_ORDER?: string;
}): LaneConfig {
  const clamp = (n: number | undefined, def: number, max: number) => (Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n as number))) : def);
  const newPerDay = clamp(env.FACEBOOK_NEW_PER_DAY, 3, 10);
  const backlogPerDay = clamp(env.FACEBOOK_BACKLOG_PER_DAY, 2, 10);
  const slot = (x: string) => parseSlot(x.trim()) ?? x.trim();
  const backlogSlots = [...new Set(String(env.FACEBOOK_BACKLOG_SLOTS_ET ?? '12:30,18:30').split(',').map(slot).filter(validSlot))].sort();
  const extra = slot(env.FACEBOOK_EXTRA_SLOT_ET ?? '15:00');
  return {
    enabled: (env.FACEBOOK_AUTO ?? 'on') !== 'off',
    newPerDay,
    backlogPerDay,
    backlogDays: Math.max(1, clamp(env.FACEBOOK_BACKLOG_DAYS, 30, 365)),
    extraSlot: validSlot(extra) ? extra : '15:00',
    backlogSlots: backlogSlots.length ? backlogSlots : ['12:30', '18:30'],
    backlogOrder: env.FACEBOOK_BACKLOG_ORDER === 'newest' ? 'newest' : 'retention',
    dailyCap: newPerDay + backlogPerDay,
  };
}

/** Lane posts made today, by lane. */
export interface DayCounts {
  mirror: number;
  extra: number;
  backlog: number;
}
export const totalOf = (c: DayCounts) => c.mirror + c.extra + c.backlog;

export function countsOf(sources: string[], prefix: 'fb' | 'ig' = 'fb'): DayCounts {
  return {
    mirror: sources.filter((s) => s === `${prefix}-mirror`).length,
    extra: sources.filter((s) => s === `${prefix}-extra`).length,
    backlog: sources.filter((s) => s === `${prefix}-backlog`).length,
  };
}

/** What each lane may still add today. The hard cap applies to all of them together. */
export function laneCaps(c: LaneConfig, counts: DayCounts): { mirror: boolean; extra: boolean; backlog: boolean } {
  const room = totalOf(counts) < c.dailyCap;
  return {
    mirror: room,
    // one extra a day, and mirrors + the extra stay inside the new-reel share
    extra: room && counts.extra < 1 && counts.mirror + counts.extra < c.newPerDay,
    backlog: room && counts.backlog < c.backlogPerDay,
  };
}

export interface LaneSlot {
  /** Stable, safe as a Mongo field name. */
  id: string;
  kind: 'backlog' | 'extra';
  time: string;
}

/** The day's planned slots in time order: the backlog slots (up to the backlog share) and the one extra slot. */
export function laneSlots(c: LaneConfig): LaneSlot[] {
  const id = (kind: string, t: string) => `${kind}-${t.replace(/\D/g, '')}`;
  const slots: LaneSlot[] = [
    ...c.backlogSlots.slice(0, c.backlogPerDay).map((t): LaneSlot => ({ id: id('backlog', t), kind: 'backlog', time: t })),
    ...(c.newPerDay > 0 ? [{ id: id('extra', c.extraSlot), kind: 'extra' as const, time: c.extraSlot }] : []),
  ];
  return slots.sort((a, b) => a.time.localeCompare(b.time));
}

/** How long before its time a slot's post is created (it then waits in our queue and is jittered like the YouTube lane). */
export const PLAN_AHEAD_MIN = 45;

/** Slots whose planning window has opened and that nobody has claimed yet today. */
export function dueSlots(date: string, now: Date, slots: LaneSlot[], claimed: Iterable<string>, aheadMin = PLAN_AHEAD_MIN): LaneSlot[] {
  const taken = new Set(claimed);
  return slots.filter((s) => !taken.has(s.id) && now.getTime() >= nyToUtc(date, s.time).getTime() - aheadMin * 60_000);
}

export interface BacklogRow {
  reelId: string;
  publishedAt: Date;
  /** YouTube's lifetime average view percentage for the reel; null/undefined when YouTube has no usable numbers for it yet. */
  retention?: number | null;
}

/** A reel below this share of its length watched on YouTube goes to the END of the backlog (still used once the rest is gone). */
export const RETENTION_FLOOR_PCT = 60;
/** Fewer YouTube views than this and the retention number is noise: the reel counts as "no numbers yet". */
export const RETENTION_MIN_VIEWS = 300;

/**
 * The backlog in the order it will be used: reels with a YouTube post published inside the window, each reel once, leaving out reels
 * that already have a Facebook post of any kind.
 *  - 'newest' (the original order): newest first.
 *  - 'retention': reels YouTube viewers watched most first (average view % at or above the floor, highest first, newest first on ties),
 *    then reels with no usable numbers yet (newest first), then clearly weak reels (below the floor) last. It is a tilt, not a filter:
 *    nothing is ever dropped, and with no numbers at all it behaves exactly like 'newest'.
 */
export function backlogOrder<T extends BacklogRow>(rows: T[], onFacebook: Set<string>, now: Date, days: number, mode: 'newest' | 'retention' = 'newest'): T[] {
  const since = now.getTime() - days * 86_400_000;
  const seen = new Set<string>();
  const newestFirst = [...rows]
    .filter((r) => r.publishedAt.getTime() >= since && r.publishedAt.getTime() <= now.getTime() + 60_000)
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    .filter((r) => {
      if (onFacebook.has(r.reelId) || seen.has(r.reelId)) return false;
      seen.add(r.reelId);
      return true;
    });
  if (mode !== 'retention') return newestFirst;
  const known = (r: T): r is T & { retention: number } => typeof r.retention === 'number' && Number.isFinite(r.retention);
  const strong = newestFirst.filter((r) => known(r) && r.retention >= RETENTION_FLOOR_PCT).sort((a, b) => (b.retention as number) - (a.retention as number));
  const unknown = newestFirst.filter((r) => !known(r));
  const weak = newestFirst.filter((r) => known(r) && r.retention < RETENTION_FLOOR_PCT);
  return [...strong, ...unknown, ...weak];
}

export interface LanePostRow {
  status: string;
  errorCode?: string | null;
  error?: string | null;
  warnings?: string[];
}

const AUTH_TROUBLE = /needs_reconnect|permission|oauth|token|auth/i;
const RIGHTS_TROUBLE = /copyright|rights|violat|restrict|flagged|blocked/i;

/**
 * Why the Facebook lane should stop by itself (null = carry on). Looks at today's lane posts only:
 *  - a login or permission error means nothing will post until Facebook is reconnected;
 *  - two rejections or rights flags in a day means Facebook does not like what we are sending.
 */
export function laneTrouble(rows: LanePostRow[]): string | null {
  const authErr = rows.find((p) => (p.status === 'blocked' || p.status === 'failed') && AUTH_TROUBLE.test(String(p.errorCode ?? '')));
  if (authErr) return 'Facebook refused the login or a permission: reconnect Facebook in the app Settings';
  const flagged = rows.filter(
    (p) => p.status === 'removed' || (p.status === 'failed' && ['rejected', 'media'].includes(String(p.errorCode ?? ''))) || (p.warnings ?? []).some((w) => RIGHTS_TROUBLE.test(w)),
  );
  if (flagged.length >= 2) return `Facebook rejected or flagged ${flagged.length} reels today`;
  return null;
}

/** The metadata a Facebook post copies from a reel's YouTube post (the Facebook caption itself is built by the publisher). */
export function facebookMetadata(m: Partial<PostMetadata>): Partial<PostMetadata> {
  return {
    title: m.title,
    description: m.description,
    tags: m.tags,
    hashtags: (m.hashtags ?? []).filter((h) => String(h).replace(/^#+/, '').toLowerCase() !== 'shorts'),
    categoryId: m.categoryId,
    madeForKids: false,
    containsSyntheticMedia: m.containsSyntheticMedia ?? false,
    notifySubscribers: false,
  };
}
