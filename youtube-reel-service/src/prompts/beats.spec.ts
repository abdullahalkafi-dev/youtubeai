import { BEAT_RULES, BeatsResult, buildBeatsUser, locatePhrase, placeBeats } from './beats.prompt';

/** A 24 s transcript, 3 sentences, ~0.4 s per word. Sentence ends carry eos. */
function transcript(sentences: string[]) {
  const words: Array<{ w: string; s: number; e: number; eos?: boolean }> = [];
  let t = 0;
  for (const sentence of sentences) {
    const parts = sentence.split(' ');
    parts.forEach((w, i) => {
      words.push({ w, s: +t.toFixed(2), e: +(t + 0.34).toFixed(2), ...(i === parts.length - 1 ? { eos: true } : {}) });
      t += 0.4;
    });
    t += 0.2;
  }
  return words;
}

const words = transcript([
  'I spent twenty six years inside the federal system and I saw everything.', // 0..
  'The guard would not let me flush my toilet because he controlled the water.', // 1
  'Then he walked down the hallway and the whole tier went quiet.', // 2
  'That silence taught me more than any book ever did.', // 3 (payoff)
  'Remember that when you think nobody is watching.', // 4
]);
const idx = (w: string, from = 0) => words.findIndex((x, i) => i >= from && x.w.toLowerCase().replace(/[^a-z]/g, '') === w);
const beat = (phrase: string, importance: 'high' | 'medium' = 'medium', prompt = `scene ${phrase}`) => ({ phrase, importance, purpose: 'p', prompt, safePrompt: `safe ${phrase}`, people: [] as string[] });
const res = (beats: BeatsResult['beats']): BeatsResult => ({ style: 'cinematic', beats });
const payoffAt = idx('that'); // the payoff starts at "That silence…"

describe('locatePhrase', () => {
  it('finds the exact words and returns the first and last word', () => {
    const at = locatePhrase(words, 'flush my toilet')!;
    expect(words[at.first].w).toBe('flush');
    expect(words[at.last].w).toBe('toilet');
  });
  it('ignores case and punctuation, and tolerates one dropped word', () => {
    expect(locatePhrase(words, 'Federal SYSTEM!')).toBeTruthy();
    const at = locatePhrase(words, 'walked the hallway')!; // "walked down the hallway": the model dropped "down"
    expect(words[at.first].w).toBe('walked');
  });
  it('returns null for words that were never said (no guessing)', () => {
    expect(locatePhrase(words, 'courtroom jury verdict')).toBeNull();
    expect(locatePhrase(words, 'toilet')).toBeNull(); // needs at least 2 words
  });
});

describe('placeBeats (picture timing rules)', () => {
  it('shows the picture as he starts the phrase (not before), and holds to the end of the sentence', () => {
    const out = placeBeats(res([beat('flush my toilet')]), words, payoffAt);
    const first = words[idx('flush')];
    expect(out).toHaveLength(1);
    expect(out[0].start).toBeCloseTo(first.s - BEAT_RULES.lead, 1);
    expect(Math.abs(out[0].start - first.s)).toBeLessThan(0.25); // the goal: within a quarter second of the words
    const sentenceEnd = words[idx('water')].e;
    expect(out[0].end).toBeGreaterThanOrEqual(Math.min(sentenceEnd, out[0].start + BEAT_RULES.maxLen) - 0.2);
    expect(out[0].end - out[0].start).toBeLessThanOrEqual(BEAT_RULES.maxLen + 1e-6);
  });

  it('never starts before 0.8 s, so the host opens the reel', () => {
    const out = placeBeats(res([beat('spent twenty six')]), words, payoffAt);
    expect(out[0].start).toBeGreaterThanOrEqual(BEAT_RULES.minStart);
  });

  it('never covers the payoff', () => {
    const out = placeBeats(res([beat('went quiet'), beat('silence taught me')]), words, payoffAt);
    const limit = words[payoffAt].s;
    expect(out.every((b) => b.end <= limit)).toBe(true);
    expect(out.some((b) => b.phrase === 'silence taught me')).toBe(false); // starts inside the payoff → dropped
  });

  it('drops phrases that are not in the transcript instead of guessing a time', () => {
    expect(placeBeats(res([beat('a courtroom full of people')]), words, payoffAt)).toEqual([]);
  });

  it('keeps a gap between pictures and prefers high importance when two start almost together', () => {
    const out = placeBeats(res([beat('flush my toilet', 'medium'), beat('controlled the water', 'high')]), words, payoffAt);
    expect(out).toHaveLength(1);
    expect(out[0].phrase).toBe('controlled the water');
  });

  it('on a collision shortens the EARLIER picture (its start stays on its word) instead of dropping the later one', () => {
    const out = placeBeats(res([beat('twenty six years', 'medium'), beat('saw everything', 'medium')]), words, payoffAt);
    expect(out).toHaveLength(2);
    expect(out[1].start - out[0].end).toBeGreaterThanOrEqual(BEAT_RULES.gap - 1e-6);
    // both still begin right at their spoken words
    expect(Math.abs(out[1].start - (words[idx('saw')].s - BEAT_RULES.lead))).toBeLessThan(0.01);
    expect(out[0].end - out[0].start).toBeGreaterThanOrEqual(1.2);
  });

  it('caps the count and the share of the reel covered', () => {
    const many = res([beat('federal system'), beat('flush my toilet'), beat('walked down'), beat('went quiet'), beat('hallway and the')]);
    const total = words[words.length - 1].e;
    const out = placeBeats(many, words, words.length, 3);
    expect(out.length).toBeLessThanOrEqual(3);
    const covered = out.reduce((n, b) => n + (b.end - b.start), 0);
    expect(covered).toBeLessThanOrEqual(total * BEAT_RULES.maxCoverage + 1e-6);
  });
});

describe('buildBeatsUser', () => {
  it('gives the model the transcript as plain sentences with the payoff marked, so it can quote exact words', () => {
    const text = buildBeatsUser({ concept: 'c', headline: 'h', words, protectedFrom: payoffAt, knownPeople: [] });
    expect(text).toContain('federal system and I saw everything.');
    expect(text).toContain('<<PAYOFF>> That silence');
    expect(text).not.toMatch(/\[\d+\] \d/); // no line indexes any more
  });
});
