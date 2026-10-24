import { chooseReels, DEFAULT_EXTRA_SLOTS, DEFAULT_SLOTS, freeSlots, lockAt, nyToUtc, PlanReel } from './auto-plan';

describe('free slots (the day can be filled again and again)', () => {
  const date = '2026-10-26';
  const base = { date, slots: DEFAULT_SLOTS, extraSlots: DEFAULT_EXTRA_SLOTS, spacingMin: 60 };
  const at = (hhmm: string) => nyToUtc(date, hhmm);

  it('everything is free at 5 AM; taken slots are not offered again', () => {
    expect(freeSlots({ ...base, now: at('05:00'), taken: [] })).toEqual(['08:00', '09:00', '20:00', '21:00', '22:00']);
    expect(freeSlots({ ...base, now: at('05:00'), taken: ['09:00', '21:00'] })).toEqual(['08:00', '20:00', '22:00']);
  });

  it('slots in the past or inside the lead time are gone', () => {
    expect(freeSlots({ ...base, now: at('08:50'), taken: [] })).toEqual(['20:00', '21:00', '22:00']);
    expect(freeSlots({ ...base, now: at('22:00'), taken: [] })).toEqual([]);
  });

  it('keeps the spacing from slots that are already taken', () => {
    expect(freeSlots({ ...base, now: at('05:00'), taken: ['08:30'], spacingMin: 60 })).toEqual(['20:00', '21:00', '22:00']);
  });

  it('the day locks at 7 AM New York', () => {
    expect(lockAt('2026-10-26').toISOString()).toBe('2026-10-26T11:00:00.000Z');
  });
});

describe('choosing reels for the empty slots', () => {
  const r = (id: string, score: number, entities: string[] = [], createdAt = 0): PlanReel => ({ id, score, entities, createdAt });
  const brand = (e: string) => e === 'unique-mecca-audio';

  it("today's reels come first, then the stock, best score first", () => {
    const out = chooseReels({ need: 4, fresh: [r('f1', 70), r('f2', 80)], stock: [r('s1', 90), r('s2', 85)], useStock: true, plannedEntities: [] });
    expect(out.map((x) => x.id)).toEqual(['f2', 'f1', 's1', 's2']);
    expect(out.map((x) => x.source)).toEqual(['fresh', 'fresh', 'stock', 'stock']);
  });

  it('before the lock only the same-day reels are used', () => {
    const out = chooseReels({ need: 3, fresh: [r('f1', 70)], stock: [r('s1', 90)], useStock: false, plannedEntities: [] });
    expect(out.map((x) => x.id)).toEqual(['f1']);
  });

  it('never more than two reels about the same person in a day, the channel name not counted', () => {
    const out = chooseReels({
      need: 3,
      fresh: [],
      stock: [r('d1', 90, ['diddy', 'unique-mecca-audio']), r('d2', 89, ['diddy', 'unique-mecca-audio']), r('d3', 88, ['diddy']), r('t1', 70, ['tupac', 'unique-mecca-audio'])],
      useStock: true,
      plannedEntities: [],
      ignore: brand,
    });
    expect(out.map((x) => x.id)).toEqual(['d1', 'd2', 't1']);
  });

  it('counts the people already planned today', () => {
    const out = chooseReels({ need: 2, fresh: [], stock: [r('d1', 90, ['diddy']), r('t1', 70, ['tupac'])], useStock: true, plannedEntities: [['diddy'], ['diddy']], ignore: brand });
    // d1 is only allowed because a slot would otherwise stay empty
    expect(out.map((x) => x.id)).toEqual(['t1', 'd1']);
  });

  it('relaxes the person limit by one rather than leaving a slot empty, but not further', () => {
    const stock = [r('d1', 90, ['diddy']), r('d2', 89, ['diddy']), r('d3', 88, ['diddy']), r('d4', 87, ['diddy'])];
    const out = chooseReels({ need: 4, fresh: [], stock, useStock: true, plannedEntities: [], ignore: brand });
    expect(out.map((x) => x.id)).toEqual(['d1', 'd2', 'd3']);
  });

  it('ties go to the newer reel; nothing to choose from gives nothing', () => {
    const out = chooseReels({ need: 1, fresh: [], stock: [r('old', 80, [], 1), r('new', 80, [], 2)], useStock: true, plannedEntities: [] });
    expect(out[0].id).toBe('new');
    expect(chooseReels({ need: 3, fresh: [], stock: [], useStock: true, plannedEntities: [] })).toEqual([]);
  });
});
