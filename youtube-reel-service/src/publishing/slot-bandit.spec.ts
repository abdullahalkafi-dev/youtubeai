import { DEFAULT_SLOTS } from './auto-plan';
import { assignBandit, banditReady, DayPost, posteriors, rankObservations, SlotObs } from './slot-bandit';

const post = (id: string, date: string, slot: string, views: number): DayPost => ({ id, date, slot, views });

describe('rank inside the day', () => {
  it('ranks each post among its own day, so a news spike lifts nobody above the rest', () => {
    const quiet = ['a', 'b', 'c'].map((s, i) => post(`q${i}`, '2026-10-01', ['08:00', '12:00', '17:00'][i], [100, 200, 300][i]));
    const spike = ['a', 'b', 'c'].map((s, i) => post(`s${i}`, '2026-10-02', ['08:00', '12:00', '17:00'][i], [10000, 20000, 30000][i]));
    const obs = rankObservations([...quiet, ...spike]);
    expect(obs.filter((o) => o.slot === '17:00').map((o) => o.rank)).toEqual([1, 1]);
    expect(obs.filter((o) => o.slot === '08:00').map((o) => o.rank)).toEqual([0, 0]);
  });

  it('shares the middle rank between ties and ignores days with fewer than three posts', () => {
    const o = rankObservations([post('1', 'd', '08:00', 5), post('2', 'd', '12:00', 5), post('3', 'd', '17:00', 9), post('x', 'e', '08:00', 1), post('y', 'e', '12:00', 2)]);
    expect(o.find((x) => x.slot === '08:00')!.rank).toBeCloseTo(0.25, 5);
    expect(o).toHaveLength(3); // the two-post day is dropped
  });
});

describe('what a slot has shown so far', () => {
  it('starts at "no difference" and moves only as evidence arrives', () => {
    const none = posteriors([], DEFAULT_SLOTS);
    expect(none.every((p) => p.mean === 0.5 && p.n === 0)).toBe(true);
    const some = posteriors([{ slot: '08:00', rank: 1 }, { slot: '08:00', rank: 1 }], ['08:00']);
    expect(some[0].mean).toBeGreaterThan(0.5);
    expect(some[0].mean).toBeLessThan(0.75); // two good days do not make it the best slot
    const many = posteriors(Array.from({ length: 40 }, () => ({ slot: '08:00', rank: 1 })), ['08:00']);
    expect(many[0].mean).toBeGreaterThan(0.9);
    expect(many[0].sd).toBeLessThan(some[0].sd);
  });

  it('is ready only with enough data in total and in every slot', () => {
    const slots = ['a', 'b'];
    const obs = (n: number, slot: string): SlotObs[] => Array.from({ length: n }, () => ({ slot, rank: 0.5 }));
    expect(banditReady([...obs(10, 'a'), ...obs(10, 'b')], slots)).toBe(false); // under 25 in total
    expect(banditReady([...obs(30, 'a'), ...obs(2, 'b')], slots)).toBe(false); // one slot starved
    expect(banditReady([...obs(15, 'a'), ...obs(15, 'b')], slots)).toBe(true);
  });
});

describe('Thompson sampling with an exploration floor', () => {
  const slots = DEFAULT_SLOTS;
  const strongEvening = posteriors(
    slots.flatMap((s) => Array.from({ length: 30 }, () => ({ slot: s, rank: s === '20:00' ? 0.9 : s === '08:00' ? 0.2 : 0.5 }))),
    slots,
  );

  it('usually gives the strongest reel the slot that has done best, but not always', () => {
    const counts = new Map<string, number>();
    for (let d = 1; d <= 200; d++) {
      const best = assignBandit(['best', 'b', 'c', 'd', 'e'], slots, strongEvening, `day-${d}`).find((x) => x.item === 'best')!.slot;
      counts.set(best, (counts.get(best) ?? 0) + 1);
    }
    expect(counts.get('20:00')! / 200).toBeGreaterThan(0.55); // clearly preferred
    expect(counts.get('20:00')! / 200).toBeLessThan(0.95); // but the others are still tested
    expect((counts.get('08:00') ?? 0) / 200).toBeGreaterThan(0.01); // even the worst slot keeps getting the best reel sometimes
  });

  it('uses every slot exactly once and is reproducible', () => {
    const a = assignBandit(['1', '2', '3', '4', '5'], slots, strongEvening, 'seed');
    expect(new Set(a.map((x) => x.slot)).size).toBe(5);
    expect(a).toEqual(assignBandit(['1', '2', '3', '4', '5'], slots, strongEvening, 'seed'));
  });

  it('with no evidence it is as good as random', () => {
    const none = posteriors([], slots);
    const first = new Map<string, number>();
    for (let d = 1; d <= 400; d++) {
      const s = assignBandit(['best', 'b', 'c', 'd', 'e'], slots, none, `n-${d}`).find((x) => x.item === 'best')!.slot;
      first.set(s, (first.get(s) ?? 0) + 1);
    }
    for (const s of slots) expect(first.get(s)! / 400).toBeGreaterThan(0.1);
  });
});
