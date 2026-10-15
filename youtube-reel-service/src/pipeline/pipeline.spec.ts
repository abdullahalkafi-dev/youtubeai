import { z } from 'zod';
import { toStrictJsonSchema } from '../ai/json-schema';
import { buildTranscript } from './transcript';
import { assemble, Material, resolveClipTimes } from './assembly';
import { assColor, buildAss, buildSrt, chunkWords, layoutHeadline } from './captions';
import { parseTemplate } from './template';
import { overallScore, passesBar } from '../prompts/critic.prompt';
import { DirectorSchema } from '../prompts/director.prompt';

const whisper = (offset: number) => ({
  offset,
  result: {
    text: '',
    language: 'english',
    duration: 10,
    segments: [
      { start: 0, end: 4, text: ' The first night inside, nobody tells you the rules. You learn them.' },
      { start: 4.5, end: 8, text: ' Trust nobody.' },
      { start: 8, end: 10, text: ' music music music music music music music', compression_ratio: 3.1 },
    ],
    words: [
      ['The', 0.0, 0.3], ['first', 0.3, 0.6], ['night', 0.6, 0.9], ['inside', 0.9, 1.4], ['nobody', 1.6, 2.0],
      ['tells', 2.0, 2.3], ['you', 2.3, 2.4], ['the', 2.4, 2.5], ['rules', 2.5, 3.0], ['You', 3.2, 3.4],
      ['learn', 3.4, 3.7], ['them', 3.7, 3.95], ['Trust', 4.6, 5.0], ['nobody', 5.0, 5.6], ['music', 8.1, 8.5],
    ].map(([word, start, end]) => ({ word: word as string, start: start as number, end: end as number })),
  },
});

describe('json schema conversion', () => {
  it('closes every object and requires every property', () => {
    const s = toStrictJsonSchema(
      z.object({ a: z.string(), b: z.number().min(1).max(10), c: z.array(z.object({ d: z.string().nullable() })) }),
    ) as any;
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(['a', 'b', 'c']);
    expect(s.properties.b.minimum).toBeUndefined();
    expect(s.properties.c.items.required).toEqual(['d']);
    expect(s.properties.c.items.additionalProperties).toBe(false);
  });

  it('accepts the director schema', () => {
    const s = toStrictJsonSchema(DirectorSchema) as any;
    expect(s.properties.reels.items.properties.clips.items.properties.role.enum).toContain('payoff');
  });
});

describe('transcript building', () => {
  const t = buildTranscript([whisper(0), whisper(100)]);
  it('drops hallucinated segments and their words', () => {
    expect(t.words.find((w) => w.w === 'music')).toBeUndefined();
  });
  it('splits multi-sentence segments into sentence lines with word ranges', () => {
    expect(t.lines[0].t).toBe('The first night inside, nobody tells you the rules.');
    expect(t.lines[1].t).toBe('You learn them.');
    expect(t.words[t.lines[1].w0].w).toBe('You');
    expect(t.lines[2].t).toBe('Trust nobody.');
  });
  it('offsets later chunks', () => {
    expect(t.lines[3].s).toBeCloseTo(100, 3);
    expect(t.lines.length).toBe(6);
  });
});

function material(key = 'V1', offset = 0): Material {
  const t = buildTranscript([whisper(offset), whisper(offset + 10), whisper(offset + 20), whisper(offset + 30), whisper(offset + 40), whisper(offset + 50)]);
  return { key, youtubeId: `yt${key}`, videoId: `vid${key}`, title: 'Test', viewCount: 1, durationSec: 60, lines: t.lines, words: t.words };
}

describe('clip assembly', () => {
  const m = material();
  const mats = new Map([[m.key, m]]);

  it('snaps cuts to word boundaries without bleeding into neighbours', () => {
    const r = resolveClipTimes(m, 1, 1); // "You learn them."
    expect(r.start).toBeGreaterThan(3.0); // after "rules" ended at 3.0
    expect(r.start).toBeLessThanOrEqual(3.2);
    expect(r.end).toBeGreaterThanOrEqual(3.95);
    expect(r.end).toBeLessThan(4.6); // before "Trust"
  });

  it('accepts a valid single take and builds the reel timeline', () => {
    const a = assemble([{ video: 'V1', startLine: 0, endLine: 17, role: 'build' }], mats, { minSec: 30, maxSec: 60, allowCrossVideo: false });
    expect(a.errors).toEqual([]);
    expect(a.words[0].s).toBe(0); // first word starts at 0.0 in the source
    expect(a.words.some((w) => w.eos)).toBe(true);
    expect(a.duration).toBeGreaterThan(50);
  });

  it('reports overlap, backwards jumps and duration problems', () => {
    const a = assemble(
      [
        { video: 'V1', startLine: 9, endLine: 9, role: 'hook' },
        { video: 'V1', startLine: 3, endLine: 5, role: 'setup' },
        { video: 'V1', startLine: 1, endLine: 2, role: 'build' },
      ],
      mats,
      { minSec: 30, maxSec: 60, allowCrossVideo: false },
    );
    expect(a.ok).toBe(false);
    expect(a.errors.join(' ')).toMatch(/backwards/);
  });

  it('rejects cross-video when not allowed and unknown lines', () => {
    const m2 = material('V2', 500);
    const all = new Map([[m.key, m], [m2.key, m2]]);
    const a = assemble(
      [
        { video: 'V1', startLine: 0, endLine: 5, role: 'hook' },
        { video: 'V2', startLine: 0, endLine: 5, role: 'payoff' },
      ],
      all,
      { minSec: 30, maxSec: 60, allowCrossVideo: false },
    );
    expect(a.errors.join(' ')).toMatch(/cross-video/);
    const b = assemble([{ video: 'V2', startLine: 0, endLine: 999, role: 'build' }], all, { minSec: 30, maxSec: 60, allowCrossVideo: true });
    expect(b.errors.join(' ')).toMatch(/does not exist/);
  });
});

describe('captions', () => {
  it('converts colors to ASS BGR', () => {
    expect(assColor('#FFD400')).toBe('&H0000D4FF');
  });

  it('chunks on sentence ends and limits', () => {
    const words = [
      { w: 'Trust', s: 0, e: 0.3 },
      { w: 'nobody', s: 0.3, e: 0.7, eos: true },
      { w: 'They', s: 0.8, e: 1 },
      { w: 'will', s: 1, e: 1.2 },
      { w: 'smile', s: 1.2, e: 1.5 },
      { w: 'first', s: 1.5, e: 1.9 },
    ];
    const chunks = chunkWords(words, 3, 20);
    expect(chunks.map((c) => c.words.map((w) => w.w).join(' '))).toEqual(['Trust nobody', 'They will smile', 'first']);
    expect(chunks[0].end).toBe(0.8);
  });

  const tpl = parseTemplate({ window: { x: 0, y: 560, w: 1080, h: 760 }, headline: {}, captions: {} });

  it('wraps and shrinks the headline to fit', () => {
    const { lines, size } = layoutHeadline('The first night inside federal prison nobody warns you about', tpl.headline);
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(size).toBeLessThanOrEqual(tpl.headline.size);
  });

  it('escapes override characters from spoken text', () => {
    const ass = buildAss({ words: [{ w: '{\\b1}hack', s: 0, e: 0.5 }], headline: 'Test {x}', template: tpl, duration: 1 });
    expect(ass).not.toContain('{\\b1}');
    expect(ass).toContain('HACK');
    expect(ass).toContain('TEST X');
  });

  it('builds srt', () => {
    const srt = buildSrt([{ w: 'Hello', s: 0, e: 0.5, eos: true }, { w: 'World', s: 1, e: 1.5 }]);
    expect(srt).toContain('00:00:00,000 --> 00:00:00,500');
    expect(srt.split('\n\n').filter(Boolean).length).toBe(2);
  });
});

describe('critic scoring', () => {
  it('weights to 100 and enforces no weak link', () => {
    const perfect = { hook: 10, clarity: 10, flow: 10, payoff: 10, ending: 10, retention: 10, safety: 10 };
    expect(overallScore(perfect)).toBe(100);
    const weakEnding = { ...perfect, ending: 4, ref: 'R1', verdict: 'keep' as const, issues: [], revision: null };
    expect(passesBar(weakEnding)).toBe(false);
    expect(overallScore({ ...perfect, safety: 4 })).toBe(76);
  });
});
