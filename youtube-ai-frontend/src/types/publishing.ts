/** Manual publishing (YouTube first, other platforms later) and per-post analytics. */

export type PlatformId = 'youtube' | 'x' | 'linkedin' | 'instagram' | 'facebook'
export type PostStatus = 'queued' | 'uploading' | 'processing' | 'scheduled' | 'published' | 'failed' | 'cancelled' | 'blocked' | 'removed'
export type Privacy = 'private' | 'unlisted' | 'public'

export interface PostSummary {
  platform: PlatformId
  status: PostStatus
  url: string | null
  views: number | null
}

export interface PostMetadata {
  title: string
  description: string
  tags: string[]
  hashtags: string[]
  categoryId: string
  privacy: Privacy
  scheduleAt?: string | null
  madeForKids: boolean
  containsSyntheticMedia: boolean
  notifySubscribers: boolean
}

export interface PublishIssue {
  level: 'error' | 'warning' | 'info'
  code: string
  message: string
}

export interface AccountInfo {
  platform: PlatformId
  state: 'ok' | 'needs_reconnect' | 'missing'
  externalId?: string
  displayName?: string
  handle?: string
  message?: string
  quota?: { usedToday: number; dailyCap: number }
  capabilities: { label: string; maxDurationSec: number; visibilities: Privacy[]; supportsSchedule: boolean }
}

export interface AccountsResponse {
  publishMode: 'manual'
  defaultPrivacy: Privacy
  accounts: AccountInfo[]
  planned: PlatformId[]
}

export interface PreflightResponse {
  defaults: PostMetadata
  metadata: PostMetadata
  account: AccountInfo
  issues: PublishIssue[]
  canPublish: boolean
}

export interface PostMetrics {
  views: number
  likes?: number
  comments?: number
  shares?: number
  watchMinutes?: number
  avgViewPct?: number
  subscribersGained?: number
  provisional?: boolean
  capturedAt: string
}

export interface ReelPost {
  id: string
  reelId: string
  campaignId: string
  platform: PlatformId
  source: 'api' | 'manual'
  status: PostStatus
  accountName: string | null
  title: string
  privacy: Privacy | null
  scheduleAt: string | null
  requestedPrivacy: Privacy | null
  actualPrivacy: Privacy | null
  url: string | null
  externalId: string | null
  publishedAt: string | null
  progress: number
  warnings: string[]
  error: string | null
  errorCode: string | null
  blockedUntil: string | null
  latestMetrics: PostMetrics | null
  createdAt: string
}

export interface AnalyticsOverview {
  period: string
  posts: number
  views: number
  likes: number
  comments: number
  watchMinutes: number
  avgViewsPerPost: number
  byPlatform: Array<{ platform: PlatformId; posts: number; views: number }>
  statuses: Partial<Record<PostStatus, number>>
  top: Array<{ postId: string; reelId: string; platform: PlatformId; url: string | null; title: string; views: number; publishedAt: string }>
}

export type BreakdownBy = 'platform' | 'shape' | 'theme' | 'entity' | 'duration' | 'weekday' | 'campaign'

export interface BreakdownRow {
  key: string
  posts: number
  views: number
  avgViews: number
  likes: number
  comments: number
  watchMinutes: number
  avgViewPct: number | null
}

export interface SeriesPoint {
  capturedAt: string
  ageHours: number
  checkpoint: string
  views: number
  likes: number | null
  comments: number | null
  watchMinutes: number | null
  avgViewPct: number | null
  subscribersGained: number | null
  provisional: boolean
}

export interface CampaignPerformance {
  campaignId: string
  name: string
  totals: { views: number; likes: number; comments: number; posts: number; reelsPublished: number; reelsReady: number; pending: number }
  avgViewsPerPost: number
  byPlatform: Array<{ platform: PlatformId; posts: number; views: number; likes: number; comments: number }>
  reels: Array<{ reelId: string; title: string; views: number; likes: number; comments: number; platforms: Array<{ platform: PlatformId; views: number; url: string | null }> }>
  comparison: {
    verdict: 'better' | 'similar' | 'worse' | 'not_enough_data'
    basis: 'first_day' | 'lifetime' | null
    campaignAvg: number
    channelAvg: number | null
    otherCampaigns: number
  }
  lastUpdated: string | null
}

export interface CampaignChatMessage {
  role: 'user' | 'assistant'
  content: string
  at?: string
}

export interface DailyDay {
  date: string
  status: 'running' | 'started' | 'skipped' | 'failed'
  reason: string | null
  topic: { name: string; brief: string; why: string; signal: 'trend' | 'performance' | 'archive'; keywords: string[] } | null
  evidence: { moments: number; videos: number } | null
  campaignId: string | null
  campaignStatus: string | null
  progress: string | null
  reelsReady: number
  reelsPosted: number
  views: number
  posts: number
  verdict: 'better' | 'similar' | 'worse' | null
}

export interface DailyOverview {
  enabled: boolean
  nextRunAt: string
  timezone: string
  today: string
  avgViewsPerPost: number
  bySignal: Array<{ signal: 'trend' | 'performance' | 'archive'; days: number; views: number; avgPerPost: number }>
  days: DailyDay[]
}
