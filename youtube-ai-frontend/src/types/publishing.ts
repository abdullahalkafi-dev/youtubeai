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

export type BreakdownBy = 'platform' | 'shape' | 'theme' | 'entity' | 'duration' | 'weekday' | 'campaign' | 'images' | 'voice' | 'look' | 'slot' | 'pillar' | 'track' | 'signal'

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

export type DailySignalKind = 'trend' | 'performance' | 'archive' | 'explore'
export interface DailyTopic {
  name: string
  brief: string
  why: string
  signal: DailySignalKind
  keywords: string[]
  pillar?: string | null
  entity?: string | null
  score?: number
}
export interface DailyCandidate {
  name: string
  signal: DailySignalKind
  pillar?: string | null
  entity?: string | null
  moments: number
  videos: number
  strongMoments?: number
  trendMatch?: number
  trendTitle?: string | null
  velocityShare?: number
  components?: Record<string, number>
  score: number
  exploreScore?: number
  eligible?: boolean
  reason?: string | null
  picked?: 'main' | 'explore'
  reels?: number
}
export interface DailyDay {
  date: string
  /** The day's campaign was deleted from the app. */
  deleted: boolean
  status: 'running' | 'started' | 'skipped' | 'failed'
  reason: string | null
  topic: DailyTopic | null
  /** The explore part of the day: shown inside the same card, never as a second campaign. */
  exploreTopic: DailyTopic | null
  evidence: { moments: number; videos: number; strongMoments?: number } | null
  candidates: DailyCandidate[]
  degraded: string[]
  /** A paused day still records what the brain would have picked. */
  shadow: { topic: string | null; exploreTopic: string | null; at: string } | null
  /** Topics of this day that failed (not enough usable footage) and were replaced by the next-best one, in the same card. */
  replaced: Array<{ name: string; reason: string }>
  mainReels: number | null
  exploreReels: number | null
  campaignId: string | null
  campaignStatus: string | null
  progress: string | null
  reelsReady: number
  reelsPosted: number
  views: number
  posts: number
  verdict: 'better' | 'similar' | 'worse' | null
}
export interface DailyHealthNote {
  level: 'info' | 'warn' | 'error'
  code: string
  message: string
}
export interface DailyBrain {
  pillars: Array<{ key: string; name: string; daysSinceCovered: number | null; lift: number; posts: number }>
  own: { through: string; views3d: number; byEntity: Array<{ key: string; views3d: number; share3d: number }> } | null
  trends: { count: number; usable: number; freshestAt: string | null; ageHours: number | null; top: Array<{ title: string; score: number | null; ageHours: number; source: string | null }> } | null
  degraded: string[]
  signalDate: string | null
}
export interface DailyPreview {
  main: { name: string; why: string; score: number; reels: number; pillar: string | null; entity: string | null } | null
  explore: { name: string; why: string; score: number; reels: number; pillar: string | null; entity: string | null } | null
  candidates: DailyCandidate[]
  degraded: string[]
}
export interface DailyOverview {
  enabled: boolean
  nextRunAt: string
  timezone: string
  today: string
  avgViewsPerPost: number
  bySignal: Array<{ signal: DailySignalKind; days: number; views: number; avgPerPost: number }>
  health: DailyHealthNote[]
  brain: DailyBrain | null
  review: DailyReview | null
  days: DailyDay[]
}

export interface AutoPublishItem {
  postId: string
  reelId: string
  title: string
  slot: string
  runAt: string
  moved: boolean
  track: 'main' | 'explore'
  score: number | null
  status: 'queued' | 'uploading' | 'processing' | 'scheduled' | 'published' | 'failed' | 'cancelled' | 'blocked' | 'removed'
  url: string | null
  views: number | null
  error: string | null
}
export interface AutoPublishDay {
  date: string
  status: 'planning' | 'planned' | 'skipped'
  reason: string | null
  mode: 'rotation' | 'bandit'
  items: AutoPublishItem[]
  held: Array<{ reelId: string; title: string; reason: string }>
}
export interface AutoPublishSettings {
  enabled: boolean
  privacy: 'public' | 'unlisted'
  slots: string[]
  extraSlots: string[]
  minScore: number
  maxPerDay: number
  pausedReason: string | null
  pausedAt: string | null
}
export interface AutoPublishOverview {
  settings: AutoPublishSettings
  timezone: string
  shortsBaseline: number | null
  slotReport: { ready: boolean; observations: number; slots: Array<{ slot: string; posts: number; score: number }> }
  today: AutoPublishDay | null
  recent: AutoPublishDay[]
  result?: { status: string; reason?: string; planned?: number; held?: number }
}

export interface DailyReview {
  weekOf: string
  posts: number
  enoughData: boolean
  summary: string | null
  findings: Array<{ claim: string; evidence: string; sample: number; confidence: 'low' | 'medium' | 'high'; action: string }>
}
