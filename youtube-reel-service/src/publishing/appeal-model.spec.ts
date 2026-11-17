import { AGE_FIT_MIN, ageTier, cosine, DEFAULT_APPEAL_MODEL, fitAppealModel, MIN_FIT_POSTS, openerKind, SAME_STORY, sourcePostCap, topicKind, withAge } from './appeal-model';

/** Built from the real opening lines and titles of the Nov 13 2026 audit (76 posted reels). */
describe('opening line (Nov 13 audit)', () => {
  it('the best reels open with the host himself', () => {
    expect(openerKind('I spent 26 years on the inside.')).toBe('first-person'); // 13,148 views
    expect(openerKind('I was vicious before I met Dr. Mutulu Shakur.')).toBe('first-person'); // 5,919
    expect(openerKind('We had to wash our drawers in our toilets.')).toBe('first-person'); // 2,719
    expect(openerKind("But I'm not even into the penitentiary an hour and I see a dude get killed.")).toBe('first-person'); // 2,472
    expect(openerKind('My brother was dead.')).toBe('first-person');
  });

  it('a famous name in the first line counts as named', () => {
    expect(openerKind("Once they see that that's Tory Lanez, it's a wrap.")).toBe('named'); // 3,538
    expect(openerKind('For a famous inmate like Diddy, fear got cameras attached.')).toBe('named');
    expect(openerKind('Keefe D may beat the case.')).toBe('named');
  });

  it('the worst reels opened with a general statement or advice', () => {
    expect(openerKind('Recreation is not just exercise.')).toBe('general'); // 236
    expect(openerKind('A name cannot stop a fist.')).toBe('general'); // 286
    expect(openerKind('Little things become enormous.')).toBe('general'); // 260
    expect(openerKind('The audience can make you dangerous to yourself.')).toBe('you'); // 324
    expect(openerKind('')).toBe('general');
  });
});

describe('topic angle (Nov 13 audit)', () => {
  it('prison life vs court procedure', () => {
    expect(topicKind('Federal prison: The guard controlled when my toilet flushed')).toBe('prison-life');
    expect(topicKind("El Chapo at ADX: Why I Refused My One Hour Outside")).toBe('prison-life');
    expect(topicKind("Keefe D: Where Is the Murder Weapon? The Defense's Question")).toBe('legal');
    expect(topicKind('Big30: Bond Release Doesn\'t Prove He Cooperated')).toBe('legal');
    expect(topicKind("Yella Beezy: Why White's Trial Transcript Could Take 30 Days")).toBe('legal');
    expect(topicKind('Street code: Does keeping quiet actually give you peace?')).toBe('other');
  });
});

describe('the model learns from real views', () => {
  it('keeps the audit defaults until there are enough posts', () => {
    expect(fitAppealModel([{ hook: 'I did time.', text: 'x', views: 9000 }])).toBe(DEFAULT_APPEAL_MODEL);
  });

  it('lifts what did well and sinks what did badly, shrunk for small groups', () => {
    const rows = [
      ...Array.from({ length: 12 }, () => ({ hook: 'I spent 26 years on the inside.', text: 'the guard and my cell', views: 4000 })),
      ...Array.from({ length: 12 }, () => ({ hook: 'Recreation is not just exercise.', text: 'what prosecutors can prove at trial', views: 500 })),
    ];
    expect(rows.length).toBeGreaterThanOrEqual(MIN_FIT_POSTS);
    const m = fitAppealModel(rows, new Date('2026-11-13T12:00:00Z'));
    expect(m.n).toBe(24);
    expect(m.opener['first-person']).toBeGreaterThan(m.opener.general);
    expect(m.topic['prison-life']).toBeGreaterThan(m.topic.legal);
    expect(m.opener.named).toBe(DEFAULT_APPEAL_MODEL.opener.named); // no data: stays at the prior
    expect(Math.max(...Object.values(m.opener), ...Object.values(m.topic))).toBeLessThanOrEqual(30);
  });
});

describe('same story', () => {
  it('cosine similarity, and the threshold sits above unrelated reels', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine(undefined, [1])).toBe(0);
    expect(SAME_STORY).toBeGreaterThan(0.62); // the 99th percentile of all posted pairs
    expect(SAME_STORY).toBeLessThanOrEqual(0.706); // the re-posted toilet story
  });
});

describe('age of the source video (Nov 17 audit)', () => {
  it('tiers: under 3 days, 3 to 15 days, older (unknown = older)', () => {
    expect(ageTier(0.4)).toBe('new');
    expect(ageTier(2.9)).toBe('new');
    expect(ageTier(3)).toBe('recent');
    expect(ageTier(15)).toBe('recent');
    expect(ageTier(15.1)).toBe('older');
    expect(ageTier(undefined)).toBe('older');
    expect(ageTier(-2)).toBe('older');
  });

  it('starts with new +12, recent +6, older 0; an old stored model gets those without losing its other lifts', () => {
    expect(DEFAULT_APPEAL_MODEL.age).toEqual({ new: 12, recent: 6, older: 0 });
    const old = withAge({ opener: { 'first-person': 20, named: 1, you: 0, general: 0 }, topic: DEFAULT_APPEAL_MODEL.topic, n: 40 });
    expect(old.opener['first-person']).toBe(20);
    expect(old.age).toEqual(DEFAULT_APPEAL_MODEL.age);
  });

  const row = (views: number, ageDays: number, postedDaysAgo = 5) => ({ hook: 'I did time.', text: 'x', views, ageDays, postedDaysAgo });

  it('keeps the defaults until enough recent posts carry an age', () => {
    const rows = Array.from({ length: MIN_FIT_POSTS }, () => row(1000, 1));
    expect(AGE_FIT_MIN).toBeGreaterThan(MIN_FIT_POSTS - 6);
    expect(fitAppealModel(rows.map((r) => ({ ...r, ageDays: undefined as any }))).age).toEqual(DEFAULT_APPEAL_MODEL.age);
  });

  it('is refit from real views: if new videos do better the lift grows, if they do worse it falls', () => {
    const win = [...Array.from({ length: 6 }, () => row(5000, 1)), ...Array.from({ length: 14 }, () => row(1000, 40))];
    const lose = [...Array.from({ length: 6 }, () => row(500, 1)), ...Array.from({ length: 14 }, () => row(2500, 40))];
    expect(fitAppealModel(win).age.new).toBeGreaterThan(DEFAULT_APPEAL_MODEL.age.new);
    expect(fitAppealModel(lose).age.new).toBeLessThan(DEFAULT_APPEAL_MODEL.age.new);
  });

  it('weeks before the last 21 days do not count (they were weak for every reel)', () => {
    const stale = Array.from({ length: 30 }, () => row(300, 1, 40)); // old posts only
    expect(fitAppealModel(stale).age).toEqual(DEFAULT_APPEAL_MODEL.age);
  });

  it('a big video that is still new may give more posts; anything else keeps the limit of 2', () => {
    expect(sourcePostCap(50_000, 3)).toBe(4);
    expect(sourcePostCap(12_000, 3)).toBe(3);
    expect(sourcePostCap(4_000, 3)).toBe(2);
    expect(sourcePostCap(50_000, 40)).toBe(2);
    expect(sourcePostCap(undefined, undefined)).toBe(2);
  });
});
