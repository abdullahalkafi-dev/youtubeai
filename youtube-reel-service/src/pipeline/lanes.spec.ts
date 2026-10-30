import { isSourceable, ageDays, bankBrief, freshBrief, freshnessBonus, LaneVideo, entityOf, needsAnalysis, pickBank, pickFresh, recencyWeight } from './lanes';

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
    const out = pickFresh([v('mined', { views: 50_000, usedMoments: 4 }), v('plain', { views: 40_000 }), v('ready', { views: 38_000, analyzed: true, strongMoments: 6 })], now, 3);
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

describe('freshness bonus in the source search', () => {
  const now = new Date('2026-10-28T12:00:00Z');
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

  it('a video from this week gets the full bonus, fading to 40% at 30 days', () => {
    expect(freshnessBonus(daysAgo(2), now)).toBeCloseTo(1.5);
    expect(freshnessBonus(daysAgo(30), now)).toBeCloseTo(0.6);
    expect(freshnessBonus(daysAgo(18), now)).toBeGreaterThan(0.6);
    expect(freshnessBonus(daysAgo(18), now)).toBeLessThan(1.5);
  });

  it('old or undated videos get nothing', () => {
    expect(freshnessBonus(daysAgo(31), now)).toBe(0);
    expect(freshnessBonus(null, now)).toBe(0);
    expect(freshnessBonus(undefined, now)).toBe(0);
  });
});

describe('hit-video-first (Oct 28 audit)', () => {
  const now = new Date('2026-10-28T12:00:00Z');
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
  const hv = (id: string, over: Partial<LaneVideo> = {}): LaneVideo => ({ youtubeId: id, videoId: `db-${id}`, title: id, publishedAt: daysAgo(10), views: 10_000, durationSec: 1200, analyzed: true, strongMoments: 6, usedMoments: 0, ...over });

  it('ranks by views per day, so a fast new hit beats a slower old video with more total views', () => {
    const out = pickFresh([hv('slow', { publishedAt: daysAgo(28), views: 40_000 }), hv('fast', { publishedAt: daysAgo(6), views: 30_000 })], now, 2);
    expect(out.map((x) => x.youtubeId)).toEqual(['fast', 'slow']);
  });

  it('the channel\'s own traffic for the person lifts a video, and little footage left pushes it down', () => {
    const out = pickFresh([hv('plain', { views: 12_000 }), hv('wanted', { views: 10_000, demand: 0.24 }), hv('mined', { views: 30_000, strongMoments: 0 })], now, 3);
    expect(out.map((x) => x.youtubeId)).toEqual(['wanted', 'plain', 'mined']);
  });

  it('never more than two of the three picks about the same person', () => {
    const out = pickFresh([hv('d1', { views: 60_000, entity: 'diddy' }), hv('d2', { views: 50_000, entity: 'diddy' }), hv('d3', { views: 40_000, entity: 'diddy' }), hv('k', { views: 20_000, entity: 'keefe d' })], now, 3);
    expect(out.map((x) => x.youtubeId)).toEqual(['d1', 'd2', 'k']);
  });

  it('finds the person a title is about (longest name wins) and ignores titles about nobody known', () => {
    const ents = [{ key: 'diddy', names: ['diddy', 'sean combs'] }, { key: 'keefe d', names: ['keefe d', 'duane davis'] }];
    expect(entityOf("Why Diddy's Prison Move Is More Than Just A Change of Location", ents)).toBe('diddy');
    expect(entityOf('Prison intake: one guard', ents)).toBeNull();
  });

  it('videos waiting for analysis go most-watched first, within 30 days', () => {
    const rows = [
      { youtubeId: 'new-weak', durationSec: 1200, publishedAt: daysAgo(1), views: 300 },
      { youtubeId: 'hit', durationSec: 1200, publishedAt: daysAgo(10), views: 16_000 },
      { youtubeId: 'older', durationSec: 1200, publishedAt: daysAgo(40), views: 90_000 },
    ];
    expect(needsAnalysis(rows, new Set(), now)).toEqual(['hit', 'new-weak']);
  });
});

describe('stale "upcoming" flag (Oct 30 audit)', () => {
  it('a premiere that already aired and has views is usable; a live one and an unwatched upcoming one are not', () => {
    expect(isSourceable({ liveBroadcastContent: 'upcoming', viewCount: 15_788, publishedAt: daysAgo(11) }, now)).toBe(true);
    expect(isSourceable({ liveBroadcastContent: 'upcoming', viewCount: 0, publishedAt: daysAgo(1) }, now)).toBe(false);
    expect(isSourceable({ liveBroadcastContent: 'upcoming', viewCount: 5_000, publishedAt: new Date(now.getTime() + 3_600_000) }, now)).toBe(false);
    expect(isSourceable({ liveBroadcastContent: 'live', viewCount: 5_000, publishedAt: daysAgo(0) }, now)).toBe(false);
    expect(isSourceable({ liveBroadcastContent: 'none', viewCount: 10, publishedAt: daysAgo(1) }, now)).toBe(true);
    expect(isSourceable({}, now)).toBe(true);
  });
});
