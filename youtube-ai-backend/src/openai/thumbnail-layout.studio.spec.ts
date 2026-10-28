import { layoutZones, zonePrompt, Box } from './thumbnail-layout';
import { stripHostFromScene, sameHeadline } from './openai.service';

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('thumbnail layout zones', () => {
  it.each([
    ['16:9', 'top-right'],
    ['16:9', 'top-left'],
    ['9:16', 'top-right'],
    ['9:16', 'top-left'],
  ] as const)('keeps the headline clear of the logo and host (%s, %s)', (aspectRatio, logoPosition) => {
    const zones = layoutZones({ aspectRatio, logoPosition });
    expect(zones.logo && overlaps(zones.headline, zones.logo)).toBeFalsy();
    expect(zones.host && overlaps(zones.headline, zones.host)).toBeFalsy();
  });
  it('drops reserved corners that are not used', () => {
    const zones = layoutZones({ excludeLogo: true, excludeHost: true });
    expect(zones.logo).toBeUndefined();
    expect(zones.host).toBeUndefined();
  });
  it('tells the image model the exact headline and the reserved corners', () => {
    const text = zonePrompt(layoutZones({ logoPosition: 'top-right' }), 'THEY KILLED THE WRONG WOMAN');
    expect(text).toContain('"THEY KILLED THE WRONG WOMAN"');
    expect(text.match(/RESERVED CORNER/g)).toHaveLength(2);
    expect(text).not.toMatch(/courtroom|gavel/i);
  });
  it('asks for a three-line headline as stacked lines with the hook line in the accent color', () => {
    const text = zonePrompt(layoutZones({ logoPosition: 'top-right' }), 'RETIRED NYPD COP / SHOOTS WORKER ON GW BRIDGE / WHAT PRISON DOES TO COPS');
    expect(text).toContain('3 stacked lines');
    expect(text).toContain('"RETIRED NYPD COP" then "SHOOTS WORKER ON GW BRIDGE" then "WHAT PRISON DOES TO COPS"');
    expect(text).toMatch(/LAST line is the hook/);
    expect(text).not.toContain(' / ');
  });
});

describe('scene text helpers', () => {
  it('removes instructions to draw the host but keeps the real subject', () => {
    const cleaned = stripHostFromScene(
      'Ashburne fills the left third. Unique on the opposite side using his actual reference likeness. Hightower large on the left, paired with Unique.',
    );
    expect(cleaned).toContain('Ashburne fills the left third');
    expect(cleaned).toContain('Hightower large on the left');
    expect(cleaned).not.toMatch(/\bUnique\b/);
  });
  it('compares headlines ignoring case, line breaks and quote styles', () => {
    expect(sameHeadline("how do i tell my family / i'm never coming home?", 'HOW DO I TELL MY FAMILY\nI’M NEVER COMING HOME?')).toBe(true);
    expect(sameHeadline('HIS PLOT KILLE THE WRONG WOMAN', 'HIS PLOT KILLED THE WRONG WOMAN')).toBe(false);
  });
});
