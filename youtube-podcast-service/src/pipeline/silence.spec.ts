import { buildTrimFilter, formatClock, keepSegments, mapTime, parseSilences, planCuts, removedSeconds } from './silence';

const LOG = `
[silencedetect @ 0x1] silence_start: 10.5
[silencedetect @ 0x1] silence_end: 14.5 | silence_duration: 4
[silencedetect @ 0x1] silence_start: 20
[silencedetect @ 0x1] silence_end: 20.8 | silence_duration: 0.8
[silencedetect @ 0x1] silence_start: 50
[silencedetect @ 0x1] silence_end: 53 | silence_duration: 3
[silencedetect @ 0x1] silence_start: 98
`;

describe('parseSilences', () => {
  it('reads start/end pairs and closes a silence that runs to the end of the file', () => {
    expect(parseSilences(LOG, 100)).toEqual([
      { start: 10.5, end: 14.5 },
      { start: 20, end: 20.8 },
      { start: 50, end: 53 },
      { start: 98, end: 100 },
    ]);
  });
  it('ignores noise lines and clamps a negative start to 0', () => {
    expect(parseSilences('size=N/A\n[x] silence_start: -0.02\n[x] silence_end: 2 | d', 10)).toEqual([{ start: 0, end: 2 }]);
  });
});

describe('planCuts', () => {
  const sil = parseSilences(LOG, 100);
  it('shortens only pauses of at least the minimum and keeps half of the kept pause on each side', () => {
    const cuts = planCuts(sil, 100, { minSilence: 1.5, keep: 0.6 });
    expect(cuts).toEqual([
      { start: 10.8, end: 14.2 },
      { start: 50.3, end: 52.7 },
      { start: 98.3, end: 99.7 },
    ]);
  });
  it('never cuts speech: every cut lies inside its silence', () => {
    for (const c of planCuts(sil, 100)) expect(sil.some((s) => c.start >= s.start && c.end <= s.end)).toBe(true);
  });
  it('skips a pause that would leave nothing worth cutting', () => {
    expect(planCuts([{ start: 5, end: 6.7 }], 100, { minSilence: 1.5, keep: 1.6 })).toEqual([]);
  });
  it('merges overlapping cuts and stays inside [0, total]', () => {
    const cuts = planCuts([{ start: 0, end: 5 }, { start: 4, end: 9 }, { start: 98, end: 120 }], 100, { minSilence: 1.5, keep: 0.6 });
    expect(cuts[0]).toEqual({ start: 0.3, end: 9 - 0.3 });
    expect(cuts[cuts.length - 1].end).toBeLessThanOrEqual(100);
  });
});

describe('keepSegments / removedSeconds', () => {
  const cuts = [{ start: 10, end: 20 }, { start: 30, end: 31 }];
  it('keeps what is between the cuts', () => {
    expect(keepSegments(cuts, 60)).toEqual([{ start: 0, end: 10 }, { start: 20, end: 30 }, { start: 31, end: 60 }]);
    expect(removedSeconds(cuts)).toBe(11);
  });
  it('kept time + removed time = the original', () => {
    const kept = keepSegments(cuts, 60).reduce((a, s) => a + s.end - s.start, 0);
    expect(kept + removedSeconds(cuts)).toBe(60);
  });
});

describe('mapTime', () => {
  const cuts = [{ start: 10, end: 20 }, { start: 30, end: 31 }];
  it('is the identity before the first cut', () => expect(mapTime(5, cuts)).toBe(5));
  it('subtracts every earlier cut', () => {
    expect(mapTime(25, cuts)).toBe(15);
    expect(mapTime(40, cuts)).toBe(29);
  });
  it('a moment inside a removed pause lands where the pause was shortened', () => {
    expect(mapTime(15, cuts)).toBe(10);
    expect(mapTime(30.5, cuts)).toBe(20);
  });
  it('is non-decreasing', () => {
    let prev = -1;
    for (let t = 0; t <= 60; t += 0.5) {
      const m = mapTime(t, cuts);
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
  });
  it('the end of the original maps to the trimmed length', () => expect(mapTime(60, cuts)).toBe(60 - 11));
});

describe('buildTrimFilter', () => {
  it('drops each cut in one aselect pass and re-times the rest', () => {
    expect(buildTrimFilter([{ start: 10.8, end: 14.2 }, { start: 50.3, end: 52.7 }])).toBe(
      "aselect='not((between(t,10.800,14.200)+between(t,50.300,52.700)))',asetpts=N/SR/TB",
    );
  });

  it('keeps the expression shallow for hundreds of cuts (ffmpeg fails on a flat chain of about 100 terms)', () => {
    const cuts = Array.from({ length: 500 }, (_, i) => ({ start: i * 10 + 1, end: i * 10 + 3 }));
    const filter = buildTrimFilter(cuts);
    let depth = 0;
    let max = 0;
    for (const ch of filter) {
      if (ch === '(') max = Math.max(max, ++depth);
      else if (ch === ')') depth--;
    }
    expect(max).toBeLessThan(25);
    expect(filter.match(/between\(/g)).toHaveLength(500);
  });
});

describe('formatClock', () => {
  it('formats m:ss and h:mm:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(157)).toBe('2:37');
    expect(formatClock(3725)).toBe('1:02:05');
  });
});
