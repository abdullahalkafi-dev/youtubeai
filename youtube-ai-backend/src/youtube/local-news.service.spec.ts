import { LocalNewsService } from './local-news.service';
import type { YouTubeService } from './youtube.service';
import type { QuotaService } from '../quota/quota.service';

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
