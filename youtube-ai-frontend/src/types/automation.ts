export interface AutomationBatchItem {
  videoId: string | { _id?: string; id?: string; title?: string; thumbnailUrl?: string };
  youtubeId: string;
  originalTitle: string;
  originalDescription?: string;
  originalTags?: string[];
  generatedTitle?: string;
  generatedDescription?: string;
  generatedTags?: string[];
  generatedHashtags?: string[];
  status:
    | 'queued'
    | 'generating'
    | 'staged'
    | 'pushing'
    | 'completed'
    | 'skipped_manual_override'
    | 'failed';
  error?: string;
  durationMs?: number;
  batchLockTimestamp?: string;
  processedAt?: string;
}

export interface AutomationBatch {
  id: string;
  _id?: string;
  channelId: string;
  type: 'video_seo' | 'comment_reply';
  source: 'auto_cron_batch' | 'manual_ui_batch';
  parentBatchId?: string;
  isRetried?: boolean;
  retriedByBatchId?: string;
  status:
    | 'pending'
    | 'checking_quota'
    | 'generating'
    | 'staging'
    | 'pushing'
    | 'completed'
    | 'partial'
    | 'failed'
    | 'cancelled';
  totalItems: number;
  successfulItems: number;
  failedItems: number;
  skippedItems: number;
  quotaUnitsUsed: number;
  startedAt: string;
  completedAt?: string;
  lastHeartbeatAt?: string;
  items: AutomationBatchItem[];
  errorMessage?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AutomationStats {
  totalVideos: number;
  optimizedVideos: number;
  pendingVideos: number;
  remainingUnoptimized: number;
  dailyBatchSize: number;
  estimatedDaysRemaining: number;
  nextRunTime: string;
  quotaUsed: number;
  quotaLimit: number;
  quotaSafetyCap: number;
  quotaCostPerBatch: number;
  isBatchRunning: boolean;
  activeBatch: AutomationBatch | null;
  settings: {
    dailyUpdateCap?: number;
    cronInterval?: number;
    autoPauseAtLimit?: boolean;
    autoResumeAtMidnight?: boolean;
  };
}

export interface PaginatedBatches {
  items: AutomationBatch[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
