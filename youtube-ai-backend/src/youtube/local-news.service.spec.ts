import { LocalNewsService } from './local-news.service';
import type { YouTubeService } from './youtube.service';
import type { QuotaService } from '../quota/quota.service';

describe('LocalNewsService.resolveMarket', () => {
  let svc: LocalNewsService;

  beforeAll(() => {
    svc = new LocalNewsService(
      null as unknown as YouTubeService,
      null as unknown as QuotaService,
    );
  });

  const resolve = (text: string) =>
    svc.resolveMarket(undefined, text)?.label ?? null;

  it('resolves Fort Walton Beach / NW Florida stories to the panhandle market', () => {
    expect(
      resolve(
        'Aubrey Darnell Joseph Sr. of Fort Walton Beach, Florida fentanyl plea',
      ),
    ).toBe('Pensacola / Panama City, FL');
    expect(resolve('okaloosa county fentanyl raid')).toBe(
      'Pensacola / Panama City, FL',
    );
    expect(resolve('fort walton beach man pleads guilty')).toBe(
      'Pensacola / Panama City, FL',
    );
    expect(resolve('pensacola traffic stop')).toBe(
      'Pensacola / Panama City, FL',
    );
  });

  it('resolves generic "florida" (no city) to the panhandle fallback, not Miami', () => {
    expect(
      resolve(
        'can you find some local news on this\nFlorida man fentanyl plea',
      ),
    ).toBe('Pensacola / Panama City, FL');
    expect(resolve('somewhere in florida, unknown city')).toBe(
      'Pensacola / Panama City, FL',
    );
  });

  it('city keys beat state-level catch-all keys', () => {
    expect(resolve('Miami, Florida drug bust')).toBe('Miami, FL');
    expect(resolve('Dallas, Texas shooting')).toBe('Dallas, TX');
    expect(resolve('Houston man charged')).toBe('Houston, TX');
  });

  it('resolves other markets by city/county', () => {
    expect(
      resolve('Lil Durk acquitted at Los Angeles federal courthouse'),
    ).toBe('Los Angeles, CA');
    expect(resolve('Brooklyn MDC lockdown')).toBe('New York, NY');
    expect(resolve('atlanta rapper indictment')).toBe('Atlanta, GA');
    expect(resolve('chicago drill rap case')).toBe('Chicago, IL');
  });

  it('returns null when no market key matches', () => {
    expect(resolve('no location at all in this story')).toBeNull();
    expect(svc.resolveMarket(undefined, '')).toBeNull();
  });
});

describe('LocalNewsService.isFootageRequest', () => {
  let svc: LocalNewsService;

  beforeAll(() => {
    svc = new LocalNewsService(
      null as unknown as YouTubeService,
      null as unknown as QuotaService,
    );
  });

  it('detects footage / local-news phrasing that must trigger web research', () => {
    expect(svc.isFootageRequest('can you find some local news on this')).toBe(
      true,
    );
    expect(svc.isFootageRequest('give me b-roll for the script')).toBe(true);
    expect(svc.isFootageRequest('collect footage of the courthouse')).toBe(
      true,
    );
    expect(svc.isFootageRequest('what should I post next?')).toBe(false);
  });
});
