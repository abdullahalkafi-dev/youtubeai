import { askForIdeas, roundWidth, stopsEarly, thinMaterial } from './composer.service';

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

describe('which campaigns stop after a weak first round', () => {
  const weak = [{ asm: { ok: true }, review: { verdict: 'drop' } }];
  it('a topic campaign does (a replacement topic is waiting)', () => {
    expect(stopsEarly({ origin: 'daily', settings: {} }, 1, 0, weak)).toBe(true);
  });
  it('a footage-first lane never does: it has no replacement and gets all its rounds', () => {
    for (const lane of ['fresh', 'news', 'best', 'bank']) expect(stopsEarly({ origin: 'daily', settings: { lane } }, 1, 0, weak)).toBe(false);
  });
  it('a campaign made by hand never does', () => {
    expect(stopsEarly({ origin: 'manual', settings: {} }, 1, 0, weak)).toBe(false);
  });
});

describe('the relaxed prompts keep the safety rules (Nov 17 2026)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { RELAXED_DIRECTOR, DIRECTOR_SYSTEM } = require('../prompts/director.prompt');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { RELAXED_CRITIC, CRITIC_SYSTEM } = require('../prompts/critic.prompt');

  it('relax only the opening and the setup, and say that accuracy is unchanged', () => {
    expect(RELAXED_DIRECTOR).toContain('NEW-VIDEO MODE');
    expect(RELAXED_DIRECTOR).toMatch(/does NOT have to name the person/);
    expect(RELAXED_DIRECTOR).toMatch(/no unproven accusation stated as fact/);
    expect(RELAXED_CRITIC).toMatch(/hook cap of 5/);
    expect(RELAXED_CRITIC).toMatch(/unproven accusations stated as fact/);
  });

  it('are appended to, never replacing, the strict prompts', () => {
    expect((DIRECTOR_SYSTEM + RELAXED_DIRECTOR).startsWith(DIRECTOR_SYSTEM)).toBe(true);
    expect((CRITIC_SYSTEM + RELAXED_CRITIC).startsWith(CRITIC_SYSTEM)).toBe(true);
    expect(CRITIC_SYSTEM).toMatch(/hook\s+5 at most/); // the strict rule is still there for the topic campaigns
  });
});
