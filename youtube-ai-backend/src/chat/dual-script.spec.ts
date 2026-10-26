import {
  extractBulletBlock,
  insertBulletBlock,
  isFullScript,
  wantsDualScript,
} from './dual-script';
import { BULLET_SCRIPT_END, BULLET_SCRIPT_START } from '../openai/prompts/unique-persona';
import { analyzeSpokenScript, sanitizeSpokenScript, splitLongRails } from '../openai/prompts/script-length';

const spoken = (n: number) => Array.from({ length: n }, (_, i) => `> Line number ${i} is short here`).join('\n');

const fullScript =
  `# SCRIPT TITLE: BIG30 AND THE CODE\n\n## **1. THE DOOR**\n\n${spoken(30)}\n\n[PAUSE]\n\n## **2. HIS FIRST THOUGHT**\n\n${spoken(30)}\n\n### **JEWEL**\n> Done.\n`;

const wrapped = `<!-- SCRIPT_START -->\n${fullScript}<!-- SCRIPT_END -->\n\n## 🎬 FOOTAGE PACK\n\n> thin\n`;

const bulletBody = [1, 2, 3]
  .map(
    (n) =>
      `## **${n}. POINT ${n}**\n\n` +
      ['A', 'B', 'C']
        .map((l) => `${l}. HARD PROMPT ${n}${l}\n> The emotional point lands here.\n> The psychological point, with a detail.\n`)
        .join('\n') +
      `\n### **JEWEL**\n> A principle, a cost, a question?\n[PAUSE]\n`,
  )
  .join('\n');
const bulletRaw = `${BULLET_SCRIPT_START}\n# SCRIPT TITLE: BIG30 AND THE CODE\n${bulletBody}\n${BULLET_SCRIPT_END}`;

describe('wantsDualScript', () => {
  const ok = { skill: 'script', userContent: 'write a script about Pooh Shiesty and Big30', enabled: true };

  it('fires for a fresh script request', () => {
    expect(wantsDualScript(ok)).toBe(true);
    expect(wantsDualScript({ ...ok, userContent: 'Write the script up 7 to 10 minutes long. In bullet points.' })).toBe(true);
  });

  it('does not fire for other skills, pasted scripts, edits or when switched off', () => {
    expect(wantsDualScript({ ...ok, skill: 'seo' })).toBe(false);
    expect(wantsDualScript({ ...ok, userContent: 'rewrite this 7 to 8 minutes ' + 'x'.repeat(1500) })).toBe(false);
    expect(wantsDualScript({ ...ok, userContent: 'Rewrite the hook, make it harder' })).toBe(false);
    expect(wantsDualScript({ ...ok, userContent: 'make it shorter' })).toBe(false);
    expect(wantsDualScript({ ...ok, userContent: 'Can you shorten section 3' })).toBe(false);
    expect(wantsDualScript({ ...ok, enabled: false })).toBe(false);
    expect(wantsDualScript({ ...ok, userContent: '   ' })).toBe(false);
  });

  it('a request that merely starts with "make a script" is still fresh', () => {
    expect(wantsDualScript({ ...ok, userContent: 'Make a script about the Tesla trunk case' })).toBe(true);
  });
});

describe('isFullScript', () => {
  it('accepts a real script, rejects questions and snippets', () => {
    expect(isFullScript(wrapped)).toBe(true);
    expect(isFullScript('Which video do you mean? Please confirm the title.')).toBe(false);
    expect(isFullScript('<!-- SCRIPT_START -->\n> one line\n<!-- SCRIPT_END -->')).toBe(false);
  });
});

describe('extractBulletBlock', () => {
  it('returns a wrapped, checked block', () => {
    const block = extractBulletBlock(bulletRaw)!;
    expect(block.startsWith(BULLET_SCRIPT_START)).toBe(true);
    expect(block.endsWith(BULLET_SCRIPT_END)).toBe(true);
    expect(block).toContain('A. HARD PROMPT 1A');
  });

  it('repairs missing markers and strips links, sources and code fences', () => {
    const messy = '```markdown\n' + bulletBody + '\nSources: AP\n[x](https://example.com)\nhttps://example.com/a\n```';
    const block = extractBulletBlock(messy)!;
    expect(block).not.toMatch(/Sources:|https?:|```/);
    expect(block.startsWith(BULLET_SCRIPT_START)).toBe(true);
  });

  it('rejects output that is not a bullet script', () => {
    expect(extractBulletBlock('')).toBeNull();
    expect(extractBulletBlock('I cannot help with that.')).toBeNull();
    expect(extractBulletBlock(`${BULLET_SCRIPT_START}\n## **1. ONE**\nA. ONLY\n> x\n${BULLET_SCRIPT_END}`)).toBeNull();
  });
});

describe('insertBulletBlock', () => {
  const block = extractBulletBlock(bulletRaw)!;

  it('places the bullet script right after the full script, before footage and notes', () => {
    const out = insertBulletBlock(wrapped, block);
    const endIdx = out.indexOf('<!-- SCRIPT_END -->');
    const bulletIdx = out.indexOf(BULLET_SCRIPT_START);
    const footageIdx = out.indexOf('FOOTAGE PACK');
    expect(endIdx).toBeGreaterThan(-1);
    expect(bulletIdx).toBeGreaterThan(endIdx);
    expect(footageIdx).toBeGreaterThan(out.indexOf(BULLET_SCRIPT_END));
  });

  it('closes a full script that forgot its end marker first', () => {
    const noEnd = `<!-- SCRIPT_START -->\n${fullScript}\n## 🎬 FOOTAGE PACK\n> thin\n`;
    const out = insertBulletBlock(noEnd, block);
    expect(out.indexOf('<!-- SCRIPT_END -->')).toBeLessThan(out.indexOf(BULLET_SCRIPT_START));
  });
});

describe('the existing script cleaners never touch the bullet script', () => {
  const out = insertBulletBlock(wrapped, extractBulletBlock(bulletRaw)!);

  it('sanitizeSpokenScript leaves lettered bullet headings alone (it would strip "A. HEADING" lines)', () => {
    const { content, removed } = sanitizeSpokenScript(out);
    expect(removed).toEqual([]);
    expect(content).toContain('A. HARD PROMPT 1A');
  });

  it('splitLongRails does not split bullet explanation lines', () => {
    const longLine = '> ' + 'word '.repeat(20).trim();
    const withLong = out.replace('> The emotional point lands here.', longLine);
    expect(splitLongRails(withLong)).toContain(longLine);
  });

  it('script analysis only measures the full script', () => {
    const shape = analyzeSpokenScript(out);
    expect(shape.bannedMarkers).toEqual([]);
    expect(shape.spokenWords).toBeLessThan(600);
  });
});
