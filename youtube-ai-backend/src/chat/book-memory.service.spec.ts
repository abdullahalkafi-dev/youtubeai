import {
  BookMemoryService,
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
