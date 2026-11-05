/**
 * The developer's daily health record of the reel pipeline: what the day produced and what went wrong, in plain words. Pure (no
 * database): OpsReportService gathers the numbers, this file turns them into the issue list. Never shown to the client.
 */
import { nyDate } from '../common/time';

export interface OpsReportBody {
  /** Reels the day should end with, and how many its daily campaigns made (queued, rendering, ready or posted). */
  target: number;
  made: number;
  run: { status: string | null; reason: string | null; topic: string | null; fallbacks: Array<{ name: string; reason: string }>; backup: 'none' | 'started' | 'nothing to use' };
  /** Every main topic tried today, with the mined moments that name its person (the evidence the brain used). */
  topics: Array<{ name: string; entity: string | null; footage: number; anchors: number; outcome: 'failed' | 'current' }>;
  campaigns: Array<{ track: string; name: string; status: string; target: number; reels: number; autoTopup: boolean; error: string | null }>;
  stuckSources: Array<{ youtubeId: string; title: string; stage: string; hours: number; views: number }>;
  failedSources: Array<{ youtubeId: string; title: string; error: string }>;
  downloads: { count: number; heights: Record<string, number>; lowRes: number };
  session: { status: string | null; cookiesUpdatedAt: Date | null; lastCheckAt: Date | null; lastError: string | null };
  renders: { failed: number; fullscreenFallbacks: Array<{ reelId: string; note: string }> };
  stock: { todo: number; queuedPosts: number; daysLeft: number };
  posting: { published: number; failed: Array<{ postId: string; errorCode: string | null; error: string }> };
  /** Spend on today's campaigns that produced no reel at all. */
  wasted: { promptTokens: number; sttMinutes: number };
  /**
   * The reels-vs-main-channel test (from Nov 6 2026: 2 reels a day instead of 5). The long videos of the last 14 days with their
   * views as of this report; one report a day, so a video's day-3 and day-7 views can be read off the reports of those days.
   */
  mainChannel?: Array<{ youtubeId: string; title: string; ageDays: number; views: number; viewsPerDay: number }>;
}

/** Posts per day the stock has to cover when the auto-publish slots are unknown (2 slots since Nov 6 2026). */
export const POSTS_PER_DAY = 2;

/** "12.3k" style for the one-line report. */
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
export const COOKIE_MAX_AGE_DAYS = 14;

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The day's problems in plain words, most important first. Empty means a healthy day. */
export function opsIssues(b: OpsReportBody, now: Date = new Date()): string[] {
  const out: string[] = [];
  if (b.made === 0) out.push(`NO reels were made today (target ${b.target})`);
  else if (b.made < b.target) out.push(`Only ${b.made} of ${b.target} reels were made today`);

  for (const t of b.topics) if (t.entity && t.footage === 0) out.push(`Main topic "${t.name}" had no mined footage naming ${t.entity}`);
  if (b.run.fallbacks.length) out.push(`${b.run.fallbacks.length} main topic(s) failed and were replaced: ${b.run.fallbacks.map((f) => `"${f.name}" (${cut(f.reason, 90)})`).join('; ')}`);
  if (b.run.backup === 'started') out.push('The day fell short, so a backup campaign from older footage was started');
  if (b.run.backup === 'nothing to use') out.push('The day fell short and no older video had enough strong footage for a backup');
  for (const c of b.campaigns) if (c.status === 'failed') out.push(`${c.track} campaign "${cut(c.name, 60)}" failed: ${cut(c.error ?? 'no reason recorded', 160)}`);

  for (const s of b.stuckSources) out.push(`Video ${s.youtubeId} (${s.views} views, "${cut(s.title, 50)}") stuck in ${s.stage} for ${s.hours}h`);
  for (const s of b.failedSources) out.push(`Video ${s.youtubeId} could not be used: ${cut(s.error, 120)}`);

  if (b.downloads.count && b.downloads.lowRes === b.downloads.count) out.push(`All ${b.downloads.count} downloads today were below 720p: the YouTube session (cookies) probably needs a refresh`);
  else if (b.downloads.lowRes) out.push(`${b.downloads.lowRes} of ${b.downloads.count} downloads today were below 720p`);
  if (b.session.lastError && /sign in|not a bot|login/i.test(b.session.lastError)) out.push(`YouTube session check is failing ("${cut(b.session.lastError, 90)}"): import fresh cookies`);
  if (b.session.cookiesUpdatedAt) {
    const age = Math.floor((now.getTime() - new Date(b.session.cookiesUpdatedAt).getTime()) / 86_400_000);
    if (age > COOKIE_MAX_AGE_DAYS) out.push(`YouTube cookies are ${age} days old`);
  }

  if (b.renders.failed) out.push(`${b.renders.failed} reel render(s) failed`);
  if (b.renders.fullscreenFallbacks.length) out.push(`${b.renders.fullscreenFallbacks.length} reel(s) fell back to the classic look after a full-screen render error: ${cut(b.renders.fullscreenFallbacks[0].note, 200)}`);

  if (b.stock.daysLeft < 2) out.push(`Low stock: ${b.stock.todo} finished reels (${b.stock.queuedPosts} already queued), about ${b.stock.daysLeft} day(s) of posts`);
  if (b.posting.failed.length) out.push(`${b.posting.failed.length} post(s) failed: ${b.posting.failed.map((p) => p.errorCode ?? cut(p.error, 60)).join(', ')}`);
  if (b.wasted.promptTokens >= 200_000) out.push(`${Math.round(b.wasted.promptTokens / 1000)}k prompt tokens and ${b.wasted.sttMinutes} min of speech-to-text went into campaigns that made nothing`);
  return out;
}

/** The UTC instants where a New York calendar day starts and ends (handles the daylight-saving switch days). */
export function nyDayRange(date: string): { start: Date; end: Date } {
  const startOf = (d: string) => {
    const base = Date.parse(`${d}T00:00:00Z`);
    for (let h = 0; h <= 8; h++) {
      const t = new Date(base + h * 3_600_000);
      if (nyDate(t) === d && nyDate(new Date(t.getTime() - 3_600_000)) !== d) return t;
    }
    return new Date(base + 5 * 3_600_000);
  };
  const next = new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return { start: startOf(date), end: startOf(next) };
}

/** One readable block per report, for the `ops:report` command. */
export function formatOpsReport(r: { date: string; issues: string[]; body: OpsReportBody }): string {
  const b = r.body;
  const lanes = b.campaigns.map((c) => `${c.track} ${c.reels}/${c.target} ${c.status}${c.autoTopup ? ' (auto top-up)' : ''}`).join(', ') || 'no campaigns';
  const heights = Object.entries(b.downloads.heights).map(([h, n]) => `${h}p×${n}`).join(' ') || 'none';
  const main = (b.mainChannel ?? []).map((v) => `${cut(v.title, 28)} d${v.ageDays} ${k(v.views)} (${k(v.viewsPerDay)}/day)`).join('; ');
  return [
    `=== ${r.date}: ${b.made}/${b.target} reels | ${lanes}`,
    `    topic: ${b.run.topic ?? '-'} | stock ${b.stock.todo} (~${b.stock.daysLeft}d) | posted ${b.posting.published} | downloads ${heights}`,
    ...(main ? [`    main channel: ${main}`] : []),
    ...(r.issues.length ? r.issues.map((i) => `    ! ${i}`) : ['    ok: no issues']),
  ].join('\n');
}
