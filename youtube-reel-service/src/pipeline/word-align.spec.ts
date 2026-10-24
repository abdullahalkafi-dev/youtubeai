import { captionsInSilence, parseSilences, realignWords } from './word-align';
import { buildTimeline, mapWords } from './timeline';

const w = (t: string, s: number, e: number) => ({ w: t, s, e });
const h = (word: string, start: number, end: number) => ({ word, start, end });

// The live Foolio Short (rTXHTRilEOU): clip 1 is 0-2.9 s, clip 2 starts at 2.9 s. The stored times put the
// start of "Revenge can feel like justice" at 5.8 s; the audio really has it about 1 s later.
const stored = [
  w('Revenge', 0.12, 0.17), w('can', 0.12, 0.52), w('feel', 0.52, 1), w('righteous', 1, 1.82), w('at', 1.82, 2.24), w('times', 2.24, 2.7),
  w('can', 2.9, 4.02), w('trick', 4.02, 4.32), w('you', 4.32, 4.9),
  w('Revenge', 5.8, 5.85), w('can', 5.8, 6.4), w('feel', 6.4, 7.38), w('like', 7.38, 7.76), w('justice', 7.76, 8.16),
];
const spans = [{ from: 0, to: 2.9 }, { from: 2.9, to: 9 }];
const heard = [
  h('Friends', 0, 0.18), h('can', 0.18, 0.44), h('feel', 0.44, 0.82), h('righteous', 0.82, 1.82), h('at', 1.82, 2.06), h('times', 2.06, 2.52),
  h('can', 3.5, 3.72), h('trick', 3.72, 4.0), h('you', 4.0, 4.38),
  h('friends', 4.68, 4.92), h('can', 4.92, 5.88), h('feel', 5.88, 6.22), h('like', 6.22, 6.58), h('justice', 6.58, 6.98),
];

describe('realignWords', () => {
  it('takes the times from the audio and keeps the stored words', () => {
    const r = realignWords(stored, heard, spans);
    expect(r.ok).toBe(true);
    expect(r.words.map((x) => x.w)).toEqual(stored.map((x) => x.w));
    const trick = r.words.find((x) => x.w === 'trick')!;
    expect(trick.s).toBeCloseTo(3.72, 2);
    const justice = r.words.find((x) => x.w === 'justice')!;
    expect(justice.s).toBeCloseTo(6.58, 2);
  });

  it('keeps every word inside its own clip and in order', () => {
    const r = realignWords(stored, heard, spans);
    r.words.slice(0, 6).forEach((x) => expect(x.e).toBeLessThanOrEqual(2.9 + 1e-6));
    r.words.slice(6).forEach((x) => expect(x.s).toBeGreaterThanOrEqual(2.9));
    for (let i = 1; i < r.words.length; i++) expect(r.words[i].s).toBeGreaterThanOrEqual(r.words[i - 1].s);
  });

  it('copes with a word the second transcript dropped', () => {
    const fewer = heard.filter((x) => x.word !== 'trick');
    const r = realignWords(stored, fewer, spans);
    expect(r.ok).toBe(true);
    const trick = r.words.find((x) => x.w === 'trick')!;
    expect(trick.s).toBeGreaterThanOrEqual(3.5);
    expect(trick.e).toBeLessThanOrEqual(4.4);
  });

  it('moves pictures with the words', () => {
    const r = realignWords(stored, heard, spans);
    // a picture planned at "Revenge can feel like justice" (stored 5.8 s) follows the audio
    expect(r.correct(5.8)).toBeCloseTo(4.68, 1);
    expect(r.correct(0.05)).toBeCloseTo(0.05 + (r.words[0].s - 0.12), 2);
  });

  it('refuses a transcript that is not this speech, and an empty one', () => {
    const other = ['the', 'weather', 'is', 'nice', 'today', 'in', 'the', 'park', 'near', 'my', 'house', 'again', 'and', 'again'].map((t, i) => h(t, i, i + 0.5));
    expect(realignWords(stored, other, spans)).toMatchObject({ ok: false });
    expect(realignWords(stored, [], spans)).toMatchObject({ ok: false });
    expect(realignWords([], heard, spans)).toMatchObject({ ok: false });
  });
});

describe('edge cuts and the whole path', () => {
  const clips = [
    { src: 'a', start: 100, duration: 2.9 },
    { src: 'a', start: 387.61, duration: 6.1 },
  ];
  const pace = { speed: 1.08, voice: 'natural' as const, semitones: 0, minGap: 0.45, keep: 0.12, maxSegments: 30, edgeCuts: true };

  it('cuts the dead air at the start of a clip and keeps the timeline exact', () => {
    const r = realignWords(stored, heard, spans);
    const tl = buildTimeline(clips, r.words, pace);
    // clip 2 opens with about 0.6 s of silence before "can" (3.5 s): that is cut, the join stays a join
    expect(tl.cuts.some(([a, b]) => Math.abs(a - 2.9) < 0.01 && b > 3.2)).toBe(true);
    expect(tl.segments[1].kind).toBe('join');
    const kept = tl.segments.reduce((n, s) => n + s.duration, 0);
    const removed = tl.cuts.reduce((n, [a, b]) => n + (b - a), 0);
    expect(kept + removed).toBeCloseTo(9, 1);
  });

  it('captions land on the voice: the cut ends 0.12 s before the first word', () => {
    const r = realignWords(stored, heard, spans);
    const tl = buildTimeline(clips, r.words, pace);
    const words = mapWords(r.words, tl);
    expect(words.find((x) => x.w === 'trick')!.s).toBeCloseTo(tl.map(3.72), 2);
    // clip 2 starts at 2.9 s and its first word is at 3.5 s: the cut is [2.9, 3.38]
    const lead = tl.cuts.find(([a]) => Math.abs(a - 2.9) < 0.01)!;
    expect(3.5 - lead[1]).toBeCloseTo(0.12, 2);
  });

  it('without edge cuts the old behaviour is unchanged', () => {
    const tl = buildTimeline(clips, stored, { ...pace, edgeCuts: false });
    expect(tl.cuts.every(([a]) => Math.abs(a - 2.9) > 0.01)).toBe(true);
  });
});

describe('checks on the finished file', () => {
  it('reads silences from ffmpeg output', () => {
    const log = '[silencedetect @ 0x1] silence_start: 5.4188\n[silencedetect @ 0x1] silence_end: 5.9207 | silence_duration: 0.5019\n[silencedetect @ 0x1] silence_start: 9.6\n';
    expect(parseSilences(log)).toEqual([[5.4188, 5.9207]]);
  });

  it('flags captions that start well inside silence, and passes captions on the voice', () => {
    const silences: Array<[number, number]> = [[5.0, 6.0]];
    expect(captionsInSilence([{ w: 'Revenge', s: 5.5, e: 5.9 }], silences)).toEqual({ count: 1, worst: 0.5 });
    expect(captionsInSilence([{ w: 'Revenge', s: 6.02, e: 6.4 }, { w: 'can', s: 5.1, e: 5.2 }], silences)).toEqual({ count: 0, worst: 0 });
  });
});
