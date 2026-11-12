import { alertsFor, AlertState, dueAlerts, REPEAT_HOURS } from './alerts';
import { givesUpWaiting, PREPARE_GIVE_UP_MS, PREPARE_GIVE_UP_ONE_MS } from '../queue/orchestrator.service';

const ok = (): AlertState => ({
  nyHour: 17,
  session: { status: 'ok', lastError: null },
  downloadsPaused: false,
  today: { made: 3, target: 3, working: false, runStatus: 'started' },
  autoPublish: { enabled: true, pausedReason: null },
  failedPostsToday: 0,
  stock: { todo: 9, queuedPosts: 2, postsPerDay: 3 },
  stuckCampaigns: 0,
});

describe('developer alerts (Nov 13 audit: 8 days of stopped downloads went unnoticed)', () => {
  it('a healthy day sends nothing', () => {
    expect(alertsFor(ok())).toEqual([]);
  });

  it('names the problems of Nov 5-12', () => {
    const s = ok();
    s.session = { status: 'needs_login', lastError: 'Sign in to confirm you are not a bot' };
    s.downloadsPaused = true;
    s.today = { made: 0, target: 2, working: false, runStatus: 'started' };
    s.stuckCampaigns = 1;
    s.stock = { todo: 1, queuedPosts: 1, postsPerDay: 3 };
    const keys = alertsFor(s).map((a) => a.key);
    expect(keys).toEqual(['downloads-stopped', 'no-reels-today', 'stuck-campaigns', 'low-stock']);
    expect(alertsFor(s)[0].text).toMatch(/Settings > Reel downloader/);
  });

  it('does not cry wolf in the morning or while campaigns are working', () => {
    const s = ok();
    s.today = { made: 0, target: 3, working: false, runStatus: 'started' };
    expect(alertsFor({ ...s, nyHour: 9 }).map((a) => a.key)).toEqual([]);
    expect(alertsFor({ ...s, today: { ...s.today, working: true } }).map((a) => a.key)).toEqual([]);
    expect(alertsFor({ ...s, nyHour: 21, today: { made: 1, target: 3, working: false, runStatus: 'started' } }).map((a) => a.key)).toEqual(['short-day']);
  });

  it('sends the same problem at most once per 12 hours', () => {
    const now = new Date('2026-11-13T15:00:00Z');
    const a = [{ key: 'downloads-stopped', text: 'x' }];
    expect(dueAlerts(a, {}, now)).toHaveLength(1);
    expect(dueAlerts(a, { 'downloads-stopped': new Date(now.getTime() - 3_600_000) }, now)).toHaveLength(0);
    expect(dueAlerts(a, { 'downloads-stopped': new Date(now.getTime() - REPEAT_HOURS * 3_600_000) }, now)).toHaveLength(1);
  });
});

describe('a preparing campaign stops waiting (Nov 8, 10, 11: 3 of 4 videos ready, 0 reels)', () => {
  it('goes ahead after 3 h with two ready videos, after 6 h with one, never with none', () => {
    expect(givesUpWaiting(3, PREPARE_GIVE_UP_MS - 1)).toBe(false);
    expect(givesUpWaiting(3, PREPARE_GIVE_UP_MS)).toBe(true);
    expect(givesUpWaiting(1, PREPARE_GIVE_UP_MS)).toBe(false);
    expect(givesUpWaiting(1, PREPARE_GIVE_UP_ONE_MS)).toBe(true);
    expect(givesUpWaiting(0, 10 * PREPARE_GIVE_UP_ONE_MS)).toBe(false);
  });
});
