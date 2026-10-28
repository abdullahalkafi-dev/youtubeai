import {
  BULLET_SCRIPT_SYSTEM_PROMPT,
  buildBulletScriptRequest,
  extractFactNote,
  scriptForBullets,
} from './bullet-script';
import { BULLET_SCRIPT_END, BULLET_SCRIPT_START } from './unique-persona';

describe('bullet script prompt (the client\'s breathable story-flow directives)', () => {
  const prompt = BULLET_SCRIPT_SYSTEM_PROMPT;

  it('uses its own markers, the client format name and the freestyle runtime line', () => {
    expect(BULLET_SCRIPT_START).not.toBe('<!-- SCRIPT_START -->');
    expect(prompt).toContain(BULLET_SCRIPT_START);
    expect(prompt).toContain(BULLET_SCRIPT_END);
    expect(prompt).toContain('UMA OUTLAW STORY-FLOW BULLETS');
    expect(prompt).toContain('**5–7 MINUTES WITH FREESTYLE AND PAUSES | UMA OUTLAW STORY-FLOW BULLETS**');
  });

  it('asks for spoken-sentence headings, three bullets a section, two blocks a bullet', () => {
    expect(prompt).toMatch(/Every heading is a short spoken sentence in caps/);
    expect(prompt).toMatch(/Never a topic label or a slogan/);
    expect(prompt).toMatch(/exactly THREE bullets, labeled 1A, 1B, 1C/);
    expect(prompt).toMatch(/Each bullet is TWO breath blocks/);
    expect(prompt).toMatch(/450 to 650 written words/);
    expect(prompt).toMatch(/If the CLIENT REQUEST asks for something else/);
    expect(prompt).toMatch(/EVERY LINE IS 4 TO 9 WORDS/);
    expect(prompt).toMatch(/at most five times in the whole card/);
  });

  it('makes every block one thought wrapped over two lines, with the comma doing the hand-over', () => {
    expect(prompt).toMatch(/The first line ENDS WITH A COMMA/);
    expect(prompt).toMatch(/Never write two separate little sentences/);
    expect(prompt).toMatch(/WRONG \(stop-start/);
    expect(prompt).toMatch(/RIGHT \(one thought, the comma hands it over\)/);
  });

  it('keeps facts out of lists and the voice out of the news desk', () => {
    expect(prompt).toMatch(/never a stack of dates, numbers, charges or names/);
    expect(prompt).toMatch(/Never the reporter/);
    expect(prompt).toMatch(/No spoken hedges or disclaimers in the bullets/);
    expect(prompt).toMatch(/never "RSA"/);
  });

  it('uses his first-person memories only as they already appear in the full script', () => {
    expect(prompt).toMatch(/used ONLY as they already appear in SOURCE_SCRIPT/);
    expect(prompt).toMatch(/Section 2 is the Unique twist/);
  });

  it('its own model obeys its own shape: label in the first rail line, one wrapped thought per block, a two-line jewel', () => {
    const model = prompt.split("THE CLIENT'S OWN MODEL")[1];
    const blocks = model.split(/\n\s*\n/).filter((b) => /^> /.test(b.trim()) && !/JEWEL/.test(b));
    expect(blocks.length).toBe(6);
    for (const b of blocks) {
      const lines = b.trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(/,$/);
      expect(lines[1]).toMatch(/[.?!]$/);
    }
    expect((model.match(/^> \*\*\dA?[A-C]\.\*\* /gm) || []).length).toBe(3);
    const jewel = model.split('### 💎 JEWEL')[1].split('## 2.')[0].trim().split('\n').filter((l) => l.startsWith('> '));
    expect(jewel).toHaveLength(2);
    expect(model).toMatch(/^## 1\. [A-Z ,'.]+\.$/m);
  });
});

describe('bullet script request', () => {
  const reply = [
    '<!-- SCRIPT_START -->',
    '# SCRIPT TITLE: TEST',
    '## **1. COLD OPEN**',
    '> You walk in,',
    '> and everybody knows your face.',
    '<!-- SCRIPT_END -->',
    '',
    'Fact-check (not spoken): DOJ confirms the conviction ([justice.gov](https://www.justice.gov/usao/pr/x)).',
  ].join('\n');

  it('hands the writer only the spoken script, without markers or the notes after it', () => {
    const script = scriptForBullets(reply);
    expect(script).toContain('> and everybody knows your face.');
    expect(script).not.toMatch(/SCRIPT_(START|END)/);
    expect(script).not.toMatch(/Fact-check/);
  });

  it('turns the fact-check line into plain text without links', () => {
    expect(extractFactNote(reply)).toBe('Fact-check (not spoken): DOJ confirms the conviction justice.gov.');
    expect(extractFactNote('no note here')).toBe('');
  });

  it('puts the request, the facts and the source script in one message', () => {
    const msg = buildBulletScriptRequest({ clientRequest: 'write the script for Bravo', fullScript: scriptForBullets(reply), facts: extractFactNote(reply) });
    expect(msg).toMatch(/^CLIENT REQUEST: write the script for Bravo/);
    expect(msg).toMatch(/VERIFIED FACTS: Fact-check/);
    expect(msg).toMatch(/SOURCE_SCRIPT:\n\n# SCRIPT TITLE: TEST/);
    expect(buildBulletScriptRequest({ clientRequest: 'x', fullScript: 'y' })).toMatch(/Use only the facts already in SOURCE_SCRIPT/);
  });
});
