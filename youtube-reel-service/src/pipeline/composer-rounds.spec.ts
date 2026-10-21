import { askForIdeas, roundWidth, thinMaterial } from './composer.service';

describe('composer: a wide first round', () => {
  it('round 1 shows 40-60 moments, later rounds fewer', () => {
    expect(roundWidth(1, 4)).toBe(40); // the Oct 21 campaign saw only 24 in round 1
    expect(roundWidth(1, 7)).toBe(60);
    expect(roundWidth(1, 13)).toBe(60);
    expect(roundWidth(2, 4)).toBe(24);
    expect(roundWidth(3, 13)).toBe(45);
  });

  it('round 1 asks for twice the target (the critic keeps about half)', () => {
    expect(askForIdeas(1, 4)).toBe(8);
    expect(askForIdeas(1, 7)).toBe(14);
    expect(askForIdeas(1, 1)).toBe(2);
    expect(askForIdeas(2, 4)).toBe(7);
  });
});

describe('composer: stop early when the best footage gave nothing', () => {
  const cand = (ok: boolean, verdict?: string) => ({ asm: { ok }, review: verdict ? { verdict } : undefined });

  it('stops after round 1 when every idea was dropped outright (the Oct 21 case)', () => {
    expect(thinMaterial(1, 0, [cand(true, 'drop'), cand(true, 'drop')])).toBe(true);
    expect(thinMaterial(1, 0, [])).toBe(true); // the director found nothing at all
  });

  it('keeps going when something could still be saved, or when reels were already kept', () => {
    expect(thinMaterial(1, 0, [cand(true, 'drop'), cand(true, 'revise')])).toBe(false);
    expect(thinMaterial(1, 2, [cand(true, 'drop')])).toBe(false);
    expect(thinMaterial(2, 0, [cand(true, 'drop')])).toBe(false);
  });
});
