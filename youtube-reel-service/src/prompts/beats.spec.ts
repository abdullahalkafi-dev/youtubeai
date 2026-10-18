import { placeBeats, BeatsResult } from './beats.prompt';

// 40 words, one every 0.5s → a 20s reel
const words = Array.from({ length: 40 }, (_, i) => ({ w: `w${i}`, s: i * 0.5, e: i * 0.5 + 0.4 }));
const beat = (startWord: number, durationSec: number, importance: 'high' | 'medium' = 'medium') => ({
  startWord,
  durationSec,
  importance,
  purpose: 'p',
  prompt: `scene ${startWord}`,
  safePrompt: `safe ${startWord}`,
  people: [],
});
const res = (beats: BeatsResult['beats']): BeatsResult => ({ style: 'cinematic', beats });

describe('placeBeats (AI image timing rules)', () => {
  it('clamps duration to 1.5–3s and starts just before the word', () => {
    const out = placeBeats(res([beat(4, 10), beat(20, 0.5)]), words, 40);
    expect(out).toEqual([
      expect.objectContaining({ start: 1.9, end: 4.9 }),
      expect.objectContaining({ start: 9.9, end: 11.4 }),
    ]);
  });

  it('never covers the payoff', () => {
    const out = placeBeats(res([beat(26, 3), beat(37, 2)]), words, 32); // payoff starts at word 32 = 16s
    expect(out).toHaveLength(1);
    expect(out[0].end).toBeLessThanOrEqual(16 - 0.2);
  });

  it('keeps 1.5s between images and prefers high importance', () => {
    const out = placeBeats(res([beat(10, 2), beat(12, 2, 'high')]), words, 40);
    expect(out).toHaveLength(1);
    expect(out[0].prompt).toBe('scene 12');
  });

  it('caps total image time at 30% of the reel and the count at max', () => {
    const out = placeBeats(res([beat(0, 3), beat(10, 3), beat(20, 3), beat(30, 3)]), words, 40);
    const covered = out.reduce((n, b) => n + (b.end - b.start), 0);
    expect(covered).toBeLessThanOrEqual(20 * 0.3 + 1e-6);
    expect(placeBeats(res([beat(0, 1.5), beat(8, 1.5), beat(16, 1.5), beat(24, 1.5), beat(32, 1.5)]), words, 40, 2)).toHaveLength(2);
  });

  it('ignores invalid word indexes and empty prompts', () => {
    expect(placeBeats(res([beat(99, 2), { ...beat(5, 2), prompt: '  ' }]), words, 40)).toEqual([]);
  });
});
