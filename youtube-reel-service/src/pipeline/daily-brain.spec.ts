import { BrainCandidate, BrainContext, CandidateEvidence, capacity, ENTITY_CAP, scoreCandidate, selectPortfolio, splitReels, isSpike } from './daily-brain';

const cand = (name: string, entity: string | null, pillar: string | null, signal: BrainCandidate['signal'] = 'trend'): BrainCandidate => ({ name, brief: name, why: name, keywords: [name], signal, pillar, entity });
const ev = (o: Partial<CandidateEvidence> = {}): CandidateEvidence => ({ moments: 80, videos: 100, strongMoments: 20, minableVideos: 0, trendMatch: 0.5, trendTitle: null, velocityShare: 0.1, ...o });
const ctx = (o: Partial<BrainContext> = {}): BrainContext => ({ recentMainEntities: [], pillars: {}, targetReels: 7, ...o });

describe('daily brain: scoring', () => {
  it('ranks fresh demand with real material above an archive pile with no demand', () => {
    const hot = scoreCandidate(cand('hot', 'a', 'p1'), ev({ trendMatch: 0.9, strongMoments: 14 }), ctx());
    const pile = scoreCandidate(cand('pile', 'b', 'p2', 'archive'), ev({ trendMatch: 0, moments: 400, videos: 600, strongMoments: 40 }), ctx());
    expect(hot.score).toBeGreaterThan(pile.score);
  });

  it('archive size alone does not win: 400 matching moments are worth no more than enough strong ones', () => {
    const small = scoreCandidate(cand('small', 'a', null), ev({ moments: 30, strongMoments: 14 }), ctx());
    const huge = scoreCandidate(cand('huge', 'a', null), ev({ moments: 900, strongMoments: 14 }), ctx());
    expect(huge.score).toBe(small.score);
  });

  it('is ineligible without enough strong unused moments or footage, and says why', () => {
    expect(scoreCandidate(cand('x', 'a', null), ev({ strongMoments: 2 }), ctx())).toMatchObject({ eligible: false, reason: 'only 2 strong unused moments and 0 unanalysed videos' });
    expect(scoreCandidate(cand('x', 'a', null), ev({ moments: 1, videos: 1 }), ctx()).reason).toBe('not enough matching footage');
  });

  it('footage the campaign can still analyse counts as material (a topic the host covers a lot is not rejected for having no mined moments yet)', () => {
    const unmined = scoreCandidate(cand('pooh', 'pooh shiesty', 'p'), ev({ moments: 2, videos: 114, strongMoments: 0, minableVideos: 100, trendMatch: 0.4 }), ctx());
    expect(unmined.eligible).toBe(true);
    expect(capacity({ strongMoments: 0, minableVideos: 100 })).toBe(12); // capped at 8 videos x 1.5
    const mined = scoreCandidate(cand('m', 'm', 'p'), ev({ strongMoments: 14, minableVideos: 0, trendMatch: 0.4 }), ctx());
    expect(mined.components.supply).toBeGreaterThanOrEqual(unmined.components.supply);
  });

  it('a pillar not covered for a long time scores higher than one covered yesterday', () => {
    const c = ctx({ pillars: { fresh: { daysSinceCovered: 1, lift: 1, posts: 0 }, stale: { daysSinceCovered: 14, lift: 1, posts: 0 } } });
    expect(scoreCandidate(cand('s', 'a', 'stale'), ev(), c).score).toBeGreaterThan(scoreCandidate(cand('f', 'a', 'fresh'), ev(), c).score);
  });

  it('a spike needs both the channel concentration and a matching fresh trend', () => {
    expect(isSpike({ velocityShare: 0.84, trendMatch: 0.6 })).toBe(true);
    expect(isSpike({ velocityShare: 0.84, trendMatch: 0.1 })).toBe(false);
    expect(isSpike({ velocityShare: 0.1, trendMatch: 0.9 })).toBe(false);
  });
});

describe('daily brain: entity saturation (the Diddy-every-day problem)', () => {
  const topics = [
    { c: cand('Diddy transfer', 'diddy', 'celebrity'), spike: true },
    { c: cand('Keefe D homecoming', 'keefe d', 'reentry'), spike: false },
    { c: cand('Solitary explained', null, 'solitary'), spike: false },
  ];
  // replay five days: pick the main topic each day and feed the choice back as the next day's memory
  const replay = (diddy: Partial<CandidateEvidence>) => {
    const recent: Array<string | null> = [];
    const picks: string[] = [];
    for (let day = 0; day < 5; day++) {
      const scored = topics.map((t, i) => scoreCandidate(t.c, ev(i === 0 ? { trendMatch: 0.95, strongMoments: 30, ...diddy } : { trendMatch: i === 1 ? 0.4 : 0.2, strongMoments: 12 }), ctx({ recentMainEntities: [...recent].reverse().slice(0, 5) })));
      const main = selectPortfolio(scored, ctx({ recentMainEntities: [...recent].reverse().slice(0, 5) })).main!;
      picks.push(main.c.name);
      recent.push(main.c.entity);
    }
    return picks;
  };

  it('without a news spike one person leads at most ENTITY_CAP of 5 days', () => {
    const picks = replay({ velocityShare: 0.1 });
    expect(picks.filter((p) => p === 'Diddy transfer').length).toBeLessThanOrEqual(ENTITY_CAP);
    expect(new Set(picks).size).toBeGreaterThanOrEqual(2);
  });

  it('during a real spike the story may lead more days, but never all five', () => {
    const picks = replay({ velocityShare: 0.84 });
    const n = picks.filter((p) => p === 'Diddy transfer').length;
    expect(n).toBeGreaterThan(ENTITY_CAP);
    expect(n).toBeLessThan(5);
  });
});

describe('daily brain: portfolio', () => {
  it('splits 60/40 and keeps small days to one topic', () => {
    expect(splitReels(7)).toEqual({ main: 5, explore: 2 });
    expect(splitReels(6)).toEqual({ main: 4, explore: 2 });
    expect(splitReels(5)).toEqual({ main: 3, explore: 2 });
    expect(splitReels(4)).toEqual({ main: 4, explore: 0 });
  });

  it('explore comes from a different entity and pillar, one not covered for a week', () => {
    const c = ctx({ pillars: { celebrity: { daysSinceCovered: 0, lift: 1, posts: 0 }, intake: { daysSinceCovered: 2, lift: 1, posts: 0 }, solitary: { daysSinceCovered: 20, lift: 1, posts: 0 }, family: { daysSinceCovered: null, lift: 1, posts: 0 } } });
    const scored = [
      scoreCandidate(cand('Diddy', 'diddy', 'celebrity'), ev({ trendMatch: 0.9 }), c),
      scoreCandidate(cand('Diddy again', 'diddy', 'solitary'), ev({ trendMatch: 0.3 }), c), // same entity: not allowed as explore
      scoreCandidate(cand('Intake', 'x', 'intake'), ev({ trendMatch: 0.7 }), c), // covered 2 days ago: not allowed
      scoreCandidate(cand('Supermax', 'adx', 'solitary'), ev({ trendMatch: 0.2 }), c),
      scoreCandidate(cand('Family', 'y', 'family'), ev({ trendMatch: 0.1 }), c),
    ];
    const p = selectPortfolio(scored, c);
    expect(p.main!.c.name).toBe('Diddy');
    expect(p.explore!.c.name).toMatch(/Supermax|Family/);
    expect(p.mainReels + p.exploreReels).toBe(7);
  });

  it('with no usable explore topic the whole day goes to the main topic', () => {
    const c = ctx({ pillars: { a: { daysSinceCovered: 0, lift: 1, posts: 0 } } });
    const p = selectPortfolio([scoreCandidate(cand('Only', 'o', 'a'), ev(), c)], c);
    expect(p).toMatchObject({ explore: null, mainReels: 7, exploreReels: 0 });
  });

  it('returns nothing when no candidate is eligible', () => {
    const c = ctx();
    expect(selectPortfolio([scoreCandidate(cand('Thin', 'o', null), ev({ strongMoments: 1 }), c)], c).main).toBeNull();
  });
});
