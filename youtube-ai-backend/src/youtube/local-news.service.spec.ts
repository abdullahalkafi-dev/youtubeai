import {
  LocalNewsService,
  normalizeText,
  requiredMatches,
  escapeRegex,
  rankAndCapNews,
  rankAndCapBroll,
} from './local-news.service';
import type { YouTubeService } from './youtube.service';
import type { QuotaService } from '../quota/quota.service';
import {
  LOCAL_STATION_REGEX,
  BROADCAST_CALLSIGN_REGEX,
  isLikelyBroadcastStation,
  TIER1_NEWS_CHANNELS,
  TIER2_NEWS_CHANNELS,
  isTier1AllowedChannel,
  isTier2AllowedChannel,
  TIER1_LABEL,
  TIER2_LABEL,
  LIKELY_LOCAL_LABEL,
  BROLL_LABEL,
} from './news-channels';
import { normalizeLocationHint } from '../chat/footage-intent.service';

describe('LocalNewsService.resolveMarket', () => {
  let svc: LocalNewsService;

  beforeAll(() => {
    svc = new LocalNewsService(
      null as unknown as YouTubeService,
      null as unknown as QuotaService,
    );
  });

  const resolve = (text: string) =>
    svc.resolveMarket(undefined, text)?.label ?? null;

  it('resolves Fort Walton Beach / NW Florida stories to the panhandle market', () => {
    expect(
      resolve(
        'Aubrey Darnell Joseph Sr. of Fort Walton Beach, Florida fentanyl plea',
      ),
    ).toBe('Pensacola / Panama City, FL');
    expect(resolve('okaloosa county fentanyl raid')).toBe(
      'Pensacola / Panama City, FL',
    );
    expect(resolve('fort walton beach man pleads guilty')).toBe(
      'Pensacola / Panama City, FL',
    );
    expect(resolve('pensacola traffic stop')).toBe(
      'Pensacola / Panama City, FL',
    );
  });

  it('resolves generic "florida" (no city) to the panhandle fallback, not Miami', () => {
    expect(
      resolve(
        'can you find some local news on this\nFlorida man fentanyl plea',
      ),
    ).toBe('Pensacola / Panama City, FL');
    expect(resolve('somewhere in florida, unknown city')).toBe(
      'Pensacola / Panama City, FL',
    );
  });

  it('city keys beat state-level catch-all keys', () => {
    expect(resolve('Miami, Florida drug bust')).toBe('Miami, FL');
    expect(resolve('Dallas, Texas shooting')).toBe('Dallas, TX');
    expect(resolve('Houston man charged')).toBe('Houston, TX');
  });

  it('resolves other markets by city/county', () => {
    expect(
      resolve('Lil Durk acquitted at Los Angeles federal courthouse'),
    ).toBe('Los Angeles, CA');
    expect(resolve('Brooklyn MDC lockdown')).toBe('New York, NY');
    expect(resolve('atlanta rapper indictment')).toBe('Atlanta, GA');
    expect(resolve('chicago drill rap case')).toBe('Chicago, IL');
  });

  it('returns null when no market key matches', () => {
    expect(resolve('no location at all in this story')).toBeNull();
    expect(svc.resolveMarket(undefined, '')).toBeNull();
  });
});

describe('LocalNewsService.isFootageRequest', () => {
  let svc: LocalNewsService;

  beforeAll(() => {
    svc = new LocalNewsService(
      null as unknown as YouTubeService,
      null as unknown as QuotaService,
    );
  });

  it('detects footage / local-news phrasing that must trigger web research', () => {
    expect(svc.isFootageRequest('can you find some local news on this')).toBe(
      true,
    );
    expect(svc.isFootageRequest('give me b-roll for the script')).toBe(true);
    expect(svc.isFootageRequest('collect footage of the courthouse')).toBe(
      true,
    );
    expect(svc.isFootageRequest('what should I post next?')).toBe(false);
  });
});

describe('LocalNewsService.extractSearchTopic — chat chrome & references', () => {
  let svc: LocalNewsService;

  beforeAll(() => {
    svc = new LocalNewsService(
      null as unknown as YouTubeService,
      null as unknown as QuotaService,
    );
  });

  it('strips request chrome down to the subject', () => {
    expect(
      svc.extractSearchTopic(
        'can you please give me clips for the Miami hearing',
      ),
    ).toBe('the Miami hearing'); // leading "the" kept (strip would break "The Game")
    expect(svc.extractSearchTopic('give me local news for Miami')).toBe(
      'Miami',
    );
    expect(
      svc.extractSearchTopic('find some news clips for the Lil Durk verdict'),
    ).toBe('the Lil Durk verdict');
  });

  it('returns "" for bare local-news asks (market-only queries downstream)', () => {
    expect(svc.extractSearchTopic('give me local news')).toBe('');
    expect(svc.extractSearchTopic('local news')).toBe('');
  });

  it('returns "" for anaphoric leftovers — never raw chat as a query', () => {
    expect(
      svc.extractSearchTopic('can you give me script for this video'),
    ).toBe('');
    expect(svc.extractSearchTopic('local news for that topic')).toBe('');
    expect(svc.extractSearchTopic('news clips for the script')).toBe('');
    expect(svc.extractSearchTopic('give me b-roll for it')).toBe('');
  });
});

describe('LocalNewsService.findFootagePack — specific queries + relevance gate', () => {
  type Row = {
    videoId: string;
    title: string;
    channelTitle: string;
    thumbnailUrl: string;
  };

  function makeSvc(rows: Row[]) {
    const searchCalls: string[] = [];
    const youtube = {
      searchVideos: jest.fn((p: { query: string }) => {
        searchCalls.push(p.query);
        return Promise.resolve(rows);
      }),
      getVideoDetails: jest.fn((_t: string, ids: string[]) =>
        Promise.resolve(
          ids.map((id) => {
            const row = rows.find((r) => r.videoId === id);
            return {
              videoId: id,
              title: row?.title || `V ${id}`,
              channelTitle: row?.channelTitle || 'WPLG',
              videoUrl: `https://www.youtube.com/watch?v=${id}`,
              durationSeconds: 90,
              viewCount: 5000,
              embeddable: true,
              publishedAt: new Date().toISOString(),
            };
          }),
        ),
      ),
      getValidAccessToken: jest.fn(() => Promise.resolve('t')),
    };
    const quota = {
      countEndpointCallsToday: jest.fn(() => Promise.resolve(0)),
      checkQuota: jest.fn(() => Promise.resolve(undefined)),
      logCall: jest.fn(() => Promise.resolve(undefined)),
    };
    return {
      svc: new LocalNewsService(youtube as any, quota as any),
      searchCalls,
    };
  }

  const ROSS: Row = {
    videoId: 'ross01',
    title: 'Rick Ross arrested in Miami Beach on battery charges',
    channelTitle: 'WPLG',
    thumbnailUrl: '',
  };
  const BOEING: Row = {
    videoId: 'noise01',
    title: 'Boeing 767 overruns runway at MIA',
    channelTitle: 'WPLG',
    thumbnailUrl: '',
  };
  const TRUMP: Row = {
    videoId: 'noise02',
    title: 'Trump threatens Strait of Hormuz blockade',
    channelTitle: 'WTVJ',
    thumbnailUrl: '',
  };

  it('queries station/city + the SUBJECT (never the raw sentence)', async () => {
    const { svc, searchCalls } = makeSvc([ROSS]);
    const pack = await svc.findFootagePack({
      userId: 'u1',
      topic: 'Rick Ross',
      locationHint: 'Miami',
    });
    expect(searchCalls).toEqual(['WPLG Rick Ross', 'Miami news Rick Ross']);
    expect(pack?.clips.map((c) => c.videoId)).toContain('ross01');
  });

  it('gates out loosely-related titles that share no subject token', async () => {
    const { svc } = makeSvc([ROSS, BOEING, TRUMP]);
    const pack = await svc.findFootagePack({
      userId: 'u1',
      topic: 'Rick Ross',
      locationHint: 'Miami',
    });
    const ids = pack?.clips.map((c) => c.videoId) || [];
    expect(ids).toContain('ross01');
    expect(ids).not.toContain('noise01');
    expect(ids).not.toContain('noise02');
  });

  it('bare ask (no subject) → market-only queries, no gate', async () => {
    const { svc, searchCalls } = makeSvc([ROSS, BOEING]);
    const pack = await svc.findFootagePack({
      userId: 'u1',
      topic: '',
      locationHint: 'Miami',
    });
    expect(searchCalls).toEqual(['WPLG Miami news', 'Miami news latest']);
    // No subject → no relevance gate; station+duration filters still apply.
    expect(pack?.clips.length).toBe(2);
  });

  it('a subject that is just the city collapses to market-only queries', async () => {
    const { svc, searchCalls } = makeSvc([ROSS]);
    await svc.findFootagePack({
      userId: 'u1',
      topic: 'Miami',
      locationHint: 'Miami',
    });
    expect(searchCalls).toEqual(['WPLG Miami news', 'Miami news latest']);
  });

  it('returns null when no market resolves', async () => {
    const { svc, searchCalls } = makeSvc([ROSS]);
    const pack = await svc.findFootagePack({
      userId: 'u1',
      topic: 'Rick Ross',
      locationHint: 'no location at all in this story',
    });
    expect(pack).toBeNull();
    expect(searchCalls.length).toBe(0);
  });
});

describe('LocalNewsService.findCelebrityBrollPack — raw lifestyle clips & anti-commentary', () => {
  it('strictly filters out reaction, commentary, breakdown, and podcast titles', async () => {
    const rawClips = [
      {
        videoId: 'broll01',
        title: 'Lil Durk walking out of court in Miami',
        channelTitle: 'RapHub',
        channelId: 'c1',
        thumbnailUrl: 'https://img.com/1',
      },
      {
        videoId: 'react01',
        title: 'Lil Durk ARREST Breakdown & REACTION!',
        channelTitle: 'DramaLive',
        channelId: 'c2',
        thumbnailUrl: 'https://img.com/2',
      },
      {
        videoId: 'podcast01',
        title: 'Why Lil Durk Got Caught - Full Podcast Analysis',
        channelTitle: 'TalkPod',
        channelId: 'c3',
        thumbnailUrl: 'https://img.com/3',
      },
      {
        videoId: 'broll02',
        title: 'Lil Durk eating at restaurant with family',
        channelTitle: 'HipHopMoments',
        channelId: 'c4',
        thumbnailUrl: 'https://img.com/4',
      },
    ];

    const youtube = {
      searchVideos: jest.fn(async () => rawClips),
      getValidAccessToken: jest.fn(async () => 'token'),
      getVideoDetails: jest.fn(async (_tok: any, ids: string[]) =>
        ids.map((id) => ({
          videoId: id,
          title: rawClips.find((c) => c.videoId === id)?.title,
          channelTitle: rawClips.find((c) => c.videoId === id)?.channelTitle,
          videoUrl: `https://youtube.com/watch?v=${id}`,
          durationSeconds: 65,
          viewCount: 50000,
          thumbnailUrl: 'https://img.com',
          publishedAt: '2026-10-01T00:00:00Z',
        })),
      ),
    };

    const svc = new LocalNewsService(youtube as any, null as any);
    const pack = await svc.findCelebrityBrollPack({
      userId: 'u1',
      entity: 'Lil Durk',
      maxClips: 7,
    });

    expect(pack).not.toBeNull();
    expect(pack?.kind).toBe('broll');
    const ids = pack?.clips.map((c) => c.videoId) || [];
    expect(ids).toContain('broll01');
    expect(ids).toContain('broll02');
    expect(ids).not.toContain('react01');
    expect(ids).not.toContain('podcast01');
  });
});

describe('Phase 4 — Broadcast Station Regexes & Call Signs', () => {
  it('matches valid local stations and affiliates', () => {
    const validStations = [
      'FOX31',
      'ABC7',
      'NBC 5',
      'CBS Colorado',
      'NBC Chicago',
      'Channel 9',
      'Local 10',
      'Action News',
      'Eyewitness News',
      'CBS News Colorado',
      'CBS News Chicago',
      'Denver7',
      'KTLA 5',
      'WPLG Local 10',
      'KUSA News',
      '12 News',
      '9NEWS',
      '11Alive',
    ];
    for (const st of validStations) {
      expect(isLikelyBroadcastStation(st)).toBe(true);
    }
  });

  it('rejects national branches, networks, and stoplist tokens', () => {
    const invalid = [
      'FOX Sports',
      'ABC Kids',
      'NBC Entertainment',
      'Kids TV',
      'Week 3',
      'What',
      'With',
      'Work',
      'FOX News',
      'ABC News',
      'NBC News',
      'CBS News',
      'FOX Nation',
      'NBC Olympics',
      'WNBA',
      'WWE',
      'WION',
      'WOW',
      'WTF',
    ];
    for (const inv of invalid) {
      expect(isLikelyBroadcastStation(inv)).toBe(false);
    }
  });
});

describe('Phase 4 — Token Math & Accent Normalization', () => {
  it('implements exact requiredMatches math R(n)', () => {
    expect(requiredMatches(1)).toBe(1);
    expect(requiredMatches(2)).toBe(2);
    expect(requiredMatches(3)).toBe(2);
    expect(requiredMatches(4)).toBe(3);
    expect(requiredMatches(5)).toBe(3);
    expect(requiredMatches(6)).toBe(4);
  });

  it('normalizes accents and diacritics', () => {
    expect(normalizeText('José')).toBe('jose');
    expect(normalizeText('François')).toBe('francois');
    expect(normalizeText('München')).toBe('munchen');
  });
});

describe('Phase 4 — 50-State Location Normalization', () => {
  it('safely normalizes city strings across 50 states + DC without breaking hyphenated cities', () => {
    expect(normalizeLocationHint('Winston-Salem')).toBe('Winston-Salem');
    expect(normalizeLocationHint('Wilkes-Barre')).toBe('Wilkes-Barre');
    expect(normalizeLocationHint('New York, NY')).toBe('New York');
    expect(normalizeLocationHint('New York')).toBe('New York');
    expect(normalizeLocationHint('Colorado Springs, CO')).toBe('Colorado Springs');
    expect(normalizeLocationHint('St. Louis, MO')).toBe('St. Louis');
    expect(normalizeLocationHint('Miami FL')).toBe('Miami');
    expect(normalizeLocationHint('Chicago, Illinois')).toBe('Chicago');
    expect(normalizeLocationHint('')).toBeUndefined();
  });

  it('properly escapes punctuation in locations for regex compilation', () => {
    expect(escapeRegex('St. Louis')).toBe('St\\. Louis');
    expect(escapeRegex('Washington, D.C.')).toBe('Washington, D\\.C\\.');
  });
});

describe('Phase 4 — findAdaptiveFootagePack Autonomous Gating & Ranking', () => {
  function makeMockYoutube(videoRows: any[], details: any[]) {
    return {
      searchVideos: jest.fn(async () => videoRows),
      getValidAccessToken: jest.fn(async () => 'valid_token'),
      getVideoDetails: jest.fn(async () => details),
    };
  }

  it('ranks and caps news clips to max 3 with honest provenance labels', async () => {
    const clips = [
      {
        videoId: 'v1',
        title: 'News 1',
        channelTitle: 'FOX31 Denver',
        channelId: 'UCaoDaJH-Ji_NBpQOn5aeX7A', // Tier 1
        videoUrl: 'https://youtube.com/watch?v=v1',
        durationSeconds: 120,
        viewCount: 1000,
        publishedAt: '2026-10-01T00:00:00Z',
      },
      {
        videoId: 'v2',
        title: 'News 2',
        channelTitle: 'Action News Local', // Likely Local
        channelId: 'unverified1',
        videoUrl: 'https://youtube.com/watch?v=v2',
        durationSeconds: 120,
        viewCount: 2000,
        publishedAt: '2026-10-02T00:00:00Z',
        tierLabel: LIKELY_LOCAL_LABEL,
      },
      {
        videoId: 'v3',
        title: 'News 3',
        channelTitle: 'SAY CHEESE!', // Tier 2
        channelId: 'UC0KfHrqdI1sWILqSBQTALGA',
        videoUrl: 'https://youtube.com/watch?v=v3',
        durationSeconds: 120,
        viewCount: 5000,
        publishedAt: '2026-10-03T00:00:00Z',
        tierLabel: TIER2_LABEL,
      },
      {
        videoId: 'v4',
        title: 'News 4',
        channelTitle: 'AP', // Tier 1
        channelId: 'UCAb6wjEu3EOzsVihpR9N1Ug',
        videoUrl: 'https://youtube.com/watch?v=v4',
        durationSeconds: 120,
        viewCount: 800,
        publishedAt: '2026-10-04T00:00:00Z',
      },
    ];

    const ranked = rankAndCapNews(clips as any);
    expect(ranked.length).toBe(3);
    // Tier 1 clips (v4, v1) should beat Tier 2 and Likely Local
    expect(ranked[0].videoId).toBe('v4'); // Tier 1 + newer
    expect(ranked[1].videoId).toBe('v1'); // Tier 1
    expect(ranked[2].videoId).toBe('v2'); // Likely Local
  });

  it('ranks and caps B-roll clips to max 2 penalizing duration deviations from 60-120s window', async () => {
    const clips = [
      {
        videoId: 'b1',
        title: 'Lil Durk walking lifestyle cutaway',
        channelTitle: 'RapMoments',
        durationSeconds: 85, // in 60-120s ideal window -> penalty 0
        viewCount: 1000,
        publishedAt: '2026-10-01T00:00:00Z',
      },
      {
        videoId: 'b2',
        title: 'Lil Durk arriving at court moments',
        channelTitle: 'HipHopDaily',
        durationSeconds: 200, // penalty 80
        viewCount: 5000,
        publishedAt: '2026-10-02T00:00:00Z',
      },
      {
        videoId: 'b3',
        title: 'Lil Durk eating lifestyle',
        channelTitle: 'MomentsLive',
        durationSeconds: 110, // in 60-120s ideal window -> penalty 0
        viewCount: 2000,
        publishedAt: '2026-10-03T00:00:00Z',
      },
    ];

    const ranked = rankAndCapBroll(clips as any, new Set(['lil', 'durk']));
    expect(ranked.length).toBe(2);
    // Ideal duration window clips (b3, b1) beat b2
    expect(ranked.map((c) => c.videoId)).toEqual(['b3', 'b1']);
  });

  it('celebrity_hiphop gates B-roll on entity + visual terms and rejects Category 10 (Music)', async () => {
    const rawSearch = [
      { videoId: 'music01', title: 'Lil Durk Official Music Video', channelId: 'c1', channelTitle: 'Lil Durk' },
      { videoId: 'cutaway01', title: 'Lil Durk walking out of courthouse lifestyle', channelId: 'c2', channelTitle: 'Media' },
    ];
    const details = [
      { videoId: 'music01', title: 'Lil Durk Official Music Video', durationSeconds: 180, categoryId: '10', embeddable: true },
      { videoId: 'cutaway01', title: 'Lil Durk walking out of courthouse lifestyle', durationSeconds: 90, categoryId: '24', embeddable: true },
    ];

    const yt = makeMockYoutube(rawSearch, details);
    const quota = {
      checkQuota: jest.fn(async () => undefined),
      countEndpointCallsToday: jest.fn(async () => 0),
      logCall: jest.fn(async () => undefined),
    };

    const svc = new LocalNewsService(yt as any, quota as any);
    const pack = await svc.findAdaptiveFootagePack({
      userId: 'u1',
      primaryEntity: 'Lil Durk',
      storyType: 'celebrity_hiphop',
      requestTypes: ['broll'],
    });

    expect(pack).not.toBeNull();
    const ids = pack?.clips.map((c) => c.videoId) || [];
    expect(ids).toContain('cutaway01');
    expect(ids).not.toContain('music01'); // Category 10 rejected
  });

  it('allows verified news channels up to 2,400s for hearings while capping unverified at <= 240s', async () => {
    const rawSearch = [
      { videoId: 'presser01', title: 'Denver Police press conference courthouse', channelId: 'UC_-gT7OYiRCK9Sp8SIv9WgQ', channelTitle: 'CBS Colorado' }, // verified
      { videoId: 'long01', title: 'B-roll courthouse walk', channelId: 'unverified99', channelTitle: 'RandomGuy' }, // unverified
    ];
    const details = [
      { videoId: 'presser01', title: 'Denver Police press conference courthouse', durationSeconds: 1800, embeddable: true },
      { videoId: 'long01', title: 'B-roll courthouse walk', durationSeconds: 300, embeddable: true }, // > 240s unverified
    ];

    const yt = makeMockYoutube(rawSearch, details);
    const quota = {
      checkQuota: jest.fn(async () => undefined),
      countEndpointCallsToday: jest.fn(async () => 0),
      logCall: jest.fn(async () => undefined),
    };

    const svc = new LocalNewsService(yt as any, quota as any);
    const pack = await svc.findAdaptiveFootagePack({
      userId: 'u1',
      primaryEntity: 'Denver Police',
      storyType: 'breaking_crime',
      requestTypes: ['broll'],
    });

    const ids = pack?.clips.map((c) => c.videoId) || [];
    expect(ids).toContain('presser01'); // Verified up to 2400s accepted
    expect(ids).not.toContain('long01'); // Unverified > 240s rejected
  });

  it('handles 403 quota errors without writing to negative cache', async () => {
    const yt = {
      searchVideos: jest.fn(async () => {
        const err = new Error('quotaExceeded');
        (err as any).code = 403;
        throw err;
      }),
      getValidAccessToken: jest.fn(async () => 'valid_token'),
      getVideoDetails: jest.fn(async () => []),
    };
    const quota = {
      checkQuota: jest.fn(async () => undefined),
      countEndpointCallsToday: jest.fn(async () => 0),
      logCall: jest.fn(async () => undefined),
    };

    const svc = new LocalNewsService(yt as any, quota as any);
    const pack = await svc.findAdaptiveFootagePack({
      userId: 'u1',
      primaryEntity: 'Lil Durk',
      requestTypes: ['news'],
    });

    expect(pack).not.toBeNull();
    expect(pack?.clips.length).toBe(0);
    expect(pack?.note).toContain('Footage search is temporarily unavailable');

    // Negative cache should NOT be set
    const cacheKey = 'u1::lildurk::::news::none';
    expect((svc as any).topicCache.has(cacheKey)).toBe(false);
  });
});


