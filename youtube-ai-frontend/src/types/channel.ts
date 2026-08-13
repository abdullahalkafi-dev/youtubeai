export interface ChannelSeoSettings {
  dailyUpdateCap: number
  cronInterval: number
  autoPauseAtLimit: boolean
  autoResumeAtMidnight: boolean
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
  createdAt: string
  updatedAt: string
}
