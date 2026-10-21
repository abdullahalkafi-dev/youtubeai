export const DAILY_TZ = 'America/New_York';

/** New York calendar date (YYYY-MM-DD) of a moment. */
export function nyDate(d = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: DAILY_TZ });
}
