import { ShowType } from './video'

export interface TrendingIdea {
  id: string
  title: string
  showType: ShowType
  score: number
  status: 'greenlight' | 'hold' | 'pass'
  searchDemand: 'high' | 'medium' | 'low'
  emotionalPressure: 'high' | 'medium' | 'low'
  authorityFit: 'perfect' | 'strong' | 'moderate' | 'weak'
  description: string
  createdAt: string
}

export interface SeoSuggestion {
  id: string
  videoId: string
  channelId: string
  title: string
  description: string
  tags: string[]
  hashtags: string[]
  showType: ShowType | null
  tone: string | null
  createdAt: string
  status: 'pending' | 'approving' | 'approved' | 'rejected' | 'superseded'
  video?: { id: string; title: string; thumbnailUrl: string | null }
}
