import { CriticReview, overallScore, passesBar, worthSecondLook } from './critic.prompt';

const review = (over: Partial<CriticReview> = {}): CriticReview => ({
  ref: 'R1', hook: 7, clarity: 7, flow: 7, payoff: 7, ending: 7, retention: 7, safety: 9, verdict: 'drop', issues: [], revision: null, ...over,
});

describe('second look for strong ideas the critic dropped', () => {
  it('a safe idea that scores above the bar gets one revision before it is thrown away', () => {
    const r = review({ hook: 6, clarity: 7, flow: 8, payoff: 7, ending: 7, retention: 7 });
    expect(overallScore(r)).toBeGreaterThanOrEqual(60);
    expect(worthSecondLook(r, 60)).toBe(true);
  });

  it('never for a keep, a revise, or an idea that is already below the bar', () => {
    expect(worthSecondLook(review({ verdict: 'keep' }), 60)).toBe(false);
    expect(worthSecondLook(review({ verdict: 'revise' }), 60)).toBe(false);
    expect(worthSecondLook(review({ hook: 4, clarity: 5, flow: 5, payoff: 5, ending: 5, retention: 5 }), 60)).toBe(false);
  });

  it('never for something unsafe, whatever it scores', () => {
    const r = review({ hook: 9, clarity: 9, flow: 9, payoff: 9, ending: 9, retention: 9, safety: 6 });
    expect(worthSecondLook(r, 60)).toBe(false);
  });

  it('never when one part is very weak (nothing a cut can fix)', () => {
    expect(worthSecondLook(review({ hook: 9, clarity: 9, flow: 9, payoff: 3, ending: 9, retention: 9 }), 60)).toBe(false);
  });

  it('the bar itself did not move: a revised idea must still pass it to ship', () => {
    expect(passesBar(review({ verdict: 'keep', hook: 5 }), 60)).toBe(false);
    expect(passesBar(review({ verdict: 'keep', hook: 8, clarity: 8, flow: 8, payoff: 8, ending: 8, retention: 8 }), 60)).toBe(true);
  });
});
