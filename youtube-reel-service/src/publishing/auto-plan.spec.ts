import { assignRotation, DEFAULT_EXTRA_SLOTS, DEFAULT_SLOTS, autoBaseline, evaluateGuardrails, LEGACY_VIEWS_PAUSE, platformTrouble, slowSlots, viewsCollapse, gateReason, GuardPost, nyToUtc, parseSlot, pickSlots, seededRandom } from './auto-plan';

describe('New York slot times', () => {
  it('converts wall-clock time to UTC with daylight saving', () => {
    expect(nyToUtc('2026-07-10', '08:00').toISOString()).toBe('2026-07-10T12:00:00.000Z'); // EDT
    expect(nyToUtc('2026-12-01', '08:00').toISOString()).toBe('2026-12-01T13:00:00.000Z'); // EST
    expect(nyToUtc('2026-11-01', '08:00').toISOString()).toBe('2026-11-01T13:00:00.000Z'); // the day DST ends
    expect(nyToUtc('2026-03-08', '08:00').toISOString()).toBe('2026-03-08T12:00:00.000Z'); // the day DST starts
    expect(nyToUtc('2026-10-22', '21:00').toISOString()).toBe('2026-10-23T01:00:00.000Z');
  });
});

describe('slot choice', () => {
  const base = { date: '2026-10-22', slots: DEFAULT_SLOTS, extraSlots: DEFAULT_EXTRA_SLOTS, spacingMin: 60 };
  const at = (hhmm: string) => nyToUtc('2026-10-22', hhmm);

  it('uses the five client slots: 8 AM, 9 AM, 8 PM, 9 PM, 10 PM', () => {
    expect(DEFAULT_SLOTS).toEqual(['08:00', '09:00', '20:00', '21:00', '22:00']);
    expect(pickSlots({ ...base, now: at('05:10'), count: 5 })).toEqual(['08:00', '09:00', '20:00', '21:00', '22:00']);
  });

  it('never invents extra slots: a sixth reel waits for another day', () => {
    expect(DEFAULT_EXTRA_SLOTS).toEqual([]);
    expect(pickSlots({ ...base, now: at('05:10'), count: 7 })).toEqual(['08:00', '09:00', '20:00', '21:00', '22:00']);
  });

  it('reads times the way people write them', () => {
    expect(parseSlot('8:00 AM')).toBe('08:00');
    expect(parseSlot('9pm')).toBe('21:00');
    expect(parseSlot('10 PM')).toBe('22:00');
    expect(parseSlot('12:00 AM')).toBe('00:00');
    expect(parseSlot('12 pm')).toBe('12:00');
    expect(parseSlot('20:00')).toBe('20:00');
    expect(parseSlot('13 pm')).toBeNull();
    expect(parseSlot('25:00')).toBeNull();
    expect(parseSlot('soon')).toBeNull();
  });

  it('never picks a slot that is closer than the lead time, so the client can still cancel or move it', () => {
    expect(pickSlots({ ...base, now: at('07:45'), count: 5 })).not.toContain('08:00');
    expect(pickSlots({ ...base, now: at('07:30'), count: 5 })).toContain('08:00'); // 30 minutes ahead is fine
  });

  it('late in the day it returns fewer slots than reels instead of inventing times', () => {
    expect(pickSlots({ ...base, now: at('19:00'), count: 5 })).toEqual(['20:00', '21:00', '22:00']);
    expect(pickSlots({ ...base, now: at('20:50'), count: 5 })).toEqual(['22:00']);
    expect(pickSlots({ ...base, now: at('22:00'), count: 5 })).toEqual([]);
  });

  it('keeps the spacing between uploads', () => {
    const s = pickSlots({ ...base, now: at('05:00'), count: 7, spacingMin: 90 });
    expect(s).toEqual(['08:00', '20:00', '22:00']);
    for (let i = 1; i < s.length; i++) expect(nyToUtc(base.date, s[i]).getTime() - nyToUtc(base.date, s[i - 1]).getTime()).toBeGreaterThanOrEqual(90 * 60_000);
  });

  it('ignores slots that are not valid HH:mm', () => {
    expect(pickSlots({ ...base, slots: ['8am', '12:00', '25:00'], extraSlots: [], now: at('05:00'), count: 3 })).toEqual(['12:00']);
  });
});

describe('rotation (fair slot tests)', () => {
  it('is reproducible for the same date and different on another', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    expect(assignRotation(items, DEFAULT_SLOTS, '2026-10-22')).toEqual(assignRotation(items, DEFAULT_SLOTS, '2026-10-22'));
    expect(assignRotation(items, DEFAULT_SLOTS, '2026-10-22').map((x) => x.slot)).not.toEqual(assignRotation(items, DEFAULT_SLOTS, '2026-10-23').map((x) => x.slot));
  });

  it('gives every slot to exactly one reel', () => {
    const r = assignRotation(['a', 'b', 'c', 'd', 'e'], DEFAULT_SLOTS, 'x');
    expect(new Set(r.map((x) => x.slot)).size).toBe(5);
    expect(r.map((x) => x.item).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('does not let the best reel always take the same slot (no quality-for-slot confounding)', () => {
    const slotOfBest = new Set<string>();
    for (let d = 1; d <= 30; d++) slotOfBest.add(assignRotation(['best', 'b', 'c', 'd', 'e'], DEFAULT_SLOTS, `2026-10-${String(d).padStart(2, '0')}`).find((x) => x.item === 'best')!.slot);
    expect(slotOfBest.size).toBeGreaterThanOrEqual(4);
  });

  it('seeded random is stable', () => {
    const a = seededRandom('s');
    const b = seededRandom('s');
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('gates (what may go out without a person looking)', () => {
  const ok = { score: 82, verdict: 'keep', preflightErrors: [], hasActivePost: false, minScore: 75 };
  it('lets a good reel through', () => expect(gateReason(ok)).toBeNull());
  it('stops a low score, a preflight error, a duplicate and a negative review, with a plain reason', () => {
    expect(gateReason({ ...ok, score: 70 })).toBe('score 70 is under 75');
    expect(gateReason({ ...ok, score: null })).toMatch(/under 75/);
    expect(gateReason({ ...ok, preflightErrors: ['The video is longer than 60 seconds'] })).toBe('The video is longer than 60 seconds');
    expect(gateReason({ ...ok, hasActivePost: true })).toBe('it already has a post');
    expect(gateReason({ ...ok, verdict: 'drop' })).toMatch(/reviewer/);
  });
});

describe('guardrails (when it stops by itself)', () => {
  const day = 24 * 3600_000;
  const now = new Date('2026-10-30T12:00:00Z');
  const post = (hoursAgo: number, views: number | null, extra: Partial<GuardPost> = {}): GuardPost => ({ status: 'published', publishedAt: new Date(now.getTime() - hoursAgo * 3600_000), views, warnings: [], ...extra });

  it('carries on when posts do fine', () => {
    expect(evaluateGuardrails([post(30, 2800), post(40, 2400), post(50, 3100)], 2700, now)).toBeNull();
  });

  it('stops after three settled posts in a row under 30% of the usual Shorts views', () => {
    const r = evaluateGuardrails([post(30, 300), post(40, 500), post(50, 100), post(80, 9000)], 2700, now);
    expect(r).toMatch(/last 3 automatic posts/);
  });

  it('does not judge posts younger than a day, nor with fewer than three settled posts, nor without a baseline', () => {
    expect(evaluateGuardrails([post(2, 0), post(3, 0), post(4, 0)], 2700, now)).toBeNull();
    expect(evaluateGuardrails([post(30, 10), post(40, 10)], 2700, now)).toBeNull();
    expect(evaluateGuardrails([post(30, 10), post(40, 10), post(50, 10)], null, now)).toBeNull();
    void day;
  });

  it('one good post among the last three keeps it running', () => {
    expect(evaluateGuardrails([post(30, 300), post(40, 2000), post(50, 100)], 2700, now)).toBeNull();
  });

  it('stops at once when YouTube flags a video', () => {
    expect(evaluateGuardrails([post(5, 10, { warnings: ['YouTube set this video to PRIVATE although another visibility was requested. This can happen for API projects that have not passed the Google API audit — check the video in YouTube Studio.'] })], 2700, now)).toMatch(/flagged/);
    expect(evaluateGuardrails([post(5, 10, { status: 'failed', errorCode: 'rejected' })], 2700, now)).toMatch(/flagged/);
    expect(evaluateGuardrails([post(5, 10, { status: 'removed' })], 2700, now)).toMatch(/removed/);
  });
});

describe('guard: a views slump slows posting, only YouTube trouble stops it', () => {
  const now = new Date('2026-10-30T12:00:00Z');
  const post = (hoursAgo: number, views: number | null) => ({ status: 'published', publishedAt: new Date(now.getTime() - hoursAgo * 3600_000), views, warnings: [] as string[] });

  it('a slump is reported by viewsCollapse, not as a platform problem', () => {
    const posts = [post(30, 100), post(40, 120), post(50, 90)];
    expect(viewsCollapse(posts, 1000, now)).toMatch(/last 3 automatic posts/);
    expect(platformTrouble(posts)).toBeNull();
  });

  it('platformTrouble catches the flags that must hard-stop', () => {
    expect(platformTrouble([{ ...post(5, 10), status: 'removed' }])).toMatch(/removed/);
  });

  it('the old views-only pause text is recognised so it can be lifted', () => {
    expect(LEGACY_VIEWS_PAUSE.test('Stopped by itself: the last 3 automatic posts each earned under 30% of your usual Shorts views (about 1954). Look at what changed, then resume.')).toBe(true);
    expect(LEGACY_VIEWS_PAUSE.test('Stopped by itself: YouTube flagged an automatic post (rejected). Check YouTube Studio, then resume.')).toBe(false);
  });

  it('slowSlots keeps a morning and two evening slots out of five', () => {
    expect(slowSlots(['08:00', '09:00', '20:00', '21:00', '22:00'])).toEqual(['08:00', '20:00', '22:00']);
    expect(slowSlots(['09:00', '21:00'])).toEqual(['09:00']);
  });

  it('the baseline is the median of automatic posts from 3 to 17 days ago, and needs 8 of them', () => {
    const at = (daysAgo: number, views: number) => ({ publishedAt: new Date(now.getTime() - daysAgo * 86_400_000), views });
    const old = [4, 5, 6, 7, 8, 9, 10, 11].map((d, i) => at(d, (i + 1) * 100)); // 100..800, median 450
    expect(autoBaseline(old, now)).toBe(450);
    expect(autoBaseline([...old, at(1, 5), at(20, 99999)], now)).toBe(450); // too new / too old are ignored
    expect(autoBaseline(old.slice(0, 7), now)).toBeNull();
  });
});
