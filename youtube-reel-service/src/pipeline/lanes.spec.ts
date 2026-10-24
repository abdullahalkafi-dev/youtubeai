import { ageDays, bankBrief, freshBrief, LaneVideo, needsAnalysis, pickBank, pickFresh, recencyWeight } from './lanes';

const now = new Date('2026-10-26T12:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const v = (id: string, over: Partial<LaneVideo> = {}): LaneVideo => ({
  youtubeId: id, videoId: `db-${id}`, title: `Video ${id}`, publishedAt: daysAgo(3), views: 10_000, durationSec: 1200, analyzed: false, strongMoments: 0, usedMoments: 0, ...over,
});

describe('fresh lane (videos from the last 30 days)', () => {
  it('only long videos from the last 30 days, newest and most watched first', () => {
    const out = pickFresh(
      [v('old', { publishedAt: daysAgo(45), views: 900_000 }), v('short', { durationSec: 120 }), v('a', { publishedAt: daysAgo(2), views: 20_000 }), v('b', { publishedAt: daysAgo(25), views: 20_000 }), v('c', { publishedAt: daysAgo(5), views: 60_000 })],
      now,
    );
    expect(out.map((x) => x.youtubeId)).toEqual(['c', 'a', 'b']);
  });

  it('a video that is already mined out is pushed down; an analyzed one is ready sooner', () => {
    const out = pickFresh([v('mined', { views: 50_000, usedMoments: 4 }), v('plain', { views: 40_000 }), v('ready', { views: 38_000, analyzed: true })], now, 3);
    expect(out.map((x) => x.youtubeId)).toEqual(['ready', 'plain', 'mined']);
  });

  it('weights recency: a week is full weight, the edge of the window 40%', () => {
    expect(recencyWeight(2)).toBe(1);
    expect(recencyWeight(7)).toBe(1);
    expect(recencyWeight(30)).toBeCloseTo(0.4);
    expect(recencyWeight(18.5)).toBeCloseTo(0.7);
    expect(ageDays({ publishedAt: null }, now)).toBe(Infinity);
  });

  it('nothing recent gives nothing (the lane is skipped, not invented)', () => {
    expect(pickFresh([v('old', { publishedAt: daysAgo(90) })], now)).toEqual([]);
  });
});

describe('bank lane (the best of the older content)', () => {
  it('analyzed older videos with at least three strong unused moments, best first', () => {
    const out = pickBank(
      [
        v('new', { publishedAt: daysAgo(5), analyzed: true, strongMoments: 20 }), // belongs to the fresh lane
        v('unanalyzed', { publishedAt: daysAgo(90), strongMoments: 20 }),
        v('thin', { publishedAt: daysAgo(90), analyzed: true, strongMoments: 2 }),
        v('rich', { publishedAt: daysAgo(90), analyzed: true, strongMoments: 9, views: 30_000 }),
        v('big', { publishedAt: daysAgo(120), analyzed: true, strongMoments: 5, views: 300_000 }),
      ],
      now,
    );
    expect(out.map((x) => x.youtubeId)).toEqual(['rich', 'big']);
  });
});

describe('briefs and upload analysis', () => {
  it('the briefs name the videos and ask for self-contained reels', () => {
    expect(freshBrief([v('a', { title: 'Diddy at Allenwood' })])).toContain('"Diddy at Allenwood"');
    expect(bankBrief([v('a', { title: 'ADX Supermax' })])).toMatch(/stand on their own/);
  });

  it('new long uploads that nobody has downloaded are queued for analysis, newest first', () => {
    const rows = [
      { youtubeId: 'a', durationSec: 1200, publishedAt: daysAgo(1) },
      { youtubeId: 'b', durationSec: 1200, publishedAt: daysAgo(4) },
      { youtubeId: 'known', durationSec: 1200, publishedAt: daysAgo(2) },
      { youtubeId: 'short', durationSec: 90, publishedAt: daysAgo(1) },
      { youtubeId: 'old', durationSec: 1200, publishedAt: daysAgo(40) },
    ];
    expect(needsAnalysis(rows, new Set(['known']), now)).toEqual(['a', 'b']);
  });
});
