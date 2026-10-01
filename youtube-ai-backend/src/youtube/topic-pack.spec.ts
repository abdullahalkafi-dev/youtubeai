import { LocalNewsService } from './local-news.service';

/**
 * Phase 2 lite — findTopicFootagePack.
 * Includes Claude's pre-deploy regression fixture: for a "Lil Durk verdict"
 * topic, at least 3 of these verified video IDs must survive filtering:
 * lcdiQY2kYhw, y4uubcchlO0, r8O91QC4BtY, QIwVRgJJass, NijnAwhFUtA, A4iuSrmuCoc
 */
const GATE_IDS = [
  'lcdiQY2kYhw',
  'y4uubcchlO0',
  'r8O91QC4BtY',
  'QIwVRgJJass',
  'NijnAwhFUtA',
  'A4iuSrmuCoc',
];

// Real hosts resolved from oEmbed (Oct 2026)
const ABC7 = 'UCVxBA3Cbu3pm8w8gEIoMEog';
const NBCLA = 'UCSWoppsVL0TLxFQ2qP_DLqQ';
const ABC7CHI = 'UC_vFLohxs5PkAxlk7Y6jEtw';
const RANDOM = 'UCxxxxxxxxxxxxxxxxxxxxxx';

type Row = {
  videoId: string;
  title: string;
  channelTitle: string;
  channelId: string;
  thumbnailUrl: string;
};

const gateRows: Row[] = [
  {
    videoId: 'lcdiQY2kYhw',
    title:
      'Jury finds rapper Lil Durk not guilty of orchestrating 2022 murder-for-hire plot',
    channelTitle: 'ABC7',
    channelId: ABC7,
    thumbnailUrl: '',
  },
  {
    videoId: 'y4uubcchlO0',
    title: 'Lil Durk found not guilty in murder-for-hire trial',
    channelTitle: 'NBCLA',
    channelId: NBCLA,
    thumbnailUrl: '',
  },
  {
    videoId: 'r8O91QC4BtY',
    title:
      'Live: Lil Durk found not guilty, crowd gathers outside LA courthouse',
    channelTitle: 'NBCLA',
    channelId: NBCLA,
    thumbnailUrl: '',
  },
  {
    videoId: 'QIwVRgJJass',
    title: 'Jury acquits Chicago rapper Lil Durk of all federal charges',
    channelTitle: 'ABC 7 Chicago',
    channelId: ABC7CHI,
    thumbnailUrl: '',
  },
  {
    videoId: 'NijnAwhFUtA',
    title: 'Breaking: Lil Durk found not guilty in murder-for-hire trial',
    channelTitle: 'NBCLA',
    channelId: NBCLA,
    thumbnailUrl: '',
  },
  {
    videoId: 'A4iuSrmuCoc',
    title: 'Rapper Lil Durk found not guilty in murder-for-hire case',
    channelTitle: 'ABC7',
    channelId: ABC7,
    thumbnailUrl: '',
  },
  // Noise that must be filtered out
  {
    videoId: 'notallowed01',
    title: 'Some random channel on the verdict',
    channelTitle: 'Random Channel',
    channelId: RANDOM,
    thumbnailUrl: '',
  },
  {
    videoId: 'commentary01',
    title: 'Lil Durk verdict REACTION — my take',
    channelTitle: 'NBCLA',
    channelId: NBCLA,
    thumbnailUrl: '',
  },
];

function makeService(
  opts: {
    searchResults?: Row[][] | ((query: string, call: number) => Row[]);
    capUsed?: number;
    details?: Array<
      Partial<{
        videoId: string;
        title: string;
        channelTitle: string;
        videoUrl: string;
        durationSeconds: number;
        viewCount: number;
        embeddable: boolean;
        publishedAt: string;
      }>
    >;
  } = {},
) {
  const searchCalls: string[] = [];
  let call = 0;
  const youtube = {
    searchVideos: jest.fn((p: { query: string }): Promise<Row[]> => {
      searchCalls.push(p.query);
      call++;
      if (typeof opts.searchResults === 'function') {
        return Promise.resolve(opts.searchResults(p.query, call));
      }
      const arr = opts.searchResults || [gateRows];
      return Promise.resolve(arr[Math.min(call - 1, arr.length - 1)] || []);
    }),
    getVideoDetails: jest.fn((_tok: string, ids: string[]) => {
      const provided = opts.details;
      const details = ids.map((id) => {
        if (provided) {
          const hit = provided.find((d) => d.videoId === id);
          if (hit)
            return {
              videoUrl: `https://www.youtube.com/watch?v=${id}`,
              ...hit,
            };
        }
        const row = gateRows.find((r) => r.videoId === id);
        return {
          videoId: id,
          title: row?.title || `Video ${id}`,
          channelTitle: row?.channelTitle || 'News',
          videoUrl: `https://www.youtube.com/watch?v=${id}`,
          durationSeconds: 120,
          viewCount: 1000,
          embeddable: true,
          publishedAt: new Date().toISOString(),
        };
      });
      return Promise.resolve(details);
    }),
    getValidAccessToken: jest.fn(() => Promise.resolve('token')),
  };
  const quota = {
    countEndpointCallsToday: jest.fn(() => Promise.resolve(opts.capUsed ?? 0)),
    checkQuota: jest.fn(() => Promise.resolve(undefined)),
    logCall: jest.fn(() => Promise.resolve(undefined)),
  };
  const svc = new LocalNewsService(youtube as any, quota as any);
  return { svc, searchCalls, youtube, quota };
}

describe('findTopicFootagePack — pre-deploy regression gate (6 verdict IDs)', () => {
  it('returns ≥3 of the 6 verified verdict video IDs for "Lil Durk verdict"', async () => {
    const { svc } = makeService();
    const pack = await svc.findTopicFootagePack({
      userId: 'u1',
      topic: 'Lil Durk verdict',
    });
    expect(pack).not.toBeNull();
    const returned = pack!.clips.map((c) => c.videoId);
    const hit = GATE_IDS.filter((id) => returned.includes(id));
    expect(hit.length).toBeGreaterThanOrEqual(3);
  });

  it('filters out non-allowlisted and commentary titles', async () => {
    const { svc } = makeService();
    const pack = await svc.findTopicFootagePack({
      userId: 'u1',
      topic: 'Lil Durk verdict',
    });
    const ids = pack!.clips.map((c) => c.videoId);
    expect(ids).not.toContain('notallowed01');
    expect(ids).not.toContain('commentary01');
  });

  it('runs at most 2 queries and stops once ≥3 survive', async () => {
    const { svc, searchCalls } = makeService();
    await svc.findTopicFootagePack({ userId: 'u1', topic: 'Lil Durk verdict' });
    expect(searchCalls.length).toBe(1); // 6 survive after query 1 → no query 2
  });

  it('runs the second reworded query when <3 survive the first', async () => {
    const { svc, searchCalls } = makeService({
      searchResults: [[], gateRows], // query 1: nothing allowlisted; query 2: hits
    });
    const pack = await svc.findTopicFootagePack({
      userId: 'u1',
      topic: 'obscure case',
    });
    expect(searchCalls.length).toBe(2);
    expect(searchCalls[1]).toContain('courthouse');
    expect(pack!.clips.length).toBeGreaterThanOrEqual(3);
  });
});

describe('findTopicFootagePack — guards', () => {
  it('honors the denylist (own/competitor channels) even when allowlisted', async () => {
    // NBCLA is allowlisted — denying it must remove its clips
    const { svc } = makeService();
    const pack = await svc.findTopicFootagePack({
      userId: 'u1',
      topic: 'Lil Durk verdict',
      denyChannelIds: [NBCLA],
    });
    const ids = pack!.clips.map((c) => c.videoId);
    expect(ids).not.toContain('y4uubcchlO0');
    expect(ids).not.toContain('r8O91QC4BtY');
    expect(ids).toContain('lcdiQY2kYhw'); // ABC7 still allowed
  });

  it('respects the 25/day footage search cap without calling YouTube', async () => {
    const { svc, searchCalls, quota } = makeService({ capUsed: 25 });
    const pack = await svc.findTopicFootagePack({
      userId: 'u1',
      topic: 'Lil Durk verdict',
    });
    expect(searchCalls.length).toBe(0);
    expect(pack).not.toBeNull();
    expect(pack!.clips.length).toBe(0);
    expect(pack!.note).toContain('cap reached');
    expect(quota.logCall).not.toHaveBeenCalled();
  });

  it('blocks at the shared search bucket when checkQuota throws', async () => {
    const { svc, searchCalls, quota } = makeService();
    quota.checkQuota.mockRejectedValueOnce(new Error('quota exceeded'));
    const pack = await svc.findTopicFootagePack({
      userId: 'u1',
      channelId: 'chan1',
      topic: 'Lil Durk verdict',
    });
    expect(searchCalls.length).toBe(0);
    expect(pack!.clips.length).toBe(0);
    expect(pack!.note).toContain('bucket exhausted');
  });

  it('caches per topic — repeat ask costs 0 search calls', async () => {
    const { svc, searchCalls } = makeService();
    await svc.findTopicFootagePack({ userId: 'u1', topic: 'Lil Durk verdict' });
    await svc.findTopicFootagePack({ userId: 'u1', topic: 'Lil Durk verdict' });
    expect(searchCalls.length).toBe(1);
  });

  it('drops non-embeddable and over-duration clips at verify (topic cap 15 min)', async () => {
    const { svc } = makeService({
      details: [
        { videoId: 'lcdiQY2kYhw', embeddable: false, durationSeconds: 60 },
        { videoId: 'y4uubcchlO0', embeddable: true, durationSeconds: 60 },
        { videoId: 'r8O91QC4BtY', embeddable: true, durationSeconds: 4560 }, // 1h16m raw stream >900s
        { videoId: 'QIwVRgJJass', embeddable: true, durationSeconds: 90 },
        { videoId: 'NijnAwhFUtA', embeddable: true, durationSeconds: 747 }, // 12m27s packaged segment — allowed
        { videoId: 'A4iuSrmuCoc', embeddable: true, durationSeconds: 192 },
      ],
    });
    const pack = await svc.findTopicFootagePack({
      userId: 'u1',
      topic: 'Lil Durk verdict',
    });
    const ids = pack!.clips.map((c) => c.videoId);
    expect(ids).not.toContain('lcdiQY2kYhw'); // not embeddable
    expect(ids).not.toContain('r8O91QC4BtY'); // raw 1h+ stream exceeds 15-min cap
    expect(ids).toContain('y4uubcchlO0');
    expect(ids).toContain('QIwVRgJJass');
    expect(ids).toContain('NijnAwhFUtA'); // 12m27s packaged segment allowed
  });

  it('Tier 2 kicks in only when Tier 1 is thin, caps at 3, and labels clips', async () => {
    const { svc } = makeService({
      searchResults: [
        [
          gateRows[0], // ABC7 tier1 (1 only)
          {
            videoId: 't2a',
            title: 'Durk courthouse update',
            channelTitle: 'SAY CHEESE!',
            channelId: 'UC0KfHrqdI1sWILqSBQTALGA',
            thumbnailUrl: '',
          },
          {
            videoId: 't2b',
            title: 'Durk case latest',
            channelTitle: 'The Neighborhood Talk',
            channelId: 'UCQ-LVQJtazs4a2CtZHHjsqg',
            thumbnailUrl: '',
          },
          {
            videoId: 't2c',
            title: 'Durk fans outside court',
            channelTitle: 'SAY CHEESE!',
            channelId: 'UC0KfHrqdI1sWILqSBQTALGA',
            thumbnailUrl: '',
          },
          {
            videoId: 't2d',
            title: 'Durk verdict explained part 4',
            channelTitle: 'The Neighborhood Talk',
            channelId: 'UCQ-LVQJtazs4a2CtZHHjsqg',
            thumbnailUrl: '',
          },
          {
            videoId: 't2e',
            title: 'Durk news reaction live',
            channelTitle: 'SAY CHEESE!',
            channelId: 'UC0KfHrqdI1sWILqSBQTALGA',
            thumbnailUrl: '',
          },
        ],
      ],
    });
    const pack = await svc.findTopicFootagePack({
      userId: 'u1',
      topic: 'Lil Durk verdict',
    });
    const tier2 = pack!.clips.filter(
      (c) => c.tierLabel === 'urban news outlet',
    );
    expect(tier2.length).toBeLessThanOrEqual(3);
    expect(tier2.length).toBeGreaterThan(0); // Tier 1 was thin (1 clip)
    // Commentary-skip still applies inside Tier 2 ('explained' / 'reaction')
    const ids = pack!.clips.map((c) => c.videoId);
    expect(ids).not.toContain('t2d');
    expect(ids).not.toContain('t2e');
    expect(pack!.note).toContain('urban news outlet');
  });

  it('does NOT use Tier 2 when Tier 1 has ≥2 clips', async () => {
    const { svc } = makeService({
      searchResults: [
        [
          gateRows[0], // ABC7
          gateRows[1], // NBCLA
          {
            videoId: 't2x',
            title: 'Durk courthouse update',
            channelTitle: 'SAY CHEESE!',
            channelId: 'UC0KfHrqdI1sWILqSBQTALGA',
            thumbnailUrl: '',
          },
        ],
      ],
    });
    const pack = await svc.findTopicFootagePack({
      userId: 'u1',
      topic: 'Lil Durk verdict',
    });
    expect(pack!.clips.map((c) => c.videoId)).not.toContain('t2x');
    expect(pack!.clips.every((c) => !c.tierLabel)).toBe(true);
  });

  it('returns null only for an empty topic', async () => {
    const { svc } = makeService();
    expect(
      await svc.findTopicFootagePack({ userId: 'u1', topic: '   ' }),
    ).toBeNull();
  });
});
