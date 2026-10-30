import { watchedPct } from './youtube.publisher';

describe('watchedPct (share of the reel people watched)', () => {
  it('is watch time over views x length', () => {
    // the Oct 30 audit's best reel: 1,931 views, 549 watch minutes, 36 s long -> about 47%
    expect(watchedPct(549, 1931, 36)).toBeCloseTo(47.4, 1);
    // a weak one: 230 views, 40 watch minutes, 31 s -> about 33.7%
    expect(watchedPct(40, 230, 31)).toBeCloseTo(33.7, 1);
  });

  it('is undefined without data and never above 100', () => {
    expect(watchedPct(0, 100, 30)).toBeUndefined();
    expect(watchedPct(10, 0, 30)).toBeUndefined();
    expect(watchedPct(10, 100, undefined)).toBeUndefined();
    expect(watchedPct(1000, 10, 30)).toBe(100);
  });
});
