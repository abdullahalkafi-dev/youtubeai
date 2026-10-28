import {
  bulletShape,
  dropAfterFinalJewel,
  fixSubjectVerbCommas,
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

describe('the client\'s story-flow layout (label inside the first rail line, one thought wrapped over two lines)', () => {
  const section = (n: number) =>
    [
      `## ${n}. YOU WALK IN, AND EVERYBODY ALREADY KNOWS YOUR FACE.`,
      '',
      ...['A', 'B', 'C'].flatMap((l) => [
        `> **${n}${l}.** You recognize nobody in that room,`,
        `> so now you have to learn who's who.`,
        '',
        `> Your name got there before you,`,
        `> your understanding of these men didn't.`,
        '',
      ]),
      '[BEAT]',
      '',
      '### 💎 JEWEL',
      '> A welcome can ease the pressure.',
      '> Trust still needs time.',
      '',
    ].join('\n');
  const raw = `${BULLET_SCRIPT_START}\n# SCRIPT TITLE: TEST\n**5–7 MINUTES WITH FREESTYLE AND PAUSES | UMA OUTLAW STORY-FLOW BULLETS**\n\n${[1, 2, 3].map(section).join('\n')}\n${BULLET_SCRIPT_END}`;

  it('is accepted as a bullet script', () => {
    const block = extractBulletBlock(raw);
    expect(block).not.toBeNull();
    expect(block!.startsWith(BULLET_SCRIPT_START)).toBe(true);
  });

  it('measures words, bullets, sections and how many lines hand the thought on', () => {
    const shape = bulletShape(extractBulletBlock(raw)!);
    expect(shape.bullets).toBe(9);
    expect(shape.sections).toBe(3);
    expect(shape.railLines).toBe(3 * (3 * 4 + 2));
    // half of the 12 bullet lines end in a comma; the jewel lines do not
    expect(shape.continuedShare).toBeCloseTo(18 / 42, 2);
    expect(shape.words).toBeGreaterThan(100);
  });

  it('shows stop-start lines as a low continued share', () => {
    const stopStart = raw.replace(/,\n/g, '.\n');
    expect(bulletShape(stopStart).continuedShare).toBe(0);
  });
});

describe('the card ends with its last jewel', () => {
  const card = [
    '## 6. THE LAST ONE.',
    '',
    '> **6A.** You walk out the door,',
    '> and the story walks out with you.',
    '',
    '[PAUSE]',
    '',
    '### 💎 JEWEL',
    '> Control is not love.',
    '> What will you do differently today?',
  ].join('\n');

  it('cuts the questions and notes the writer copied from the source after the jewel', () => {
    const withTail = card + '\n\n### 10 COMMUNITY QUESTIONS\n\n> 1. Should assault charges change bail?\n> 2. Is forced entry ever romance?\n';
    expect(dropAfterFinalJewel(withTail)).toBe(card);
  });

  it('keeps an earlier jewel and a card that has nothing after it', () => {
    expect(dropAfterFinalJewel(card)).toBe(card);
    const two = '### 💎 JEWEL\n> one\n> two\n\n## 2. NEXT\n> x\n\n' + card;
    expect(dropAfterFinalJewel(two)).toBe(two);
    expect(dropAfterFinalJewel('no jewel here')).toBe('no jewel here');
  });
});

describe('a comma never splits a subject from its verb', () => {
  it('drops the comma when an -ing subject is followed by its verb on the next line', () => {
    const before = "> Calling violence a rough moment,\n> doesn't make the person facing it safer.";
    expect(fixSubjectVerbCommas(before)).toBe("> Calling violence a rough moment\n> doesn't make the person facing it safer.");
    const labeled = "> **3A.** Knowing what lost years feel like,\n> doesn't excuse dismissing somebody.";
    expect(fixSubjectVerbCommas(labeled)).toBe("> **3A.** Knowing what lost years feel like\n> doesn't excuse dismissing somebody.");
  });

  it('keeps the comma everywhere else', () => {
    const fine = '> Knowing what I know now,\n> I would have walked away.';
    expect(fixSubjectVerbCommas(fine)).toBe(fine);
    const handoff = '> You walk in,\n> and everybody knows your face.';
    expect(fixSubjectVerbCommas(handoff)).toBe(handoff);
  });
});
