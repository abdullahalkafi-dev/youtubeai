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

  it('decodes html entities in titles (the scan stores &#39;)', () => {
    expect(matchTrend({ entity: 'drilla', keywords: ['drilla'] }, [trend('Drilla&#39;s Probation Woes', 13, 3)], NOW).match).toBeGreaterThan(0);
  });
});

describe('own-channel velocity share', () => {
  const snap = { byEntity: [{ key: 'diddy', views3d: 800, share3d: 0.8 }], byPillar: [{ key: 'solitary', views3d: 50, share3d: 0.05 }] };
  it('uses the person when known, then the pillar, else 0', () => {
    expect(velocityShareFor({ entity: 'diddy', pillar: 'solitary' }, snap)).toBe(0.8);
    expect(velocityShareFor({ entity: null, pillar: 'solitary' }, snap)).toBe(0.05);
    expect(velocityShareFor({ entity: 'nobody', pillar: 'unknown' }, snap)).toBe(0);
    expect(velocityShareFor({ entity: 'diddy', pillar: null }, undefined)).toBe(0);
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
