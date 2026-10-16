import { matchesEpisodeSubjects } from './contracts';
import {
  normalizePlan,
  RequestPlan,
  validatePackaging,
  validateScript,
  scriptTiming,
  renderScript,
  reflowScript,
  PackagingBrief,
} from './contracts';
const plan = (): RequestPlan => ({
  action: 'create',
  topic: 'Family phone call',
  subjects: [],
  promise: 'The hardest call',
  emphasis: 'family',
  mode: 'new',
  deliverables: ['script', 'packaging'],
  thumbnails: true,
  research: true,
  newEpisode: true,
  duration: { min: 99, max: 99 },
  questions: [],
  standingPreferences: [],
});
describe('episode planning contracts', () => {
  it('preserves mixed deliverables and defaults to 8–10 minutes', () => {
    const result = normalizePlan(
      plan(),
      'Script, title and thumbnails for this video',
    );
    expect(result.deliverables).toEqual(['script', 'packaging']);
    expect(result.duration).toEqual({ min: 8, max: 10 });
    expect(result.thumbnails).toBe(true);
  });
  it.each([
    ['seven', '7 minutes', 7, 7],
    ['range', '8 to 10 minutes', 8, 10],
    ['long', '35-minute script', 35, 35],
  ])('honors explicit duration: %s', (_, request, min, max) => {
    expect(normalizePlan(plan(), request).duration).toEqual({ min, max });
  });
  it('ignores a pasted active script duration when the latest request sets another', () => {
    expect(
      normalizePlan(
        plan(),
        '[ACTIVE SCRIPT CONTEXT] 20 minutes [USER REQUEST] make this 7 minutes',
      ).duration.min,
    ).toBe(7);
  });
  it('formats without new images or research', () => {
    expect(
      normalizePlan(
        { ...plan(), action: 'format' },
        'Make the lines breathable',
      ),
    ).toMatchObject({
      deliverables: ['script'],
      thumbnails: false,
      research: false,
    });
  });
  it('does not save inferred standing preferences from a selection', () => {
    expect(
      normalizePlan(
        { ...plan(), standingPreferences: ['Use red'] },
        'I like option two',
      ).standingPreferences,
    ).toEqual([]);
    expect(
      normalizePlan(
        { ...plan(), standingPreferences: ['Use recognizable faces'] },
        'For future thumbnails use recognizable faces',
      ).standingPreferences,
    ).toHaveLength(1);
  });
  it('rejects invalid duration and action', () => {
    expect(() => normalizePlan(plan(), '0 minutes')).toThrow();
    expect(() =>
      normalizePlan({ ...plan(), action: 'invalid' as never }, 'Hello'),
    ).toThrow();
  });
});
describe('packaging contract', () => {
  const concept = {
    text: "HOW DO I TELL MY FAMILY\nI'M NEVER COMING HOME?",
    visual: 'A phone in his hand',
    colors: 'white, yellow, blue',
    emotion: 'restrained tears',
    textSide: 'left' as const,
    aspectRatio: '16:9' as const,
  };
  const pack = (): PackagingBrief => ({
    title:
      'A complete title that may legitimately exceed an old arbitrary seventy character limit',
    rationale: '',
    thumbnails: [
      { ...concept },
      { ...concept, visual: 'Family waiting behind glass' },
    ],
  });
  it('retains complete wording and long titles', () => {
    const value = pack();
    validatePackaging(value, true);
    expect(value.thumbnails[0].text).toBe(concept.text);
    expect(value.title.length).toBeGreaterThan(70);
  });
  it('rejects one and three concepts rather than silently dropping a variant', () => {
    expect(() =>
      validatePackaging({ ...pack(), thumbnails: [concept] }, true),
    ).toThrow('exactly two');
    expect(() =>
      validatePackaging(
        { ...pack(), thumbnails: [concept, concept, concept] },
        true,
      ),
    ).toThrow('exactly two');
  });
  it('does not create thumbnails for metadata-only output', () => {
    expect(() =>
      validatePackaging({ ...pack(), thumbnails: [] }, false),
    ).not.toThrow();
  });
});
describe('spoken structure and duration', () => {
  const script = {
    title: 'The phone call',
    notes: ['Not spoken'],
    sections: [
      {
        title: 'Waiting',
        purpose: 'Put viewers inside',
        blocks: [
          { lines: [Array(130).fill('word').join(' ')], cue: 'PAUSE' as const },
        ],
        jewel: ['Remember your family.'],
      },
    ],
  };
  it('counts only speech plus explicit pause duration', () => {
    expect(scriptTiming(script)).toMatchObject({ words: 133, seconds: 65 });
  });
  it('reflows speech without changing a single spoken token', () => {
    const formatted = reflowScript(script);
    expect(formatted.sections[0].blocks[0].lines.join(' ')).toBe(
      script.sections[0].blocks[0].lines[0],
    );
    expect(
      formatted.sections[0].blocks[0].lines.every(
        (line) => line.split(' ').length <= 7,
      ),
    ).toBe(true);
    expect(scriptTiming(formatted)).toEqual(scriptTiming(script));
  });
  it('renders dynamic headings and compatible script delimiters', () => {
    const result = renderScript(script);
    expect(result).toContain('<!-- SCRIPT_START -->');
    expect(result).toContain('1. Waiting');
    expect(result).not.toContain('Not spoken');
    expect(result).not.toContain('THE SENTENCE STARTS BEFORE THE JUDGE');
  });
  it('rejects invalid cues and incomplete sections', () => {
    expect(() => validateScript({ title: 'x', sections: [] })).toThrow();
    expect(() =>
      validateScript({
        ...script,
        sections: [
          {
            ...script.sections[0],
            blocks: [{ lines: ['x'], cue: 'INVALID' as never }],
          },
        ],
      }),
    ).toThrow();
  });
});

describe('episode ownership of attached context', () => {
  it('rejects an unrelated attached subject', () => {
    expect(matchesEpisodeSubjects('Diddy hospital story', ['Keefe D'])).toBe(
      false,
    );
    expect(
      matchesEpisodeSubjects('Keefe D first night in prison', [
        'Duane Keefe D Davis',
      ]),
    ).toBe(true);
  });
});

describe('agent clarity helpers and shared prompts', () => {
  const { describePlan, describeOutcome } = require('./contracts');
  const { SCRIPT_PROMPT, CREATIVE_CONTRACT, PLAN_PROMPT } = require('./studio.prompts');
  const plan = (over: any = {}) => ({
    action: 'create',
    deliverables: ['script', 'packaging'],
    thumbnails: true,
    research: true,
    duration: { min: 8, max: 10 },
    packagingChanges: [],
    ...over,
  });
  it('tells the client in one sentence what will happen', () => {
    expect(describePlan(plan())).toBe(
      'I will research this first, then write a script of about 9 minutes, build the title and metadata and create two thumbnails and generate both images automatically.',
    );
    expect(describePlan(plan({ action: 'format', deliverables: ['script'], thumbnails: false, research: false }))).toBe(
      'I will reformat your script without changing its words.',
    );
    expect(describePlan(plan({ deliverables: ['answer'], thumbnails: false }))).toBe('');
  });
  it('summarizes what was made and what was kept', () => {
    const line = describeOutcome(
      [
        { kind: 'script', status: 'ready', data: { timing: { seconds: 540 } } },
        { kind: 'packaging', status: 'ready', data: { description: 'x' } },
        { kind: 'thumbnail', status: 'ready' },
        { kind: 'thumbnail', status: 'ready' },
        { kind: 'thumbnail', status: 'failed' },
      ],
      true,
    );
    expect(line).toContain('script (about 9 min, estimated)');
    expect(line).toContain('title and description');
    expect(line).toContain('2 images');
    expect(line).toContain('kept as it was');
  });
  it('carries the approved voice and the client-details rule', () => {
    expect(SCRIPT_PROMPT).toContain('SPOKEN LINE CONTRACT');
    expect(SCRIPT_PROMPT).toContain('WRONG vs RIGHT');
    expect(SCRIPT_PROMPT).toContain('approvedExamples');
    expect(CREATIVE_CONTRACT).not.toContain('Never invent injuries');
    expect(CREATIVE_CONTRACT).toContain('clientRequestedDetails');
    expect(PLAN_PROMPT).toContain('FEEDBACK AND TARGETS');
  });
});

describe('YouTube publication limits', () => {
  const { validatePackaging } = require('./contracts');
  const concept = { text: 'A', visual: 'v', emotion: 'e' };
  const pack = (over: any = {}) => ({
    title: 'Fine title',
    rationale: '',
    thumbnails: [concept, concept],
    ...over,
  });
  it('accepts a title of exactly 100 characters and rejects 101', () => {
    expect(() => validatePackaging(pack({ title: 'x'.repeat(100) }), true)).not.toThrow();
    expect(() => validatePackaging(pack({ title: 'x'.repeat(101) }), true)).toThrow(/at most 100/);
  });
  it('rejects a 30-word title and over-long description or tags', () => {
    const thirtyWords = Array(30).fill('prison').join(' ');
    expect(() => validatePackaging(pack({ title: thirtyWords }), true)).toThrow(/characters/);
    expect(() => validatePackaging(pack({ description: 'd'.repeat(5001) }), true)).toThrow(/5000/);
    expect(() => validatePackaging(pack({ tags: Array(60).fill('prison life') }), true)).toThrow(/500/);
  });
});
