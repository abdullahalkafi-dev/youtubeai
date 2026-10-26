import { readFileSync } from 'fs';
import { join } from 'path';
import { CHUNK_MAX, chunkBook, parseChapters, tagCharacters, tagThemes } from './book-chunker';

const text = readFileSync(join(__dirname, '..', 'assets', 'seed', 'a_roar_in_harlem.txt'), 'utf8');

describe('book chunker (A Roar in Harlem)', () => {
  const chapters = parseChapters(text);
  const chunks = chunkBook(text);

  it('finds the prologue and all 53 chapters, in two parts', () => {
    expect(chapters.length).toBe(54);
    expect(chapters[0].number).toBe(0);
    expect(chapters[chapters.length - 1].number).toBe(53);
    expect(chapters.find((c) => c.number === 29)?.part).toBe(1);
    expect(chapters.find((c) => c.number === 30)?.part).toBe(2);
  });

  it('reads chapter titles', () => {
    expect(chapters.find((c) => c.number === 1)?.title).toBe('THE COME-UP');
    expect(chapters.find((c) => c.number === 53)?.title).toMatch(/FINALE/);
  });

  it('never exceeds the chunk limit and has unique ids', () => {
    expect(chunks.length).toBeGreaterThan(250);
    expect(chunks.length).toBeLessThan(500);
    expect(Math.max(...chunks.map((c) => c.text.length))).toBeLessThanOrEqual(CHUNK_MAX);
    expect(new Set(chunks.map((c) => c.id)).size).toBe(chunks.length);
  });

  it('keeps essentially all of the book (no silent loss)', () => {
    const kept = chunks.reduce((n, c) => n + c.text.length, 0);
    expect(kept / text.length).toBeGreaterThan(0.93);
  });

  it('is deterministic', () => {
    expect(chunkBook(text).map((c) => c.id)).toEqual(chunks.map((c) => c.id));
  });

  it('tags people and themes', () => {
    expect(chunks.some((c) => c.metadata.characters.includes('Jade'))).toBe(true);
    expect(chunks.some((c) => c.metadata.themes.includes('prison'))).toBe(true);
    expect(tagCharacters('Bob and Bob looked at Mike. Kenny waited.')).toEqual(['Bob', 'Mike/Unique', 'Kenny']);
    expect(tagThemes('He pulled the gun. The gun went off. Blood and blood.')).toContain('violence');
  });

  it('chunk metadata is Chroma-safe (strings, numbers, booleans only)', () => {
    for (const c of chunks.slice(0, 40)) {
      for (const v of Object.values(c.metadata)) expect(['string', 'number', 'boolean']).toContain(typeof v);
    }
  });
});
