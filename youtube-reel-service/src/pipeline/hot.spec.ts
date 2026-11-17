import { hotBrief, hotGroups, hotRecency, hotScore, hotVideos, HOT_MIN_SUPPLY, pickHotBackup, planHot } from './hot';
import { LaneVideo } from './lanes';

const now = new Date('2026-11-17T12:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const v = (id: string, over: Partial<LaneVideo> = {}): LaneVideo => ({
  youtubeId: id, videoId: `db-${id}`, title: `Video ${id}`, publishedAt: daysAgo(3), views: 20_000, durationSec: 7200, analyzed: true, strongMoments: 10, usedMoments: 0, entity: null, demand: 0, ...over,
});

// the real catalog of Nov 17 (views, ages and strong moments from the database)
const catalog = (): LaneVideo[] => [
  v('IE0g', { title: 'Yella Beezy Gets Life (Nov 15)', publishedAt: daysAgo(2.5), views: 50_989, strongMoments: 11, usedMoments: 3, entity: 'yella beezy', demand: 0.35 }),
  v('xb4j', { title: 'Yella Beezy Reportedly Sentenced', publishedAt: daysAgo(4.5), views: 42_272, strongMoments: 12, usedMoments: 3, entity: 'yella beezy', demand: 0.35 }),
  v('uMtx', { title: 'Yella Beezy Gets Life (Nov 11)', publishedAt: daysAgo(5.5), views: 36_377, strongMoments: 11, usedMoments: 8, entity: 'yella beezy', demand: 0.35 }),
  v('pSqs', { title: 'Yella Beezy Gets Life, Lil Durk Acquitted', publishedAt: daysAgo(1.4), views: 12_889, strongMoments: 37, entity: 'yella beezy', demand: 0.35 }),
  v('2WH', { title: 'MO3 Murder', publishedAt: daysAgo(3.5), views: 8_829, strongMoments: 5, entity: 'mo3', demand: 0.1 }),
  v('cl5A', { title: 'Lil Durk Still Waiting On Bond', publishedAt: daysAgo(0.5), views: 4_698, strongMoments: 9, entity: 'lil durk', demand: 0.25 }),
  v('YrUx', { title: 'Lil Durk Sent to the Hole', publishedAt: daysAgo(7), views: 4_280, strongMoments: 6, entity: 'lil durk', demand: 0.25 }),
  v('YEfu', { title: 'The Fall of El Mayo', publishedAt: daysAgo(11), views: 1_300, strongMoments: 4, entity: null }), // 118 views/day: not hot
  v('old1', { title: 'Diddy RICO', publishedAt: daysAgo(500), views: 300_000, strongMoments: 141, entity: 'diddy' }),
];

describe('hot videos: who is hot', () => {
  it('a week at full weight, fading to 0.55 on day 15, nothing after', () => {
    expect(hotRecency(0.2)).toBe(1);
    expect(hotRecency(7)).toBe(1);
    expect(hotRecency(15)).toBeCloseTo(0.55);
    expect(hotRecency(15.5)).toBe(0);
    expect(hotRecency(-1)).toBe(0);
  });

  it('only the last 15 days, analyzed, long, watched and with strong footage left', () => {
    const hot = hotVideos(catalog(), now).map((x) => x.youtubeId);
    expect(hot).not.toContain('old1'); // 500 days old, however big
    expect(hot).not.toContain('YEfu'); // 150 views a day or less
    expect(hot).toEqual(expect.arrayContaining(['IE0g', 'xb4j', 'uMtx', 'pSqs', 'cl5A']));
    expect(hotScore(v('x', { analyzed: false }), now)).toBe(0);
    expect(hotScore(v('x', { durationSec: 120 }), now)).toBe(0);
    expect(hotScore(v('x', { strongMoments: 2 }), now)).toBe(0);
  });

  it('a 12-day-old video with 300 views a day does not beat a 3-day-old live with 20,000', () => {
    expect(hotScore(v('live', { publishedAt: daysAgo(3), views: 60_000 }), now)).toBeGreaterThan(hotScore(v('slow', { publishedAt: daysAgo(12), views: 3_600 }), now) * 2);
  });

  it('the audience share of the person lifts a video', () => {
    expect(hotScore(v('a', { demand: 0.3 }), now)).toBeGreaterThan(hotScore(v('b', { demand: 0 }), now) * 1.5);
  });
});

describe('hot videos: how the day is shared (Nov 17 catalog)', () => {
  it('groups by person and builds each campaign on up to 3 videos, best first', () => {
    const groups = hotGroups(catalog(), now);
    const yella = groups.find((g) => g.key === 'yella beezy')!;
    expect(yella.videos.length).toBe(3);
    expect(yella.videos.map((x) => x.youtubeId)).toContain('IE0g');
    expect(groups[0].key).toBe('yella beezy');
  });

  it('3 reels: the big story gets most, a second story still gets one', () => {
    const plan = planHot(catalog(), now, 3);
    expect(plan.reduce((a, g) => a + g.reels, 0)).toBe(3);
    expect(plan[0].key).toBe('yella beezy');
    expect(plan[0].reels).toBe(2);
    expect(plan.length).toBe(2);
  });

  it('never gives a group more reels than its videos allow', () => {
    const plan = planHot([v('solo', { entity: null, strongMoments: 6, views: 9_000 })], now, 3);
    expect(plan).toHaveLength(1);
    expect(plan[0].reels).toBe(1); // one video of 9k views gives one reel a day, whatever the budget
    expect(plan[0].reels).toBeLessThanOrEqual(plan[0].capacity);
  });

  it('a big video (30k+ views) may give two reels a day, a small one only one', () => {
    expect(planHot([v('big', { views: 80_000, strongMoments: 12 })], now, 3)[0].reels).toBe(2);
    expect(planHot([v('small', { views: 9_000, strongMoments: 12 })], now, 3)[0].reels).toBe(1);
  });

  it('falls back to the old way when the hot videos hold too little footage', () => {
    expect(HOT_MIN_SUPPLY).toBe(6);
    expect(planHot([v('thin', { strongMoments: 3 })], now, 3)).toEqual([]);
    expect(planHot([], now, 3)).toEqual([]);
    expect(planHot(catalog(), now, 0)).toEqual([]);
  });

  it('a weak group does not take a slot from the archive topic', () => {
    const plan = planHot([v('big', { views: 200_000, strongMoments: 12, publishedAt: daysAgo(1), entity: 'a' }), v('weak', { views: 3_000, strongMoments: 10, publishedAt: daysAgo(12), entity: 'b' })], now, 3);
    expect(plan.map((g) => g.key)).toEqual(['a']);
  });

  it('the brief asks for different incidents and the host first line', () => {
    const [g] = planHot(catalog(), now, 3);
    const b = hotBrief(g);
    expect(b).toContain('DIFFERENT incident');
    expect(b).toContain(`Make ${g.reels} reels`);
    expect(b).toContain('Yella Beezy Gets Life');
  });
});

describe('hot videos: the backup', () => {
  it('takes hot videos first, even ones the day already used, and skips videos whose campaign failed', () => {
    const picks = pickHotBackup(catalog(), new Set(['IE0g']), now, 3).map((x) => x.youtubeId);
    expect(picks).not.toContain('IE0g');
    expect(picks.slice(0, 3).every((id) => ['xb4j', 'uMtx', 'pSqs', '2WH', 'cl5A', 'YrUx'].includes(id))).toBe(true);
  });

  it('tops up with the strongest older footage when too few videos are hot', () => {
    const picks = pickHotBackup([v('h', { strongMoments: 8 }), v('old1', { publishedAt: daysAgo(500), strongMoments: 141, views: 300_000 })], new Set(), now, 3).map((x) => x.youtubeId);
    expect(picks).toEqual(['h', 'old1']);
  });
});
