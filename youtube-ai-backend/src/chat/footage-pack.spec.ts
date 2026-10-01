import { ChatService } from './chat.service';
import { SkillRegistry } from './skills/skill-registry';
import {
  LocalNewsService,
  LocalScenePack,
} from '../youtube/local-news.service';

/**
 * Private helpers via prototype (no DI constructor needed).
 * Typed host avoids `any` under the repo's type-aware lint rules.
 */
interface PackHost {
  buildFootagePackBlock(pack: LocalScenePack | null): string;
  insertFootagePackBlock(content: string, block: string): string;
  appendFootagePackBlock(content: string, pack: LocalScenePack | null): string;
  loadFootagePack(
    channel: unknown,
    message: string,
    category: string,
    conversationText: string,
    needsResearch: boolean,
    trendTitles?: string[],
  ): Promise<LocalScenePack | null>;
  detectNeedsResearch(message: string, category?: string): boolean;
  localNewsService: LocalNewsService;
  skillRegistry: SkillRegistry;
  logger: { warn(msg: string): void; log(msg: string): void };
}

const host = Object.create(ChatService.prototype) as unknown as PackHost;

const makePack = (
  clips: LocalScenePack['clips'],
  kind: 'local' | 'topic' = 'topic',
): LocalScenePack => ({
  market: 'Topic (no local market)',
  locationLabel: 'Topic footage pack',
  topic: 'Lil Durk verdict',
  stations: [],
  clips,
  note: 'Verified newsroom clips.',
  kind,
});

const clip = (id: string, opts: { tierLabel?: string } = {}) => ({
  videoId: id,
  title: `Clip ${id}`,
  channelTitle: 'NBCLA',
  videoUrl: `https://www.youtube.com/watch?v=${id}`,
  durationSeconds: 75,
  viewCount: 12345,
  tierLabel: opts.tierLabel,
});

describe('Phase 3 — backend-rendered clip block placement', () => {
  it('builds "" when no pack (message untouched)', () => {
    expect(host.buildFootagePackBlock(null)).toBe('');
  });

  it('renders verified clips with IDs/links from the pack only', () => {
    const block = host.buildFootagePackBlock(
      makePack([clip('lcdiQY2kYhw'), clip('y4uubcchlO0')]),
    );
    expect(block).toContain('## 🎬 VERIFIED FOOTAGE PACK');
    expect(block).toContain('https://www.youtube.com/watch?v=lcdiQY2kYhw');
    expect(block).toContain('1:15'); // 75s
    expect(block).toContain('Verified newsroom clips.');
  });

  it('labels Tier-2 clips', () => {
    const block = host.buildFootagePackBlock(
      makePack([clip('t2a', { tierLabel: 'urban news outlet' })]),
    );
    expect(block).toContain('urban news outlet');
  });

  it('renders the explicit thin note when the pack has 0 clips', () => {
    const block = host.buildFootagePackBlock(makePack([]));
    expect(block).toContain('Footage thin this turn');
  });

  it('inserts BEFORE the model Sources heading so extractSources cannot swallow clip links', () => {
    const content =
      '## **1. COLD OPEN**\n> spoken lines...\n\n## 17. 📺 VERIFIED YOUTUBE VIDEO SOURCES & B-ROLL CLIPS\n1. [Some channel](https://www.youtube.com/watch?v=aaa)\n\n## Sources (5)\napnews.com\n';
    const block = host.buildFootagePackBlock(makePack([clip('lcdiQY2kYhw')]));
    const out = host.insertFootagePackBlock(content, block);

    const packIdx = out.indexOf('## 🎬 VERIFIED FOOTAGE PACK');
    const s17Idx = out.indexOf('## 17.');
    const sourcesIdx = out.indexOf('## Sources');
    expect(packIdx).toBeGreaterThan(-1);
    expect(packIdx).toBeLessThan(s17Idx);
    expect(packIdx).toBeLessThan(sourcesIdx);
    // Pack heading must NOT sit inside the captured Sources section
    expect(out.slice(sourcesIdx)).not.toContain('VERIFIED FOOTAGE PACK');
  });

  it('appends at end when the model wrote no Sources heading', () => {
    const out = host.appendFootagePackBlock(
      'Short answer text.',
      makePack([clip('QIwVRgJJass')]),
    );
    expect(out.startsWith('Short answer text.')).toBe(true);
    expect(out).toContain('## 🎬 VERIFIED FOOTAGE PACK');
  });

  it('leaves content untouched when pack is null', () => {
    const content = '## Sources (1)\napnews.com\n';
    expect(host.appendFootagePackBlock(content, null)).toBe(content);
  });
});

describe('Phase 2c — loadFootagePack triggers', () => {
  const channel = {
    _id: { toString: () => 'chan1' },
    userId: { toString: () => 'user1' },
    youtubeChannelId: 'UC-own',
  };
  type TopicParams = Parameters<LocalNewsService['findTopicFootagePack']>[0];
  let topicSpy: jest.SpyInstance<Promise<LocalScenePack | null>, [TopicParams]>;
  let localSpy: jest.SpyInstance;
  let denySpy: jest.SpyInstance;

  beforeEach(() => {
    topicSpy = jest
      .spyOn(LocalNewsService.prototype, 'findTopicFootagePack')
      .mockResolvedValue(makePack([clip('lcdiQY2kYhw')]));
    localSpy = jest
      .spyOn(LocalNewsService.prototype, 'findFootagePack')
      .mockResolvedValue(null);
    denySpy = jest
      .spyOn(SkillRegistry.prototype, 'getCompetitorYoutubeIds')
      .mockResolvedValue(['UC-rival']);
    host.localNewsService = new LocalNewsService({} as any, {} as any);
    host.skillRegistry = new SkillRegistry(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    host.logger = { warn: jest.fn(), log: jest.fn() };
  });

  afterEach(() => jest.restoreAllMocks());

  const load = (
    message: string,
    category = 'general',
    needsResearch = true,
    conversationText = '',
    trendTitles: string[] = [],
  ) =>
    host.loadFootagePack(
      channel,
      message,
      category,
      conversationText,
      needsResearch,
      trendTitles,
    );

  it('EXPLICIT footage ask loads a marketless topic pack and passes the denylist', async () => {
    const pack = await load(
      'find some news clips for the Lil Durk verdict',
      'general',
    );
    expect(pack).not.toBeNull();
    expect(topicSpy).toHaveBeenCalledTimes(1);
    expect(topicSpy.mock.calls[0][0]).toMatchObject({
      userId: 'user1',
      channelId: 'chan1',
      denyChannelIds: ['UC-own', 'UC-rival'], // own channel + competitors
    });
    expect(localSpy).not.toHaveBeenCalled();
  });

  it('Rule-0 recommendation ask (no entity) uses the top trend as topic', async () => {
    const pack = await load(
      'What should I post next? Give me 1 strong topic suggestion with a title and a thumbnail package. Ground it in my recent performance and competitor data.',
      'general',
      true,
      '',
      ['Lil Durk racketeering trial postponed to August 2027'],
    );
    expect(pack).not.toBeNull();
    expect(topicSpy.mock.calls[0][0].topic).toContain('Lil Durk');
  });

  it('entity-bearing content ask auto-loads a pack', async () => {
    await load('Make a video about Tory Lanez stabbing');
    expect(topicSpy).toHaveBeenCalledTimes(1);
    expect(topicSpy.mock.calls[0][0].topic).toContain('Tory Lanez');
  });

  it('trivial chat loads nothing (0 quota spend)', async () => {
    const pack = await load('hello, how are you?', 'general', true);
    expect(pack).toBeNull();
    expect(topicSpy).not.toHaveBeenCalled();
    expect(localSpy).not.toHaveBeenCalled();
    expect(denySpy).not.toHaveBeenCalled();
  });

  it('analysis category loads nothing', async () => {
    const pack = await load('analyze my channel', 'analysis', false);
    expect(pack).toBeNull();
    expect(topicSpy).not.toHaveBeenCalled();
  });

  it('footage ask with a resolvable market prefers the local pack', async () => {
    localSpy.mockResolvedValue(makePack([clip('local1')], 'local'));
    const pack = await load(
      'news clips about the Los Angeles courthouse verdict',
    );
    expect(localSpy).toHaveBeenCalledTimes(1);
    expect(pack?.kind).toBe('local');
  });

  it('script follow-up "give me script for this" resolves the subject from thread context (topic pack, not local)', async () => {
    localSpy.mockResolvedValue(makePack([clip('local1')], 'local')); // must NOT win
    const pack = await load(
      'give me script for this',
      'script',
      true,
      '## Best Next Post: **Rihanna Home Shooting — The Competency Question Is Over**\n\nOur Los Angeles market story keeps developing.',
      ['Some unrelated trend'],
    );
    expect(topicSpy).toHaveBeenCalledTimes(1);
    expect(topicSpy.mock.calls[0][0].topic).toContain('Rihanna Home Shooting');
    expect(localSpy).not.toHaveBeenCalled();
    expect(pack?.kind).toBe('topic');
    expect(host.logger.log).toHaveBeenCalledWith(
      expect.stringContaining('[FootagePack]'),
    );
  });

  it('anaphoric footage ask "give me clips for the script" uses the thread subject', async () => {
    localSpy.mockResolvedValue(makePack([clip('local1')], 'local'));
    const pack = await load(
      'give me clips for the script',
      'general',
      true,
      '## Best Next Post: **Rihanna Home Shooting — Competency Ruling**\nLos Angeles coverage.',
    );
    expect(topicSpy.mock.calls[0][0].topic).toContain('Rihanna Home Shooting');
    expect(localSpy).not.toHaveBeenCalled();
    expect(pack?.kind).toBe('topic');
  });

  it('story subject with empty coverage renders thin — never generic local clips', async () => {
    localSpy.mockResolvedValue(makePack([clip('local1')], 'local'));
    topicSpy.mockResolvedValue(makePack([], 'topic'));
    const pack = await load(
      'give me script for this',
      'script',
      true,
      '## Best Next Post: **Ghost Story Nobody Covered**\nLos Angeles.',
    );
    expect(localSpy).not.toHaveBeenCalled();
    expect(pack).not.toBeNull();
    expect(pack?.clips.length).toBe(0);
  });

  it('fresh Rule-0 recommendation ask uses trends, not the previous proposal', async () => {
    const pack = await load(
      'What should I post next? Give me 1 strong topic suggestion with a title and a thumbnail package.',
      'general',
      true,
      '## Best Next Post: **Old Rihanna Proposal**',
      ['Fresh Trend Topic'],
    );
    expect(topicSpy.mock.calls[0][0].topic).toContain('Fresh Trend Topic');
    expect(pack).not.toBeNull();
  });

  it('weak thread subject walks to the matching trend title, never other stories', async () => {
    topicSpy.mockImplementation(async (p) =>
      String(p.topic).includes('Rihanna home shooting')
        ? makePack(
            Array.from({ length: 6 }, (_, i) => clip(`trend${i}`)),
            'topic',
          )
        : makePack([clip('ctx1')], 'topic'),
    );
    const pack = await load(
      'give me script for this',
      'script',
      true,
      '## Best Next Post: **Rihanna Home Case — The Competency Trap**\nLos Angeles.',
      [
        'Rihanna home shooting defendant ruled fit for trial',
        'Chicago man gets 25 years for trafficking and abusing minor',
      ],
    );
    const topics = topicSpy.mock.calls.map((c) => String(c[0].topic));
    expect(topics[0]).toContain('Rihanna Home Case');
    expect(topics).toContain(
      'Rihanna home shooting defendant ruled fit for trial',
    );
    expect(topics.join(' | ')).not.toContain('Chicago man gets');
    expect(pack?.clips.length).toBe(6);
  });
});

describe('extractContextTopic — thread proposal heading parsing', () => {
  const h = Object.create(ChatService.prototype) as {
    extractContextTopic(t: string): string | null;
  };

  it('parses the latest heading and trims the caption tail at the dash', () => {
    expect(
      h.extractContextTopic(
        'noise\n## Best Next Post: **Rihanna Home Shooting — The Competency Question Is Over**',
      ),
    ).toBe('Rihanna Home Shooting');
  });

  it('takes the LAST heading when the thread has several', () => {
    expect(
      h.extractContextTopic(
        '## Best Next Post: **First Old Topic**\nbody\n### Best Next Post: **Second New Topic**',
      ),
    ).toBe('Second New Topic');
  });

  it('returns null without a proposal heading', () => {
    expect(h.extractContextTopic('no heading here')).toBeNull();
    expect(h.extractContextTopic('')).toBeNull();
  });
});

describe('prompt contracts (Phase 1c + 2d)', () => {
  const registry = new SkillRegistry(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  it('general skill prompt demands ALL deliverables incl. thumbnail cards', () => {
    const prompt = registry.get('general').buildSystemPrompt({}, {});
    expect(prompt).toContain('MULTI-DELIVERABLE REQUESTS');
    expect(prompt).toContain('THUMBNAILS_START');
    expect(prompt).toContain('Never silently drop a requested part');
  });

  it('§17 tells the model NOT to re-list pack URLs (backend appends them)', () => {
    const prompt = registry.get('script').buildSystemPrompt({}, {});
    expect(prompt).toContain('VERIFIED TOPIC FOOTAGE PACK');
    expect(prompt).toContain('do NOT re-list clip URLs');
    expect(prompt).toContain('backend appends the verified list automatically');
  });
});

describe('detectNeedsResearch — Rule-0 recommendation asks fire research', () => {
  const host2 = Object.create(ChatService.prototype) as unknown as Pick<
    PackHost,
    'detectNeedsResearch' | 'localNewsService'
  >;
  host2.localNewsService = new LocalNewsService({} as any, {} as any);

  it('fires for the client recommendation message', () => {
    expect(
      host2.detectNeedsResearch(
        'What should I post next? Give me 1 strong topic suggestion with a title and a thumbnail package.',
        'general',
      ),
    ).toBe(true);
  });

  it('fires for explicit footage asks', () => {
    expect(
      host2.detectNeedsResearch(
        'find some news clips for this case',
        'general',
      ),
    ).toBe(true);
  });

  it('stays silent for trivia', () => {
    expect(host2.detectNeedsResearch('hello there', 'general')).toBe(false);
  });

  it('never fires for analysis category', () => {
    expect(
      host2.detectNeedsResearch('what should I post next', 'analysis'),
    ).toBe(false);
  });
});
