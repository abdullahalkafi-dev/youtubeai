import { shouldFetchTranscript } from './transcript-policy';
import {
  DEFAULT_DAILY_BATCH_SIZE,
  DEFAULT_COMMENT_DAILY_CAP,
  COMMENTS_DAILY_QUOTA_BUDGET,
  QUOTA_COST_COMMENT_INSERT,
} from '../automation/automation.constants';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-10-19T12:00:00Z');
const ago = (days: number) => new Date(now - days * DAY);

describe('batch SEO transcript policy', () => {
  it('skips fetching for old videos in a batch', () => {
    expect(shouldFetchTranscript({ source: 'auto_cron_batch', publishedAt: ago(400), now })).toBe(false);
    expect(shouldFetchTranscript({ source: 'manual_ui_batch', publishedAt: ago(16), now })).toBe(false);
  });
  it('fetches for videos published within 15 days', () => {
    expect(shouldFetchTranscript({ source: 'auto_cron_batch', publishedAt: ago(10), now })).toBe(true);
    expect(shouldFetchTranscript({ source: 'auto_cron_batch', publishedAt: ago(15), now })).toBe(true);
  });
  it('still fetches for a single dashboard video and for an unknown date', () => {
    expect(shouldFetchTranscript({ source: 'dashboard_single_video', publishedAt: ago(900), now })).toBe(true);
    expect(shouldFetchTranscript({ source: undefined, publishedAt: ago(900), now })).toBe(true);
    expect(shouldFetchTranscript({ source: 'auto_cron_batch', publishedAt: null, now })).toBe(true);
  });
});

describe('daily budgets', () => {
  it('runs 5 SEO videos a day', () => expect(DEFAULT_DAILY_BATCH_SIZE).toBe(5));
  it('gives comments 7,000 units and a reply cap the budget can pay for', () => {
    expect(COMMENTS_DAILY_QUOTA_BUDGET).toBe(7000);
    expect(DEFAULT_COMMENT_DAILY_CAP).toBe(130);
    // replies plus about 500 units of listing must fit inside the budget
    expect(DEFAULT_COMMENT_DAILY_CAP * QUOTA_COST_COMMENT_INSERT + 500).toBeLessThanOrEqual(COMMENTS_DAILY_QUOTA_BUDGET);
  });
});
