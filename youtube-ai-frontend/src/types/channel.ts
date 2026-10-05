export interface ChannelSeoSettings {
  dailyUpdateCap: number
  cronInterval: number
  autoPauseAtLimit: boolean
  autoResumeAtMidnight: boolean
}

/** Daily performance sync run report (CTR/impressions/traffic/audience). */
export interface ChannelPerformanceSync {
  lastRunAt?: string
  windowDays?: number
  videosUpdated?: number
  snapshotRows?: number
  filesUsed?: number
  durationMs?: number
  errors?: string[]
  nextRunAt?: string
  source?: string
}

export interface ChannelAudienceProfile {
  ageGroups?: Array<{ label: string; sharePct: number }>
  genderSplit?: Array<{ label: string; sharePct: number }>
  windowDays?: number
  syncedAt?: string
}

export interface Channel {
  id: string
  userId: string
  youtubeChannelId: string
  name: string
  handle: string | null
  avatarUrl: string | null
  description: string | null
  subscriberCount: number
  totalVideos: number
  totalViews: number
  totalWatchHours: number
  estimatedRevenue: number
  joinedDate: string | null
  country: string | null
  seoSettings: ChannelSeoSettings
  performanceSync?: ChannelPerformanceSync
  audienceProfile?: ChannelAudienceProfile
  createdAt: string
  updatedAt: string
}
