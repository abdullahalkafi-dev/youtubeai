import { jitterRunAt, JITTER_MIN, MIN_GAP_MIN, appeal, chooseReels, concreteness, PlanReel, assignRotation, DEFAULT_EXTRA_SLOTS, DEFAULT_SLOTS, autoBaseline, evaluateGuardrails, LEGACY_VIEWS_PAUSE, platformTrouble, slowSlots, viewsCollapse, gateReason, GuardPost, nyToUtc, parseSlot, pickSlots, seededRandom } from './auto-plan';

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

  it('a slot stays usable until 10 minutes into its window (the post is then drawn from what is left), so the client can still cancel or move it', () => {
    expect(pickSlots({ ...base, now: at('08:15'), count: 5 })).not.toContain('08:00'); // the 8:00 window ends 8:30, the lead time needs 20 minutes
    expect(pickSlots({ ...base, now: at('07:45'), count: 5 })).toContain('08:00'); // still inside the window
  });

  it('late in the day it returns fewer slots than reels instead of inventing times', () => {
    expect(pickSlots({ ...base, now: at('19:00'), count: 5 })).toEqual(['20:00', '21:00', '22:00']);
    expect(pickSlots({ ...base, now: at('20:50'), count: 5 })).toEqual(['21:00', '22:00']);
    expect(pickSlots({ ...base, now: at('22:00'), count: 5 })).toEqual(['22:00']);
    expect(pickSlots({ ...base, now: at('22:20'), count: 5 })).toEqual([]);
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

describe('concrete stories and varied sources (Oct 30 audit)', () => {
  it('scores a concrete incident above an abstract lesson', () => {
    expect(concreteness('Prison deprivation: I washed my clothes in a toilet')).toBeGreaterThanOrEqual(0.7);
    expect(concreteness('Brooklyn Bounty says he saw a killing in his first hour in prison')).toBeGreaterThanOrEqual(0.4);
    expect(concreteness('Public disrespect: How an audience turns pride into a prison risk')).toBe(0);
    expect(concreteness('Diddy discussion: Defending a name isnt always loyalty')).toBe(0);
    expect(concreteness('')).toBe(0);
    expect(concreteness('33 arrived. Only three remained a week later')).toBeGreaterThan(0);
  });

  it('ranks the concrete reel higher and a repeated source lower, and changes nothing without the new inputs', () => {
    const base = { score: 70 };
    expect(appeal({ ...base, concrete: 1 })).toBeGreaterThan(appeal({ ...base, concrete: 0 }));
    expect(appeal({ ...base, recentSourceUses: 2 })).toBeLessThan(appeal({ ...base, recentSourceUses: 0 }));
    expect(appeal(base)).toBeCloseTo(0.35 * 70, 6);
  });

  const reel = (id: string, score: number, sourceIds: string[], entities: string[] = []): PlanReel => ({ id, score, entities, sourceIds, track: 'fresh' });

  it('takes one reel per source video when the day can be filled that way', () => {
    const fresh = [reel('a1', 90, ['A']), reel('a2', 88, ['A']), reel('b1', 70, ['B']), reel('c1', 60, ['C'])];
    const ids = chooseReels({ need: 3, fresh, stock: [], useStock: false, plannedEntities: [], mix: [] }).map((r) => r.id);
    expect(ids).toEqual(['a1', 'b1', 'c1']);
  });

  it('allows a second reel from one source only to fill the day, and counts the sources already planned', () => {
    const fresh = [reel('a1', 90, ['A']), reel('a2', 88, ['A'])];
    expect(chooseReels({ need: 2, fresh, stock: [], useStock: false, plannedEntities: [], mix: [] }).map((r) => r.id)).toEqual(['a1', 'a2']);
    expect(chooseReels({ need: 1, fresh, stock: [], useStock: false, plannedEntities: [], plannedSources: [['A']], mix: [] })).toHaveLength(1);
    const fresh2 = [reel('a1', 90, ['A']), reel('b1', 50, ['B'])];
    expect(chooseReels({ need: 1, fresh: fresh2, stock: [], useStock: false, plannedEntities: [], plannedSources: [['A']], mix: [] }).map((r) => r.id)).toEqual(['b1']);
  });
});

describe('random posting time inside the slot window', () => {
  const date = '2026-10-31';
  const centre = (slot: string) => nyToUtc(date, slot).getTime();
  const far = nyToUtc(date, '03:00').getTime();

  it('is within 30 minutes either side of the slot: 8:00 is 7:30 to 8:30, 9:00 is 8:30 to 9:30', () => {
    for (let i = 0; i < 200; i++) {
      for (const slot of ['08:00', '09:00', '20:00']) {
        const t = jitterRunAt({ date, slot, seed: `s${i}`, earliest: far, others: [] }).getTime();
        expect(t).toBeGreaterThanOrEqual(centre(slot) - JITTER_MIN * 60_000);
        expect(t).toBeLessThanOrEqual(centre(slot) + JITTER_MIN * 60_000);
      }
    }
  });

  it('really varies from day to day, and is the same for the same seed', () => {
    const times = new Set(Array.from({ length: 30 }, (_, i) => jitterRunAt({ date, slot: '08:00', seed: `day${i}`, earliest: far, others: [] }).getTime()));
    expect(times.size).toBeGreaterThan(25);
    const a = jitterRunAt({ date, slot: '08:00', seed: 'same', earliest: far, others: [] }).getTime();
    expect(jitterRunAt({ date, slot: '08:00', seed: 'same', earliest: far, others: [] }).getTime()).toBe(a);
  });

  it('never lands before the earliest allowed time and keeps its distance from other posts', () => {
    const earliest = centre('08:00') - 5 * 60_000;
    for (let i = 0; i < 100; i++) {
      const t = jitterRunAt({ date, slot: '08:00', seed: `e${i}`, earliest, others: [] }).getTime();
      expect(t).toBeGreaterThanOrEqual(earliest);
    }
    for (let i = 0; i < 100; i++) {
      const other = centre('08:00') + 30 * 60_000; // the 9:00 post drew the very start of its window
      const t = jitterRunAt({ date, slot: '08:00', seed: `g${i}`, earliest: far, others: [other] }).getTime();
      expect(Math.abs(t - other)).toBeGreaterThanOrEqual(MIN_GAP_MIN * 60_000);
    }
  });
});
