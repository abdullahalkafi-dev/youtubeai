export type QueueStatus = 'queued' | 'processing' | 'done' | 'failed'

export interface QueueItem {
  id: string
  videoId: string
  videoTitle: string
  status: QueueStatus
  queuedAt: string
  processedAt?: string
  error?: string
}

export interface QueueStats {
  dailyUsed: number
  dailyCap: number
  queued: number
  processing: number
  failed: number
  cronInterval: number
  isActive: boolean
}

export interface QueueState {
  items: QueueItem[]
  stats: QueueStats | null
  loading: boolean
}
