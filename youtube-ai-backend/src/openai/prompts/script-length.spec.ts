import * as fs from 'fs';
import * as path from 'path';
import {
  analyzeSpokenScript,
  closeScriptMarkers,
  splitLongRails,
  checkScriptShape,
  sanitizeSpokenScript,
  scriptWordBudget,
  SCRIPT_LENGTH_CONTRACT,
} from './script-length';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, '__fixtures__', name), 'utf8');

describe('scriptWordBudget', () => {
  it('defaults to 7-9 minutes at 130 wpm', () => {
    expect(scriptWordBudget(7, 9)).toEqual({ min: 819, target: 1040, max: 1170 });
  });

  it('scales with an explicit duration', () => {
    expect(scriptWordBudget(15).max).toBe(1950);
    expect(scriptWordBudget(15).target).toBe(1950);
  });

  it('tells the model the default and that an explicit duration wins', () => {
    expect(SCRIPT_LENGTH_CONTRACT).toMatch(/7-9 minutes/);
    expect(SCRIPT_LENGTH_CONTRACT).toMatch(/15 minutes/);
    expect(SCRIPT_LENGTH_CONTRACT).toMatch(/that wins/);
  });
});

describe('script shape against the client scripts', () => {
  it('accepts the 5-section script the client likes', () => {
    const { shape, issues } = checkScriptShape(fixture('liked-comfort-building.txt'));
    expect(issues).toEqual([]);
    expect(shape.sections).toBe(5);
  });

  it('accepts the 8-section script the client likes (and flags its leaked reference line)', () => {
    const { shape, issues } = checkScriptShape(fixture('liked-pack-your-property.txt'));
    expect(shape.sections).toBe(8);
    expect(issues).toEqual([expect.stringMatching(/verification references/)]);
    expect(issues.join(' ')).not.toMatch(/too long/);
  });

  it('rejects the 11-14 minute script: too long, sub-labels, markers', () => {
    const { shape, issues } = checkScriptShape(fixture('too-long-combs-injury.txt'));
    expect(shape.spokenWords).toBeGreaterThan(scriptWordBudget(7, 9).max * 1.1);
    expect(shape.bannedMarkers).toEqual(
      expect.arrayContaining(['ON-SCREEN LEGAL STATUS', 'CURIOSITY RESET', 'sub-label']),
    );
    expect(issues.join(' ')).toMatch(/too long/);
  });

  it('allows a 15 minute request to run long', () => {
    const { issues } = checkScriptShape(fixture('too-long-combs-injury.txt'), { min: 15, max: 15 });
    expect(issues.join(' ')).not.toMatch(/too long/);
  });
});

describe('sanitizeSpokenScript', () => {
  const wrap = (body: string) => `intro\n<!-- SCRIPT_START -->\n${body}\n<!-- SCRIPT_END -->\nSources: keep me`;

  it('removes the legal header block, sub-labels, curiosity markers and leaked references', () => {
    const dirty = wrap(
      [
        '# SCRIPT TITLE: Test',
        '### ON-SCREEN LEGAL STATUS',
        '> PERSON — SENTENCED',
        '> Fifty months.',
        '',
        '## **1. COLD OPEN**',
        '**A. THE HOOK**',
        '> Three seats sit empty.',
        '> Empty.',
        '[BEAT]',
        'CURIOSITY RESET — APPROXIMATELY 1:30',
        '> Who decides?',
        '*Verification references — not spoken.* ([x.com](https://x.com))',
      ].join('\n'),
    );
    const { content, removed } = sanitizeSpokenScript(dirty);
    expect(removed.length).toBe(4);
    expect(content).toContain('> Three seats sit empty.');
    expect(content).toContain('[BEAT]');
    expect(content).toContain('## **1. COLD OPEN**');
    expect(content).not.toMatch(/ON-SCREEN|CURIOSITY RESET|THE HOOK|Verification|PERSON — SENTENCED/);
    expect(content).toContain('Sources: keep me');
    expect(content.startsWith('intro')).toBe(true);
  });

  it('returns clean scripts unchanged', () => {
    const clean = wrap('## **1. COLD OPEN**\n> One line.\n[PAUSE]');
    expect(sanitizeSpokenScript(clean)).toEqual({ content: clean, removed: [] });
  });
});

describe('closeScriptMarkers', () => {
  it('closes a script that has no end marker before the footage block', () => {
    const text = [
      'intro',
      '<!-- SCRIPT_START -->',
      '# SCRIPT TITLE: Prison Notes',
      '## **1. COLD OPEN**',
      '> Picture that door closing.',
      '[BEAT]',
      '> Tonight we talk.',
      '',
      '## 🎬 VERIFIED FOOTAGE PACK',
      '',
      '> Footage thin this turn — no verified clips found. Use courthouse or agency B-roll or licensed pool feed, or ask me.',
    ].join('\n');
    const closed = closeScriptMarkers(text);
    expect(closed.indexOf('<!-- SCRIPT_END -->')).toBeGreaterThan(closed.indexOf('Tonight we talk'));
    expect(closed.indexOf('<!-- SCRIPT_END -->')).toBeLessThan(closed.indexOf('VERIFIED FOOTAGE PACK'));
    expect(analyzeSpokenScript(closed).longestLineWords).toBeLessThanOrEqual(8);
  });

  it('keeps a title or numbered section that merely contains a keyword inside the script', () => {
    const text = '<!-- SCRIPT_START -->\n# SCRIPT TITLE: Sources Of Pressure\n## **2. Footage Of A Life**\n> Line one.\n';
    const closed = closeScriptMarkers(text);
    expect(closed.indexOf('<!-- SCRIPT_END -->')).toBeGreaterThan(closed.indexOf('Line one'));
  });

  it('leaves a script that already has an end marker, and text with no script, untouched', () => {
    const closedAlready = '<!-- SCRIPT_START -->\n> a b\n<!-- SCRIPT_END -->\nafter';
    expect(closeScriptMarkers(closedAlready)).toBe(closedAlready);
    expect(closeScriptMarkers('no script here')).toBe('no script here');
  });

  it('appends the marker at the end when nothing follows the script', () => {
    const closed = closeScriptMarkers('<!-- SCRIPT_START -->\n> Only line.');
    expect(closed.trimEnd().endsWith('<!-- SCRIPT_END -->')).toBe(true);
  });
});

describe('splitLongRails', () => {
  const wrap = (body: string) => `<!-- SCRIPT_START -->\n${body}\n<!-- SCRIPT_END -->\nafter text that is not a rail and is rather long indeed`;

  it('splits a long rail into breathable lines and never changes the words', () => {
    const long = "> I spent twenty-six years inside and I can tell you that fame will not open that door for you, my friend";
    const out = splitLongRails(wrap(long));
    const rails = out.split('\n').filter((l) => l.startsWith('> '));
    expect(rails.length).toBeGreaterThan(1);
    for (const rail of rails) expect(rail.replace(/^> /, '').split(/\s+/).length).toBeLessThanOrEqual(8);
    const words = (t: string) => t.replace(/>/g, ' ').split(/\s+/).filter(Boolean).join(' ');
    expect(words(rails.join(' '))).toBe(words(long));
  });

  it('is idempotent and leaves short rails, cues, headings, links and text after the script alone', () => {
    const body = [
      '## **1. COLD OPEN**',
      '> Short line here.',
      '[BEAT]',
      '> [A very long link title that should stay exactly as it is](https://example.com/watch?v=abc) with extra words',
    ].join('\n');
    const once = splitLongRails(wrap(body));
    expect(once).toBe(wrap(body));
    const long = wrap('> one two three four five six seven eight nine ten eleven twelve');
    const first = splitLongRails(long);
    expect(splitLongRails(first)).toBe(first);
  });

  it('does not split text outside the script', () => {
    const out = splitLongRails('> one two three four five six seven eight nine ten eleven twelve');
    expect(out.split('\n').length).toBeGreaterThan(1);
    const outside = '<!-- SCRIPT_START -->\n> ok\n<!-- SCRIPT_END -->\n> one two three four five six seven eight nine ten eleven twelve';
    expect(splitLongRails(outside)).toBe(outside);
  });
});
