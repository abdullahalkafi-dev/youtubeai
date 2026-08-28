/**
 * Centralized Automation Constants & Configurable Defaults
 */

export const DEFAULT_DAILY_BATCH_SIZE = parseInt(
  process.env.AUTOMATION_DAILY_BATCH_SIZE || '20',
  10,
);

export const YOUTUBE_QUOTA_COST_PER_VIDEO = 51; // 1 unit videos.list + 50 units videos.update
export const YOUTUBE_HARD_CAP_CEILING = 9000; // 90% of 10,000 daily quota
export const PUSH_SAFETY_GAP_MS = 5000; // 5-second burst smoothing gap
export const MAX_PUSH_ATTEMPTS = 4; // 1 initial attempt + 3 retries
export const STALE_LOCK_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours fallback
export const HEARTBEAT_STALE_MS = 15 * 60 * 1000; // 15 minutes without heartbeat
