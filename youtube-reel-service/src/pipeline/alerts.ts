/**
 * Developer alerts (Nov 13 2026 audit: downloads were stopped for 8 days and three days made 0 reels; the ops report said so every
 * day, but nobody reads a report). These rules turn the pipeline's state into a few plain messages that are PUSHED to the developer
 * (ALERT_WEBHOOK_URL). Never shown to the client. Pure: AlertService gathers the state.
 */

export interface AlertState {
  /** New York hour now (0-23). */
  nyHour: number;
  session: { status: string | null; lastError: string | null };
  downloadsPaused: boolean;
  /** Reels today's daily campaigns made so far, the day's target, and whether any of them is still working. */
  today: { made: number; target: number; working: boolean; runStatus: string | null };
  autoPublish: { enabled: boolean; pausedReason: string | null };
  failedPostsToday: number;
  stock: { todo: number; queuedPosts: number; postsPerDay: number };
  /** Daily campaigns stuck in "preparing" for more than 6 hours. */
  stuckCampaigns: number;
}

export interface Alert {
  /** Stable key: the same problem is sent at most once per REPEAT_HOURS. */
  key: string;
  text: string;
}

/** The same alert is not sent again within this many hours. */
export const REPEAT_HOURS = 12;

export function alertsFor(s: AlertState): Alert[] {
  const out: Alert[] = [];
  if (s.session.status !== 'ok' || s.downloadsPaused) {
    out.push({
      key: 'downloads-stopped',
      text: `Reel downloads are STOPPED: YouTube rejected the downloader login${s.session.lastError ? ` ("${s.session.lastError.slice(0, 90)}")` : ''}. Fix: export fresh cookies from a private window, close it, paste in Settings > Reel downloader.`,
    });
  }
  // By 4 PM New York the day's campaigns have had 12 hours: a day still at 0 with nothing working is a broken day.
  if (s.nyHour >= 16 && s.today.made === 0 && !s.today.working) {
    out.push({ key: 'no-reels-today', text: `NO reels were made today (target ${s.today.target}; daily run: ${s.today.runStatus ?? 'did not run'}). Check: ops:report 1` });
  } else if (s.nyHour >= 20 && s.today.made < s.today.target && !s.today.working) {
    out.push({ key: 'short-day', text: `Only ${s.today.made} of ${s.today.target} reels were made today. Check: ops:report 1` });
  }
  if (s.stuckCampaigns > 0) out.push({ key: 'stuck-campaigns', text: `${s.stuckCampaigns} daily campaign(s) stuck preparing for over 6 hours.` });
  if (s.autoPublish.enabled && s.autoPublish.pausedReason) out.push({ key: 'autopublish-paused', text: `Auto-publish paused itself: ${s.autoPublish.pausedReason.slice(0, 160)}` });
  if (s.failedPostsToday > 0) out.push({ key: 'posts-failed', text: `${s.failedPostsToday} reel post(s) failed to upload today.` });
  const days = Math.floor(Math.max(0, s.stock.todo - s.stock.queuedPosts) / Math.max(1, s.stock.postsPerDay));
  if (days < 1) out.push({ key: 'low-stock', text: `Reel stock is almost empty: ${s.stock.todo} finished reels, ${s.stock.queuedPosts} already queued (under a day of posts).` });
  return out;
}

/** Alerts not sent in the last REPEAT_HOURS (sent: key -> last sent time). */
export function dueAlerts(alerts: Alert[], sent: Record<string, string | Date>, now: Date): Alert[] {
  return alerts.filter((a) => {
    const last = sent[a.key] ? new Date(sent[a.key]).getTime() : 0;
    return now.getTime() - last >= REPEAT_HOURS * 3_600_000;
  });
}
