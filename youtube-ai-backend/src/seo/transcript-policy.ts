import { SEO_TRANSCRIPT_MAX_AGE_DAYS } from '../automation/automation.constants';

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SOURCES = ['batch', 'auto_cron_batch', 'manual_ui_batch'];

/**
 * Whether SEO generation may FETCH a transcript that is not stored yet (free scrapers and the
 * paid captions API alike). A stored transcript is always used; this only decides about fetching.
 *
 * - A single video requested from the dashboard always fetches.
 * - A batch only fetches for videos published within SEO_TRANSCRIPT_MAX_AGE_DAYS; older videos are
 *   optimized from title, description and performance data, which saves quota and credits.
 * - Unknown publish date: fetch (as before).
 */
export function shouldFetchTranscript(input: {
  source?: string;
  publishedAt?: Date | string | null;
  now?: number;
  maxAgeDays?: number;
}): boolean {
  if (!input.source || !BATCH_SOURCES.includes(input.source)) return true;
  if (!input.publishedAt) return true;
  const published = new Date(input.publishedAt).getTime();
  if (!Number.isFinite(published)) return true;
  const ageMs = (input.now ?? Date.now()) - published;
  return ageMs <= (input.maxAgeDays ?? SEO_TRANSCRIPT_MAX_AGE_DAYS) * DAY_MS;
}
