import {
  BookMemoryService,
  continuationsFor,
  formatBookBlock,
  formatMemoryCard,
  parseMemoryCard,
  parseSituation,
  pickBookChunks,
  recentBookChunkIds,
  topicAwareRequest,
} from './book-memory.service';
import { ChromaQueryResult } from '../chroma/chroma.service';

const chunk = (
  id: string,
  distance: number,
  chapter: number,
  extra: Record<string, any> = {},
): ChromaQueryResult => ({
  id,
  text: `text of ${id}`,
  distance,
  metadata: { chapter, chapterTitle: `TITLE ${chapter}`, characters: 'Ron, Mike/Unique', themes: '', ...extra },
});

describe('parseSituation', () => {
  it('reads the model JSON, trimming and validating it', () => {
    const s = parseSituation(
      '```json\n{"queries":["A man trusts his brother with everything before prison.","short","Brother empties the house while he is locked up."],"themes":["betrayal","nonsense","family"],"dynamics":"brother turned on brother"}\n```',
    )!;
    expect(s.queries).toHaveLength(2); // "short" is dropped
    expect(s.themes).toEqual(['betrayal', 'family']); // unknown theme dropped
    expect(s.dynamics).toBe('brother turned on brother');
  });

  it('returns null for unusable output', () => {
    expect(parseSituation('')).toBeNull();
    expect(parseSituation('sorry, I cannot')).toBeNull();
    expect(parseSituation('{"queries":[]}')).toBeNull();
  });
});

describe('pickBookChunks', () => {
  it('prefers close, repeated, theme-matching chunks and caps two per chapter', () => {
    const picked = pickBookChunks(
      [
        [chunk('a', 0.5, 15), chunk('b', 0.52, 15), chunk('c', 0.53, 15), chunk('d', 0.6, 22, { themes: 'betrayal, family' })],
        [chunk('d', 0.55, 22, { themes: 'betrayal, family' }), chunk('e', 0.7, 3)],
      ],
      ['betrayal'],
      [],
      4,
    );
    const ids = picked.map((c) => c.id);
    expect(ids[0]).toBe('d'); // hit twice and shares the theme
    expect(ids.filter((id) => ['a', 'b', 'c'].includes(id))).toHaveLength(2); // max 2 from chapter 15
    expect(ids).toHaveLength(4);
  });

  it('softly avoids chunks used by recent scripts', () => {
    const results = [[chunk('x', 0.5, 1), chunk('y', 0.55, 2), chunk('z', 0.6, 3)]];
    expect(pickBookChunks(results, [], [], 1)[0].id).toBe('x');
    expect(pickBookChunks(results, [], ['x'], 1)[0].id).toBe('y');
  });

  it('handles empty results', () => {
    expect(pickBookChunks([[], []], [], [], 5)).toEqual([]);
  });

  it('prefers the passage where his own mind is on the page when distances are close', () => {
    const quiet = { ...chunk('quiet', 0.5, 1), text: 'He planned a quiet evening at his grandmother house.' };
    const mind = { ...chunk('mind', 0.52, 2), text: '"I know I am off on some foul shit," he thought to himself.' };
    const picked = pickBookChunks([[quiet, mind]], [], [], 1);
    expect(picked[0].id).toBe('mind');
  });
});

describe('continuationsFor', () => {
  const book = (id: string, chapter: number, text: string) => ({ id, text, metadata: { chapter } as any });
  const all = [
    book('c1-1', 1, 'one'),
    book('c1-2', 1, 'two'),
    book('c1-3', 1, 'three'),
    book('c2-1', 2, 'other chapter'),
  ];

  it('brings the next passages of the same chapter so the scene arrives whole', () => {
    const out = continuationsFor([chunk('c1-1', 0.5, 1)], all);
    expect(out['c1-1']).toBe('two\nthree');
  });

  it('never crosses into the next chapter and ignores unknown ids', () => {
    const out = continuationsFor([chunk('c1-3', 0.5, 1), chunk('nope', 0.5, 1)], all);
    expect(out).toEqual({});
  });

  it('only continues the top picks', () => {
    const out = continuationsFor([chunk('c1-1', 0.5, 1), chunk('c1-2', 0.5, 1), chunk('c1-3', 0.5, 1)], all, 1, 1);
    expect(Object.keys(out)).toEqual(['c1-1']);
  });
});

describe('formatBookBlock', () => {
  it('names the source, explains Mike = Unique, and lists numbered chunks', () => {
    const block = formatBookBlock([chunk('a', 0.5, 15), chunk('p', 0.5, 0, { chapterTitle: 'PROLOGUE' })], 'brother turned on brother');
    expect(block).toMatch(/A Roar in Harlem/);
    expect(block).toMatch(/Mike McCormick IS Unique/);
    expect(block).toMatch(/never invent anything beyond what is written here/);
    expect(block).toContain('[1] Ch. 15 · TITLE 15 (Ron, Mike/Unique)');
    expect(block).toContain('[2] Prologue');
    expect(block).toContain('Human dynamic of this story');
  });

  it('is empty when there is nothing to use', () => {
    expect(formatBookBlock([])).toBe('');
  });

  it('asks for the moment where his mind shows, keeps the people true, and shows the continued scene', () => {
    const block = formatBookBlock([chunk('a', 0.5, 15)], undefined, { a: 'the rest of the scene' });
    expect(block).toMatch(/his own MIND is on the page/);
    expect(block).toMatch(/a drug spot is a drug spot/);
    expect(block).toMatch(/never stop the memory at the point where an officer or a bystander breaks it up/);
    expect(block).toContain('(the scene continues:) the rest of the scene');
  });
});

describe('memory card', () => {
  const good =
    '{"pick":2,"title":"Four men, a mop wringer","beats":["He walked onto block B and four inmates asked for his shoes.","He thought he would make each one know it.","He took a mop wringer to his cell and waited.","He broke the leader\'s jaw and another man\'s nose.","Officers stunned him and he woke in the hole."],"inner_line":"If they want some shit, I\'ll give them some shit.","mirror":"A new arrival gets tested the first day."}';

  it('reads the model JSON, keeping every beat in order', () => {
    const card = parseMemoryCard('```json\n' + good + '\n```', 4)!;
    expect(card.title).toBe('Four men, a mop wringer');
    expect(card.beats).toHaveLength(5);
    expect(card.beats[3]).toMatch(/jaw/);
    expect(card.innerLine).toMatch(/give them some shit/);
  });

  it('rejects unusable output: bad pick, too few beats, not JSON', () => {
    expect(parseMemoryCard(good, 1)).toBeNull(); // pick 2 is outside 1 passage
    expect(parseMemoryCard('{"pick":1,"beats":["one beat only here"]}', 4)).toBeNull();
    expect(parseMemoryCard('nope', 4)).toBeNull();
    expect(parseMemoryCard('', 4)).toBeNull();
  });

  it('formats a block that forces every beat, the act and its cost', () => {
    const block = formatMemoryCard(parseMemoryCard(good, 4)!);
    expect(block).toMatch(/MEMORY TO BUILD POINT 2 ON/);
    expect(block).toContain('1. He walked onto block B');
    expect(block).toContain('5. Officers stunned him');
    expect(block).toMatch(/What he told himself: "If they want some shit/);
    expect(block).toMatch(/EVERY beat above, in order, including what he did and what it cost him/);
    expect(block).toMatch(/Do not stop early, skip the act/);
    expect(block).toMatch(/THE ACT AND THE COST are beats 3-5/);
    expect(block).toMatch(/ends before beat 5 \("Officers stunned him and he woke in the hole\."\) fails the brief/);
  });

  it('recall puts the card ahead of the passages, and survives a failing card step', async () => {
    const chroma = { query: jest.fn().mockResolvedValue([chunk('a', 0.5, 18), chunk('b', 0.6, 25)]) };
    const situation = '{"queries":["A new arrival is tested over his shoes on the block."],"themes":["violence"],"dynamics":"x"}';
    const openai = { chatFast: jest.fn().mockResolvedValueOnce(situation).mockResolvedValueOnce(good) };
    const r = await new BookMemoryService(chroma as any, openai as any).recall('script about a prison transfer');
    expect(r.block.indexOf('MEMORY TO BUILD POINT 2 ON')).toBeLessThan(r.block.indexOf('FROM UNIQUE'));
    expect(openai.chatFast).toHaveBeenCalledTimes(2);

    const failing = { chatFast: jest.fn().mockResolvedValueOnce(situation).mockRejectedValueOnce(new Error('boom')) };
    const r2 = await new BookMemoryService(chroma as any, failing as any).recall('script about a prison transfer');
    expect(r2.block).toContain('FROM UNIQUE');
    expect(r2.block).not.toContain('MEMORY TO BUILD POINT 2 ON');
  });
});

describe('topicAwareRequest', () => {
  const topic = 'Today: Diddy at Allenwood. '.padEnd(400, 'x');
  const history = [
    { role: 'user', content: 'which topic video should i make today' },
    { role: 'assistant', content: topic },
    { role: 'user', content: 'now give me script for this video' },
  ];

  it('borrows the subject from the last assistant message for a short follow-up', () => {
    const out = topicAwareRequest('now give me script for this video', history);
    expect(out).toContain('now give me script for this video');
    expect(out).toContain('Diddy at Allenwood');
    expect(out.length).toBeLessThan(1900);
  });

  it('leaves a request that already says what it is about untouched', () => {
    const long = 'Write a script about a woman stabbed in the face by her boyfriend. '.repeat(6);
    expect(topicAwareRequest(long, history)).toBe(long.trim());
  });

  it('falls back to the plain request when there is nothing to borrow', () => {
    expect(topicAwareRequest('script please', [])).toBe('script please');
    expect(topicAwareRequest('script please', [{ role: 'assistant', content: 'ok' }])).toBe('script please');
  });
});

describe('recentBookChunkIds', () => {
  it('collects ids from the last assistant messages that used the book', () => {
    const msgs = [
      { role: 'assistant', metadata: { bookChunkIds: ['old'] } },
      { role: 'user' },
      { role: 'assistant', metadata: { bookChunkIds: ['b1', 'b2'] } },
      { role: 'assistant', metadata: {} },
      { role: 'assistant', metadata: { bookChunkIds: ['c1'] } },
    ];
    expect(recentBookChunkIds(msgs, 2)).toEqual(['c1', 'b1', 'b2']);
  });
});

describe('BookMemoryService.recall', () => {
  const makeChroma = (results: ChromaQueryResult[]) => ({ query: jest.fn().mockResolvedValue(results) });

  it('searches the situation queries and returns a block plus ids', async () => {
    const chroma = makeChroma([chunk('a', 0.5, 15), chunk('b', 0.6, 22)]);
    const openai = {
      chatFast: jest.fn().mockResolvedValue(
        '{"queries":["A brother empties the house while he is away.","A man finds the man who crossed him."],"themes":["betrayal"],"dynamics":"x"}',
      ),
    };
    const svc = new BookMemoryService(chroma as any, openai as any);
    const r = await svc.recall('write a script about a brother who robbed his brother');
    expect(r.fellBack).toBe(false);
    expect(r.ids.length).toBeGreaterThan(0);
    expect(r.block).toContain('FROM UNIQUE');
    expect(chroma.query).toHaveBeenCalledTimes(2);
    expect(chroma.query.mock.calls[0][0]).toBe('client_book_full');
  });

  it('falls back to the raw request when the situation step fails', async () => {
    const chroma = makeChroma([chunk('a', 0.5, 15)]);
    const openai = { chatFast: jest.fn().mockRejectedValue(new Error('boom')) };
    const svc = new BookMemoryService(chroma as any, openai as any);
    const r = await svc.recall('write a script about a stabbing');
    expect(r.fellBack).toBe(true);
    expect(r.ids).toEqual(['a']);
  });

  it('never throws and returns an empty recall when search fails', async () => {
    const chroma = { query: jest.fn().mockRejectedValue(new Error('chroma down')) };
    const openai = { chatFast: jest.fn().mockResolvedValue('{"queries":["some scene of a street life here"]}') };
    const svc = new BookMemoryService(chroma as any, openai as any);
    await expect(svc.recall('anything')).resolves.toEqual({ block: '', ids: [], fellBack: false });
    await expect(svc.recall('   ')).resolves.toEqual({ block: '', ids: [], fellBack: false });
  });

  it('can be switched off', () => {
    process.env.UMA_BOOK_RECALL = 'false';
    expect(BookMemoryService.enabled()).toBe(false);
    delete process.env.UMA_BOOK_RECALL;
    expect(BookMemoryService.enabled()).toBe(true);
  });
});
