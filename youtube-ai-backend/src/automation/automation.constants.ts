/**
 * Centralized Automation Constants & Configurable Defaults
 */

export const DEFAULT_DAILY_BATCH_SIZE = parseInt(
  process.env.AUTOMATION_DAILY_BATCH_SIZE || '5',
  10,
);

export const YOUTUBE_QUOTA_COST_PER_VIDEO = 51; // 1 unit videos.list + 50 units videos.update
export const YOUTUBE_HARD_CAP_CEILING = 9000; // 90% of 10,000 daily quota
export const PUSH_SAFETY_GAP_MS = 5000; // 5-second burst smoothing gap
export const MAX_PUSH_ATTEMPTS = 4; // 1 initial attempt + 3 retries
export const STALE_LOCK_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours fallback
export const HEARTBEAT_STALE_MS = 15 * 60 * 1000; // 15 minutes without heartbeat

// Comment Auto-Reply Constants
export const DEFAULT_COMMENT_DAILY_CAP = parseInt(
  process.env.COMMENT_DAILY_CAP || '130',
  10,
);
/** Long videos in the auto-reply list (Shorts have their own list, see comment-lanes.ts). */
export const MAX_ACTIVE_COMMENT_VIDEOS = 10;
/** Shorts (reels) in the auto-reply list: separate from the long videos, so they never take a long video's slot. */
export const MAX_ACTIVE_SHORT_COMMENT_VIDEOS = 10;
/** Replies/day lane B (other long videos + Shorts) may use; the rest of the daily cap is kept for the 3 newest long videos. */
export const COMMENT_OTHER_LANE_DAILY_CAP = parseInt(
  process.env.COMMENT_OTHER_LANE_DAILY_CAP || '100',
  10,
);
export const COMMENT_CHUNK_SIZE = 10;
export const COMMENT_PUSH_SAFETY_GAP_MS = 3000; // 3-second pacing between comment replies
export const QUOTA_COST_COMMENT_INSERT = 50;
/** Hard sub-budget for all comment list+insert units/day (protects SEO/trends inside the 10k). */
export const COMMENTS_DAILY_QUOTA_BUDGET = parseInt(
  process.env.COMMENTS_DAILY_QUOTA_BUDGET || '7000',
  10,
);

/**
 * Batch SEO only fetches a missing transcript for videos published within this many days.
 * Older videos are optimized from title/description/performance (saves quota and credits).
 */
export const SEO_TRANSCRIPT_MAX_AGE_DAYS = parseInt(
  process.env.SEO_TRANSCRIPT_MAX_AGE_DAYS || '15',
  10,
);
