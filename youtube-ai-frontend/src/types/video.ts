export type SeoStatus = 'optimized' | 'pending' | 'processing' | 'not_started' | 'approved'
export type VideoStatus = 'published' | 'draft' | 'scheduled'
export type ShowType = 'first_night_inside' | 'federal_pressure' | 'street_code_autopsy' | 'courtroom_reality' | 'mothers_sentenced' | 'prison_psychology' | 'smart_man_trap'

export interface SeoData {
  title: string
  description: string
  tags: string[]
  hashtags: string[]
}

export interface VideoVersion {
  id: string
  videoId: string
  createdAt: string
  type: 'original' | 'ai_optimized' | 'rolled_back'
  approved: boolean
  seo: SeoData
  note: string | null
}

export interface Video {
  id: string
  channelId: string
  youtubeId: string
  title: string
  description: string | null
  thumbnailUrl: string | null
  publishedAt: string | null
  videoUrl: string | null
  definition: string | null
  caption: boolean | null
  categoryId: string | null
  favoriteCount: number | null
  duration: string | null
  durationSeconds: number | null
  viewCount: number
  likeCount: number
  commentCount: number
  ctr: number | null
  avgWatchTime: number | null
  retentionPercent: number | null
  estimatedRevenue: number
  tags: string[]
  seoStatus: SeoStatus
  currentSeo: SeoData | null
  suggestedSeo: SeoData | null
  aiScore: number | null
  showType: ShowType | null
  versions?: VideoVersion[]
  status: VideoStatus
  // YouTube status
  privacyStatus: string | null
  embeddable: boolean | null
  publicStatsViewable: boolean | null
  license: string | null
  // Language
  defaultLanguage: string | null
  defaultAudioLanguage: string | null
  // Broadcast
  liveBroadcastContent: string | null
  // Content details
  projection: string | null
  // Analytics
  lastAnalyticsSync: string | null
  impressions: number | null
  // Drift detection — what YouTube last reported
  youtubeTitle: string | null
  youtubeDescription: string | null
  youtubeTags: string[] | null
  // Sync metadata
  lastSyncedAt: string | null
  deletedFromYoutube: boolean
  deletedAt: string | null
}

export interface PaginatedVideos {
  items: Video[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface VideoStats {
  totalVideos: number
  totalViews: number
  totalLikes: number
  totalRevenue: number
  avgCtr: number
  avgWatchTime: number
  avgRetention: number
}
