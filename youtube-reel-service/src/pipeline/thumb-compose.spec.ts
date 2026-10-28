import { buildThumbAss } from './thumb-compose';

/** The font size, the line breaks and the colour-marked text the ASS file ends up with. */
function layout(headline: string, accent: string[]) {
  const ass = buildThumbAss(headline, accent);
  const size = Number(/Style: Thumb,Anton,(\d+),/.exec(ass)![1]);
  const text = /\\pos\(\d+,\d+\)\}(.*)$/m.exec(ass)![1];
  return { size, lines: text.split('\\N').length, text };
}

describe('reel thumbnail headline: two lines (who + what happened, then the hook)', () => {
  it('fits in at most three lines at a size that still reads on a phone', () => {
    for (const h of ["LIL DURK DENIED BOND / THE FEDS' REAL PLAN", 'DIDDY MOVED AT 3AM, THE FEDS NEVER DO THAT', 'RETIRED NYPD COP SHOOTS WORKER ON GW BRIDGE']) {
      const l = layout(h, ['PLAN']);
      expect(l.lines).toBeLessThanOrEqual(3);
      expect(l.size).toBeGreaterThanOrEqual(118);
    }
  });

  it('colours only the hook words yellow', () => {
    const { text } = layout('LIL DURK DENIED BOND THE FEDS REAL PLAN', ['FEDS', 'REAL', 'PLAN']);
    expect(text).toMatch(/\{\\c&H0000E6FF\}FEDS/);
    expect(text).not.toMatch(/\{\\c&H0000E6FF\}DURK/);
  });
});
