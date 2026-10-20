import * as fs from 'fs';
import * as path from 'path';
import {
  analyzeSpokenScript,
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
