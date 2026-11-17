import { hotBrief, hotGroups, hotRecency, hotScore, hotVideos, HOT_MIN_SUPPLY, HOT_RESERVED, interest, isRelaxedCampaign, pickHotBackup, planHot, planHotDay, RELAXED_DAYS } from './hot';
import { LaneVideo } from './lanes';

const now = new Date('2026-11-17T12:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const v = (id: string, over: Partial<LaneVideo> = {}): LaneVideo => ({
  youtubeId: id, videoId: `db-${id}`, title: `Video ${id}`, publishedAt: daysAgo(3), views: 20_000, durationSec: 7200, analyzed: true, strongMoments: 10, usedMoments: 0, entity: null, demand: 0, trend: 0, ...over,
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
  v('YEfu', { title: 'The Fall of El Mayo', publishedAt: daysAgo(11), views: 1_663, strongMoments: 4, entity: null }),
  v('old1', { title: 'Diddy RICO', publishedAt: daysAgo(500), views: 300_000, strongMoments: 141, entity: 'diddy' }),
];

describe('hot videos: who is eligible (recency decides, not views)', () => {
  it('a week at full weight, fading to 0.55 on day 15, nothing after', () => {
    expect(hotRecency(0.2)).toBe(1);
    expect(hotRecency(7)).toBe(1);
    expect(hotRecency(15)).toBeCloseTo(0.55);
    expect(hotRecency(15.5)).toBe(0);
    expect(hotRecency(-1)).toBe(0);
  });

  it('every analyzed long video of the last 15 days with strong footage left, however few views it has', () => {
    const hot = hotVideos(catalog(), now).map((x) => x.youtubeId);
    expect(hot).not.toContain('old1'); // 500 days old, however big
    expect(hot).toEqual(expect.arrayContaining(['IE0g', 'xb4j', 'uMtx', 'pSqs', 'cl5A', '2WH', 'YrUx', 'YEfu'])); // El Mayo: 150 views a day, still hot
    expect(hotScore(v('x', { analyzed: false }), now)).toBe(0);
    expect(hotScore(v('x', { durationSec: 120 }), now)).toBe(0);
    expect(hotScore(v('x', { strongMoments: 2 }), now)).toBe(0);
    expect(hotScore(v('tiny', { views: 40, publishedAt: daysAgo(2) }), now)).toBeGreaterThan(0);
  });

  it('attention is the best of views per day, the audience share and a current trend', () => {
    const quiet = v('q', { views: 200, demand: 0, trend: 0 });
    expect(interest(quiet, now)).toBeLessThan(0.5);
    expect(interest(v('q', { views: 300, trend: 0.9 }), now)).toBeCloseTo(0.9);
    expect(interest(v('q', { views: 300, demand: 0.25 }), now)).toBe(1);
    expect(interest(v('big', { views: 300_000 }), now)).toBe(1);
  });

  it('a low-view video on a trending topic scores close to a high-view one (the client: the topic, not the long video, is what trends)', () => {
    const lowTrending = hotScore(v('a', { views: 900, trend: 0.9, publishedAt: daysAgo(2) }), now);
    const bigNoTrend = hotScore(v('b', { views: 60_000, publishedAt: daysAgo(2) }), now);
    expect(lowTrending / bigNoTrend).toBeGreaterThan(0.85);
  });

  it('a newer video beats an older one with the same attention; a week-old video is not penalised vs a 6-day-old one', () => {
    expect(hotScore(v('n', { publishedAt: daysAgo(1) }), now)).toBeGreaterThan(hotScore(v('o', { publishedAt: daysAgo(12) }), now));
    expect(hotRecency(6)).toBe(hotRecency(7));
  });

  it('fair share: a video with no reel yet goes before one that already gave several', () => {
    expect(hotScore(v('fresh', { usedMoments: 0 }), now)).toBeGreaterThan(hotScore(v('mined', { usedMoments: 6 }), now));
  });

  it('views count for more when the self-check says so (interest weight 0.7)', () => {
    const big = v('big', { views: 60_000 });
    const small = v('small', { views: 300 });
    const ratio = (w: number) => hotScore(small, now, w) / hotScore(big, now, w);
    expect(ratio(0.7)).toBeLessThan(ratio(0.4));
  });
});

describe('hot videos: how the day is shared (Nov 17 catalog)', () => {
  it('groups by person and builds each campaign on up to 5 videos, best first', () => {
    const groups = hotGroups(catalog(), now);
    const yella = groups.find((g) => g.key === 'yella beezy')!;
    expect(yella.videos.length).toBe(4); // all four Yella Beezy videos, so the 42k and 36k lives are not left out
    expect(yella.videos.map((x) => x.youtubeId)).toContain('IE0g');
    expect(groups[0].key).toBe('yella beezy');
  });

  it('3 reels: a big story gets most, a second story still gets one', () => {
    const plan = planHot(catalog(), now, 3);
    expect(plan.reduce((a, g) => a + g.reels, 0)).toBe(3);
    expect(plan[0].key).toBe('yella beezy');
    expect(plan.length).toBeGreaterThanOrEqual(2);
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

  it('the brief asks for different incidents and a complete first sentence', () => {
    const [g] = planHot(catalog(), now, 3);
    const b = hotBrief(g);
    expect(b).toContain('DIFFERENT incident');
    expect(b).toContain(`Make ${g.reels} reels`);
    expect(b).toContain('Yella Beezy Gets Life');
  });
});

describe('hot videos: two of three reels are reserved, a third when something is strongly hot', () => {
  const two = [v('a', { entity: 'p', views: 1_500, strongMoments: 8 }), v('b', { entity: 'q', views: 1_200, strongMoments: 8 }), v('c', { entity: 'r', views: 900, strongMoments: 8 })];

  it('a normal day: 2 of 3 reels from hot videos, the rest for the topic brain', () => {
    expect(HOT_RESERVED).toBe(2);
    const day = planHotDay(two, now, { target: 3, newsReels: 0 });
    expect(day.strong).toBe(false);
    expect(day.hotTarget).toBe(2);
    expect(day.groups.reduce((a, g) => a + g.reels, 0)).toBe(2);
  });

  it('the new-video lane counts toward the two', () => {
    const day = planHotDay(two, now, { target: 3, newsReels: 1 });
    expect(day.groups.reduce((a, g) => a + g.reels, 0)).toBe(1);
    expect(planHotDay(two, now, { target: 3, newsReels: 2 }).groups).toEqual([]);
  });

  it('something strongly hot (a live with thousands of views a day, or an audience-share topic) earns the third reel', () => {
    const day = planHotDay([...two, v('live', { entity: 's', views: 90_000, strongMoments: 12, publishedAt: daysAgo(2) })], now, { target: 3, newsReels: 0 });
    expect(day.strong).toBe(true);
    expect(day.hotTarget).toBe(3);
    expect(day.groups.reduce((a, g) => a + g.reels, 0)).toBe(3);
    expect(planHotDay([...two, v('trend', { entity: 's', views: 500, trend: 0.95 })], now, { target: 3, newsReels: 0 }).strong).toBe(true);
  });

  it('a smaller daily target is respected', () => {
    expect(planHotDay(catalog(), now, { target: 2, newsReels: 0 }).groups.reduce((a, g) => a + g.reels, 0)).toBe(2);
  });

  it('no hot footage: nothing is reserved, the day runs the old way', () => {
    expect(planHotDay([v('old', { publishedAt: daysAgo(400) })], now, { target: 3, newsReels: 0 }).groups).toEqual([]);
  });
});

describe('relaxed opening rules follow the age of the best video', () => {
  it('only a campaign whose first video is under 7 days old', () => {
    expect(RELAXED_DAYS).toBe(7);
    expect(isRelaxedCampaign([v('a', { publishedAt: daysAgo(2) }), v('b', { publishedAt: daysAgo(12) })], now)).toBe(true);
    expect(isRelaxedCampaign([v('a', { publishedAt: daysAgo(9) })], now)).toBe(false);
    expect(isRelaxedCampaign([], now)).toBe(false);
  });
});

describe('hot videos: the backup', () => {
  it('takes hot videos first, even ones the day already used, and skips videos whose campaign failed', () => {
    const picks = pickHotBackup(catalog(), new Set(['IE0g']), now, 3).map((x) => x.youtubeId);
    expect(picks).not.toContain('IE0g');
    expect(picks.slice(0, 3).every((id) => ['xb4j', 'uMtx', 'pSqs', '2WH', 'cl5A', 'YrUx', 'YEfu'].includes(id))).toBe(true);
  });

  it('tops up with the strongest older footage when too few videos are hot', () => {
    const picks = pickHotBackup([v('h', { strongMoments: 8 }), v('old1', { publishedAt: daysAgo(500), strongMoments: 141, views: 300_000 })], new Set(), now, 3).map((x) => x.youtubeId);
    expect(picks).toEqual(['h', 'old1']);
  });
});
