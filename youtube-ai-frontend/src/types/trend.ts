export interface TrendingTopic {
  id: string
  title: string
  summary: string
  source: string | null
  publishedAt: string | null
  fetchedAt: string
  // YouTube video match (null = news-only, no YouTuber covered it yet)
  youtubeVideoId: string | null
  youtubeThumbnailUrl: string | null
  youtubeChannelTitle: string | null
  youtubeVideoUrl: string | null
  // Quality logging — the entity used for YouTube search
  extractedEntity: string | null
  // Opportunity scoring
  opportunityScore: number
  opportunityLabel: string | null
  badge?: 'viral' | 'gap' | 'breaking'
}
