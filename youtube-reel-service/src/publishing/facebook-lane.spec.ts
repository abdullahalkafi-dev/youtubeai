import { backlogOrder, countsOf, dueSlots, facebookMetadata, laneCaps, laneConfig, laneSlots, laneTrouble, totalOf } from './facebook-lane';
import { nyToUtc } from './auto-plan';

const at = (date: string, hhmm: string) => nyToUtc(date, hhmm);
const DATE = '2026-11-24';

describe('laneConfig', () => {
  it('has the client defaults: 3 new + 2 backlog a day, 30 days, 15:00 extra, 12:30 and 18:30 backlog', () => {
    const c = laneConfig({});
    expect(c).toMatchObject({ enabled: true, newPerDay: 3, backlogPerDay: 2, backlogDays: 30, extraSlot: '15:00', backlogSlots: ['12:30', '18:30'], dailyCap: 5 });
  });
  it('FACEBOOK_AUTO=off is the kill switch, and bad values fall back to safe ones', () => {
    expect(laneConfig({ FACEBOOK_AUTO: 'off' }).enabled).toBe(false);
    const c = laneConfig({ FACEBOOK_EXTRA_SLOT_ET: 'nonsense', FACEBOOK_BACKLOG_SLOTS_ET: 'x,y', FACEBOOK_NEW_PER_DAY: Number.NaN });
    expect(c.extraSlot).toBe('15:00');
    expect(c.backlogSlots).toEqual(['12:30', '18:30']);
    expect(c.newPerDay).toBe(3);
  });
  it('the hard daily cap is new + backlog and follows the env', () => {
    expect(laneConfig({ FACEBOOK_NEW_PER_DAY: 4, FACEBOOK_BACKLOG_PER_DAY: 1 }).dailyCap).toBe(5);
    expect(laneConfig({ FACEBOOK_NEW_PER_DAY: 2, FACEBOOK_BACKLOG_PER_DAY: 2 }).dailyCap).toBe(4);
  });
});

describe('laneCaps (3 new + 2 backlog, 5 in all)', () => {
  const c = laneConfig({});
  it('an empty day allows everything', () => {
    expect(laneCaps(c, { mirror: 0, extra: 0, backlog: 0 })).toEqual({ mirror: true, extra: true, backlog: true });
  });
  it('two mirrors still leave room for the one extra; three mirrors do not', () => {
    expect(laneCaps(c, { mirror: 2, extra: 0, backlog: 0 }).extra).toBe(true);
    expect(laneCaps(c, { mirror: 3, extra: 0, backlog: 0 }).extra).toBe(false);
  });
  it('only one extra a day', () => {
    expect(laneCaps(c, { mirror: 0, extra: 1, backlog: 0 }).extra).toBe(false);
  });
  it('the backlog stops at 2 a day', () => {
    expect(laneCaps(c, { mirror: 0, extra: 0, backlog: 1 }).backlog).toBe(true);
    expect(laneCaps(c, { mirror: 0, extra: 0, backlog: 2 }).backlog).toBe(false);
  });
  it('the hard cap of 5 stops every lane, the mirror included', () => {
    const full = { mirror: 3, extra: 0, backlog: 2 };
    expect(totalOf(full)).toBe(5);
    expect(laneCaps(c, full)).toEqual({ mirror: false, extra: false, backlog: false });
    expect(laneCaps(c, { mirror: 2, extra: 1, backlog: 2 }).mirror).toBe(false);
  });
  it('counts posts by lane source', () => {
    expect(countsOf(['fb-mirror', 'fb-mirror', 'fb-extra', 'fb-backlog', 'api'])).toEqual({ mirror: 2, extra: 1, backlog: 1 });
  });
});

describe('laneSlots / dueSlots', () => {
  const slots = laneSlots(laneConfig({}));
  it('is two backlog slots and one extra slot, in time order', () => {
    expect(slots.map((s) => `${s.kind}@${s.time}`)).toEqual(['backlog@12:30', 'extra@15:00', 'backlog@18:30']);
    expect(new Set(slots.map((s) => s.id)).size).toBe(3);
    for (const s of slots) expect(s.id).toMatch(/^[a-z]+-\d+$/); // safe as a Mongo field name (no dots)
  });
  it('a slot opens 45 minutes before its time', () => {
    expect(dueSlots(DATE, new Date(at(DATE, '11:30').getTime()), slots, [])).toEqual([]);
    expect(dueSlots(DATE, new Date(at(DATE, '11:50').getTime()), slots, []).map((s) => s.time)).toEqual(['12:30']);
  });
  it('a missed slot is still due later the same day, and a claimed slot never is', () => {
    const late = at(DATE, '20:00');
    expect(dueSlots(DATE, late, slots, []).map((s) => s.time)).toEqual(['12:30', '15:00', '18:30']);
    expect(dueSlots(DATE, late, slots, [slots[0].id, slots[1].id]).map((s) => s.time)).toEqual(['18:30']);
  });
  it('no extra slot when the new share is 0', () => {
    expect(laneSlots(laneConfig({ FACEBOOK_NEW_PER_DAY: 0 })).some((s) => s.kind === 'extra')).toBe(false);
  });
});

describe('backlogOrder', () => {
  const now = new Date('2026-11-24T18:00:00Z');
  const day = (n: number) => new Date(now.getTime() - n * 86_400_000);
  const rows = [
    { reelId: 'old', publishedAt: day(31) },
    { reelId: 'a', publishedAt: day(2) },
    { reelId: 'b', publishedAt: day(1) },
    { reelId: 'a', publishedAt: day(1.5) }, // the same reel posted twice on YouTube counts once
    { reelId: 'c', publishedAt: day(10) },
    { reelId: 'onfb', publishedAt: day(0.5) },
  ];
  it('is newest first, once per reel, inside 30 days, without reels already on Facebook', () => {
    const out = backlogOrder(rows, new Set(['onfb']), now, 30).map((r) => r.reelId);
    expect(out).toEqual(['b', 'a', 'c']);
  });
  it('the window follows FACEBOOK_BACKLOG_DAYS', () => {
    expect(backlogOrder(rows, new Set(), now, 5).map((r) => r.reelId)).toEqual(['onfb', 'b', 'a']);
  });
  it('is empty when everything is on Facebook already (the backlog is used up)', () => {
    expect(backlogOrder(rows, new Set(rows.map((r) => r.reelId)), now, 30)).toEqual([]);
  });
});

describe('laneTrouble (the lane stops by itself)', () => {
  it('a login or permission error pauses', () => {
    expect(laneTrouble([{ status: 'blocked', errorCode: 'needs_reconnect' }])).toMatch(/reconnect Facebook/);
    expect(laneTrouble([{ status: 'failed', errorCode: 'permission_denied' }])).toMatch(/reconnect Facebook/);
  });
  it('one rejection does not pause, two in the day do', () => {
    expect(laneTrouble([{ status: 'failed', errorCode: 'rejected' }])).toBeNull();
    expect(laneTrouble([{ status: 'failed', errorCode: 'rejected' }, { status: 'failed', errorCode: 'media' }])).toMatch(/2 reels/);
  });
  it('rights flags and removed posts count as rejections', () => {
    expect(laneTrouble([{ status: 'removed' }, { status: 'published', warnings: ['Copyright claim on the audio'] }])).toMatch(/2 reels/);
  });
  it('ordinary problems (quota, transient, worker errors) do not pause the lane', () => {
    expect(laneTrouble([{ status: 'blocked', errorCode: 'quota' }, { status: 'failed', errorCode: 'worker_error' }, { status: 'queued' }, { status: 'published' }])).toBeNull();
  });
});

describe('facebookMetadata', () => {
  it('drops #shorts (a YouTube-only tag) and keeps the rest, never notifying anyone', () => {
    const m = facebookMetadata({ title: 'T', description: 'D', hashtags: ['#shorts', '#PrisonStories', '#Shorts', '#Lewisburg'], tags: ['a'], categoryId: '24', notifySubscribers: true });
    expect(m.hashtags).toEqual(['#PrisonStories', '#Lewisburg']);
    expect(m.notifySubscribers).toBe(false);
    expect(m.title).toBe('T');
    expect(m.categoryId).toBe('24');
  });
});
