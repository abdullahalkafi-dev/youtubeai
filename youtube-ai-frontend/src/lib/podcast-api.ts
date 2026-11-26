import { ApiError, getApiBaseUrl } from '@/lib/api'

/** Client for the isolated podcast service (served under /api/podcast by its own container), kept apart from the main ApiClient. */

export interface PodcastStatus {
  enabled: boolean
  auto: boolean
  autoSince: string | null
  minDurationSec: number
  show: { title: string; rssUrl: string | null; artworkUrl: string | null } | null
  counts: { queued: number; processing: number; uploaded: number; failed: number; skipped: number }
  latest: { title: string; pageUrl: string | null; publishedAt: string | null } | null
}

export interface PodcastEpisodeRow {
  youtubeId: string
  title: string
  status: 'queued' | 'processing' | 'uploaded' | 'failed' | 'skipped'
  stage?: string
  origin: string
  videoPublishedAt?: string
  videoViews?: number
  finishedAt?: string
  audio?: { source: 'cache' | 'download'; bytes: number; originalSec: number; durationSec: number; removedSec: number; trimSkipped?: string }
  meta?: { title: string; tags: string; chapters: Array<{ startSec: number; title: string }> }
  buzzsprout?: { episodeId?: number; published?: boolean; publishedAt?: string; pageUrl?: string }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
  const res = await fetch(`${getApiBaseUrl()}/api/podcast${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers as Record<string, string>),
    },
    signal: init.signal || AbortSignal.timeout(60000),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({ message: res.statusText }))
    const message = Array.isArray(data.message) ? data.message.join(', ') : data.message || `Podcast service error ${res.status}`
    throw new ApiError(message, res.status, data)
  }
  return res.json()
}

/** Accepts a full YouTube link (watch, youtu.be, shorts, embed) or the bare 11-character id. */
export function youtubeIdFrom(input: string): string | null {
  const s = input.trim()
  if (/^[\w-]{11}$/.test(s)) return s
  const m = /(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([\w-]{11})/.exec(s)
  return m ? m[1] : null
}

export const podcastApi = {
  status: (channelId: string) => request<PodcastStatus>(`/channels/${channelId}/status`),
  episodes: (channelId: string, limit = 50) => request<{ episodes: PodcastEpisodeRow[] }>(`/channels/${channelId}/episodes?limit=${limit}`),
  add: (channelId: string, youtubeId: string) => request<PodcastEpisodeRow>(`/channels/${channelId}/episodes`, { method: 'POST', body: JSON.stringify({ youtubeId }) }),
}
