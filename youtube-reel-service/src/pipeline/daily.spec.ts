import { nextDailyRun, nyDate } from './daily.service';

describe('daily schedule (America/New_York)', () => {
  it('uses the New York calendar date, not UTC', () => {
    expect(nyDate(new Date('2026-10-19T03:30:00Z'))).toBe('2026-10-18'); // 11:30 PM in New York
    expect(nyDate(new Date('2026-10-19T04:30:00Z'))).toBe('2026-10-19'); // 12:30 AM in New York
  });

  it('next run is 4:00 AM New York in summer (EDT, UTC-4)', () => {
    expect(nextDailyRun(new Date('2026-07-10T09:00:00Z')).toISOString()).toBe('2026-07-11T08:00:00.000Z');
    expect(nextDailyRun(new Date('2026-07-10T07:30:00Z')).toISOString()).toBe('2026-07-10T08:00:00.000Z');
  });

  it('next run is 4:00 AM New York in winter (EST, UTC-5)', () => {
    expect(nextDailyRun(new Date('2026-12-01T12:00:00Z')).toISOString()).toBe('2026-12-02T09:00:00.000Z');
  });

  it('handles the daylight-saving switch nights', () => {
    // DST ends Sun 2026-11-01 (2 AM → 1 AM): 4 AM EST = 09:00Z
    expect(nextDailyRun(new Date('2026-11-01T03:00:00Z')).toISOString()).toBe('2026-11-01T09:00:00.000Z');
    // DST starts Sun 2026-03-08 (2 AM → 3 AM): 4 AM EDT = 08:00Z
    expect(nextDailyRun(new Date('2026-03-08T03:00:00Z')).toISOString()).toBe('2026-03-08T08:00:00.000Z');
  });
});
