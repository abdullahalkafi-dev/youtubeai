import type { PostSummary } from './publishing'

export type CampaignStatus =
  | 'queued'
  | 'researching'
  | 'sourcing'
  | 'preparing'
  | 'composing'
  | 'rendering'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled'

export type ReelStatus = 'queued' | 'rendering' | 'todo' | 'posted' | 'rejected' | 'failed'
export type ReelShape = 'single_take' | 'cold_open' | 'condensed' | 'cross_video'
export type ClipRole = 'hook' | 'setup' | 'build' | 'payoff' | 'close'

export interface CampaignSettings {
  targetReels: number
  minSec: number
  maxSec: number
  allowCrossVideo: boolean
  templateName: string
  seedVideoIds: string[]
}

export interface CampaignUsage {
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
  sttSeconds: number
  embedTokens: number
  calls: number
  /** Estimated model cost in US dollars. */
  costUsd?: number
}

export interface CampaignSummary {
  id: string
  /** manual: from a topic; video: from an uploaded video; daily: the nightly automatic campaign. */
  origin?: 'manual' | 'video' | 'daily'
  dailyDate?: string | null
  name: string
  brief: string
  status: CampaignStatus
  progress: { stage: string; message: string }
  blockedReason: string | null
  settings: CampaignSettings
  stats: {
    candidates: number
    kept: number
    dropped: number
    rendered: number
    failed: number
    rounds?: number
    momentsShown?: number
    momentsAvailable?: number
  }
  usage: CampaignUsage
  sourceCount: number
  reelCounts: Partial<Record<ReelStatus, number>>
  /** Published views so far (list endpoint only). */
  performance?: { views: number; posts: number }
  error: string | null
  createdAt: string
  finishedAt: string | null
}

export interface CampaignSource {
  youtubeId: string
  videoId: string
  title: string
  viewCount: number
  durationSec: number
  publishedAt?: string
  reason: string
  fromBank: boolean
  status: 'pending' | 'ready' | 'failed'
  error?: string
  stage: string
  stageError: string | null
  height: number | null
  momentCount: number
}

export interface CandidateLedgerEntry {
  round: number
  ref: string
  concept: string
  shape: ReelShape
  videos: string[]
  durationSec: number
  overall: number | null
  verdict: string | null
  issues: string[]
  revised: boolean
  outcome: 'kept' | 'spare' | 'dropped'
  reason: string
}

export interface CampaignDetail extends CampaignSummary {
  research: {
    topicSummary: string
    angles: Array<{ angle: string; whyItWorks: string }>
    hookPatterns: string[]
    externalExamples: Array<{ title: string; platform: string; views: string | null; whatWorked: string }>
    audienceQuestions: string[]
    webSources: Array<{ title: string; url: string }>
  } | null
  sources: CampaignSource[]
  log: Array<{ at: string; level: 'info' | 'warn' | 'error'; msg: string }>
  candidates: CandidateLedgerEntry[]
  reels: Reel[]
  /** A daily campaign's explore part (its reels are in `reels` with track 'explore'). */
  explore?: { campaignId: string; name: string; brief: string; status: string; progress: { stage: string; message: string }; error: string | null; topicSummary: string | null } | null
}

export interface ReelClip {
  youtubeId: string
  sourceTitle: string
  role: ClipRole
  start: number
  end: number
  text: string
  sourceUrl: string
}

export interface ReelScores {
  hook: number
  clarity: number
  flow: number
  payoff: number
  ending: number
  retention: number
  safety: number
  overall: number
}

export interface ReelPackaging {
  headline: string
  title: string
  altTitles: string[]
  description: string
  tags: string[]
  hashtags: string[]
  pinnedComment: string
  summary: string
}

export interface Reel {
  id: string
  campaignId: string
  /** Daily campaigns: which part of the day this reel belongs to. */
  track?: 'main' | 'explore' | 'fresh' | 'best' | 'bank'
  index: number
  status: ReelStatus
  shape: ReelShape
  concept: string
  angle?: string
  hookText: string
  payoffText: string
  whyItWorks?: string
  durationSec: number
  clips: ReelClip[]
  scores?: ReelScores
  critique?: { verdict: string; issues: string[]; revised: boolean }
  packaging?: ReelPackaging
  entityNames: string[]
  themes: string[]
  qa?: { loudnessLufs?: number; width?: number; height?: number; warnings: string[] }
  error: string | null
  postedAt: string | null
  postedUrl: string | null
  rejectReason: string | null
  createdAt: string
  media: { video: string; cover: string; download: string; srt: string } | null
  needsRerender?: boolean
  posts?: PostSummary[]
  /** 9:16 thumbnail variants; `chosen` is the one sent to YouTube. */
  thumbnails?: Array<{ id: string; headline: string; chosen: boolean; source: string; url: string }>
}

export interface ReelServiceStatus {
  enabled: boolean
  youtube: {
    status: 'ok' | 'needs_login' | 'missing'
    updatedAt: string | null
    lastCheckAt: string | null
    lastOkAt: string | null
    lastError: string | null
    downloadsPaused: boolean
  }
  queues: Record<string, { waiting: number; active: number; failed: number; paused: boolean }>
}

export interface CoverageRow {
  slug: string
  name: string
  total: number
  todo: number
  posted: number
  rejected: number
  last: string | null
  untappedStrongMoments: number
}

export interface Coverage {
  momentBank: { unused: number; used: number; retired: number }
  entities: CoverageRow[]
}

export interface Insights {
  period: 'week' | 'month'
  since: string
  reelsByStatus: Partial<Record<ReelStatus, number>>
  reelsCreated: number
  reelsPosted: number
  perDay: Array<{ date: string; reels: number }>
  campaignsByStatus: Partial<Record<CampaignStatus, number>>
  usage: { promptTokens: number; completionTokens: number; transcribedMinutes: number }
}

export interface CreateCampaignInput {
  brief: string
  name?: string
  targetReels: number
  minSec: number
  maxSec: number
  allowCrossVideo: boolean
  seedVideoIds?: string[]
}
