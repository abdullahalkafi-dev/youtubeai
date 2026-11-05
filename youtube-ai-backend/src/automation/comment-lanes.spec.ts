import { nextInLane, otherLaneRemaining, replyKind, splitLanes } from './comment-lanes';

const day = (n: number) => new Date(Date.UTC(2026, 10, n));
const v = (id: string, durationSeconds: number, published: number, lastRan?: number) => ({
  _id: id,
  durationSeconds,
  publishedAt: day(published),
  autoReplyLastRanAt: lastRan === undefined ? null : new Date(Date.UTC(2026, 10, 6, lastRan)),
});

describe('comment auto-reply lanes (Nov 6 2026)', () => {
  it('a Short is 1-180 s; unknown length counts as long', () => {
    expect(replyKind({ durationSeconds: 45 })).toBe('short');
    expect(replyKind({ durationSeconds: 180 })).toBe('short');
    expect(replyKind({ durationSeconds: 181 })).toBe('long');
    expect(replyKind({ durationSeconds: 0 })).toBe('long');
    expect(replyKind({})).toBe('long');
  });

  it('lane A is the 3 newest long videos, even when newer Shorts exist', () => {
    // The live list on Nov 5: newer reels everywhere, the long videos older.
    const active = [v('reel1', 40, 5), v('reel2', 36, 5), v('yella', 1418, 4), v('reel3', 50, 4), v('chapo', 2179, 1), v('durk', 1500, 2), v('jaylen', 1600, 3)];
    const { top, other } = splitLanes(active);
    expect(top.map((x) => x._id)).toEqual(['yella', 'jaylen', 'durk']);
    expect(other.map((x) => x._id).sort()).toEqual(['chapo', 'reel1', 'reel2', 'reel3']);
  });

  it('round robin: the video checked longest ago goes next; never-checked first', () => {
    expect(nextInLane([v('a', 900, 3, 10), v('b', 900, 2, 9), v('c', 900, 1, 11)])!._id).toBe('b');
    expect(nextInLane([v('a', 900, 3, 10), v('new', 900, 4)])!._id).toBe('new');
    expect(nextInLane([])).toBeUndefined();
  });

  it('lane B stops at its share; lane A keeps the rest of the day', () => {
    expect(otherLaneRemaining(40, 130, 100)).toBe(60);
    expect(otherLaneRemaining(100, 130, 100)).toBe(0);
    expect(otherLaneRemaining(120, 130, 100)).toBe(0);
    expect(otherLaneRemaining(10, 50, 100)).toBe(40); // a lower daily cap still wins
  });
});
