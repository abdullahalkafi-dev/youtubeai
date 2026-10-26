import {
  BookMemoryService,
  continuationsFor,
  formatBookBlock,
  parseSituation,
  pickBookChunks,
  recentBookChunkIds,
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
    expect(block).toContain('(the scene continues:) the rest of the scene');
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
