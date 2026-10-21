import { matchTrend, velocityShareFor, TrendRow } from './signals.service';
import { brandAliases, isBrandEntity } from './pillars.service';

const NOW = Date.parse('2026-10-21T08:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000);
const trend = (title: string, score: number | null, ageH: number, source = 'web_search'): TrendRow => ({ title, score, fetchedAt: hoursAgo(ageH), source });

describe('trend matching', () => {
  const c = { entity: 'diddy', keywords: ['diddy', 'transfer', 'fort dix', 'prison'] };

  it('matches a fresh, high-opportunity trend about the same person', () => {
    const m = matchTrend(c, [trend('Diddy moved to a new prison: what changes', 60, 4)], NOW);
    expect(m.match).toBeGreaterThan(0.6);
    expect(m.title).toContain('Diddy');
  });

  it('a stale scan (over 30 h) counts for nothing', () => {
    expect(matchTrend(c, [trend('Diddy moved to a new prison', 80, 40)], NOW).match).toBe(0);
  });

  it('fresher beats older at the same score, and an unrelated trend does not match', () => {
    const fresh = matchTrend(c, [trend('Diddy transfer news', 50, 2)], NOW).match;
    const older = matchTrend(c, [trend('Diddy transfer news', 50, 26)], NOW).match;
    expect(fresh).toBeGreaterThan(older);
    expect(matchTrend(c, [trend('WSJ: Paxton donor federal indictment', 56, 1)], NOW).match).toBe(0);
  });

  it('a quick ("lite") scan counts for less than the full web-search scan at the same score and age', () => {
    const full = matchTrend(c, [trend('Diddy transfer news', 50, 2, 'web_search')], NOW).match;
    const lite = matchTrend(c, [trend('Diddy transfer news', 50, 2, 'lite')], NOW).match;
    expect(lite).toBeLessThan(full);
    expect(lite).toBeGreaterThan(0.5 * full);
  });

  it('decodes html entities in titles (the scan stores &#39;)', () => {
    expect(matchTrend({ entity: 'drilla', keywords: ['drilla'] }, [trend('Drilla&#39;s Probation Woes', 13, 3)], NOW).match).toBeGreaterThan(0);
  });
});

describe('own-channel velocity share', () => {
  const snap = {
    views3d: 1000,
    byEntity: [{ key: 'diddy', views3d: 800, share3d: 0.8 }],
    byPillar: [{ key: 'solitary', views3d: 50, share3d: 0.05 }, { key: 'intake', views3d: 420, share3d: 0.42 }],
    videos: [
      { title: 'Diddy: The Prison Move Nobody Explained', views3d: 800 },
      { title: 'Pooh Shiesty LIVE lockdown update', views3d: 46 },
      { title: 'Solitary confinement and the mind', views3d: 50 },
    ],
  };
  const c = (o: any) => ({ entity: null, pillar: null, keywords: [], ...o });

  it('uses the tracked person first', () => {
    expect(velocityShareFor(c({ entity: 'diddy', pillar: 'solitary' }), snap)).toBe(0.8);
  });

  it('a person who is NOT on the channel traffic is not carried by the traffic of their pillar (the Pras Michel case)', () => {
    expect(velocityShareFor(c({ entity: 'pras michel', pillar: 'intake', keywords: ['pras'] }), snap)).toBe(0);
  });

  it('finds traffic for a person nobody tracked, from the video titles', () => {
    expect(velocityShareFor(c({ entity: 'pooh shiesty' }), snap)).toBeCloseTo(0.046, 3);
  });

  it('a general lesson needs two keywords in the titles, or gets half of its pillar', () => {
    expect(velocityShareFor(c({ keywords: ['solitary', 'confinement', 'isolation'] }), snap)).toBeCloseTo(0.05, 3);
    expect(velocityShareFor(c({ pillar: 'intake', keywords: ['nothing'] }), snap)).toBeCloseTo(0.21, 3);
    expect(velocityShareFor(c({}), undefined)).toBe(0);
  });
});

describe('channel brand is not an entity', () => {
  it('matches the channel name, handle and spaced variants', () => {
    const brands = brandAliases('Unique Mecca Audio', '@UniqueMeccaAudio');
    expect(isBrandEntity('Unique Mecca Audio', brands)).toBe(true);
    expect(isBrandEntity('uniquemeccaaudio', brands)).toBe(true);
    expect(isBrandEntity('Diddy', brands)).toBe(false);
  });
});
