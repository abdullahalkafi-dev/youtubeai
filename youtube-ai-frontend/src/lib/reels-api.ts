import { ApiError, getApiBaseUrl } from '@/lib/api'
import type {
  CampaignDetail,
  CampaignSummary,
  Coverage,
  CreateCampaignInput,
  Insights,
  Reel,
  ReelServiceStatus,
  ReelStatus,
} from '@/types/reel'

/**
 * Client for the isolated reel service (served under /api/reels by its own container).
 * Kept separate from the main ApiClient so reel changes never touch the rest of the app.
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
  const res = await fetch(`${getApiBaseUrl()}/api/reels${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers as Record<string, string>),
    },
    signal: init.signal || AbortSignal.timeout(120000),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({ message: res.statusText }))
    const message = Array.isArray(data.message) ? data.message.join(', ') : data.message || `Reel service error ${res.status}`
    throw new ApiError(message, res.status, data)
  }
  return res.json()
}

export function reelMediaUrl(path: string | undefined | null): string {
  if (!path) return ''
  return `${getApiBaseUrl()}${path}`
}

export const reelsApi = {
  status: () => request<ReelServiceStatus>('/status'),
  uploadCookies: (cookies: string) =>
    request<{ ok: boolean; reason?: string }>('/youtube-session/cookies', { method: 'POST', body: JSON.stringify({ cookies }) }),
  checkSession: () => request<{ status: string; lastError: string | null }>('/youtube-session/check', { method: 'POST' }),

  createCampaign: (channelId: string, input: CreateCampaignInput) =>
    request<CampaignSummary>(`/channels/${channelId}/campaigns`, { method: 'POST', body: JSON.stringify(input) }),
  listCampaigns: (channelId: string) => request<CampaignSummary[]>(`/channels/${channelId}/campaigns`),
  getCampaign: (channelId: string, id: string) => request<CampaignDetail>(`/channels/${channelId}/campaigns/${id}`),
  cancelCampaign: (channelId: string, id: string) => request<{ ok: boolean }>(`/channels/${channelId}/campaigns/${id}/cancel`, { method: 'POST' }),
  topUp: (channelId: string, id: string, count?: number) =>
    request<{ ok: boolean; adding: number }>(`/channels/${channelId}/campaigns/${id}/top-up`, { method: 'POST', body: JSON.stringify({ count }) }),
  retryFailed: (channelId: string, id: string) =>
    request<{ retried: number }>(`/channels/${channelId}/campaigns/${id}/retry-failed`, { method: 'POST' }),

  listReels: (channelId: string, params: { status?: ReelStatus; campaignId?: string; entity?: string; period?: '7d' | '30d' | 'all'; limit?: number; skip?: number } = {}) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v))
    return request<{ total: number; items: Reel[] }>(`/channels/${channelId}/reels?${q.toString()}`)
  },
  getReel: (channelId: string, id: string) => request<Reel>(`/channels/${channelId}/reels/${id}`),
  updateReel: (
    channelId: string,
    id: string,
    body: {
      status?: 'todo' | 'posted' | 'rejected'
      postedUrl?: string | null
      rejectReason?: string
      rejectKind?: 'bad_moment' | 'other'
      packaging?: Partial<Pick<NonNullable<Reel['packaging']>, 'headline' | 'title' | 'description' | 'tags' | 'hashtags' | 'pinnedComment'>>
    },
  ) => request<Reel>(`/channels/${channelId}/reels/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  rerender: (channelId: string, id: string) => request<{ ok: boolean }>(`/channels/${channelId}/reels/${id}/rerender`, { method: 'POST' }),

  coverage: (channelId: string) => request<Coverage>(`/channels/${channelId}/coverage`),
  insights: (channelId: string, period: 'week' | 'month') => request<Insights>(`/channels/${channelId}/insights?period=${period}`),
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const ACTIVE_CAMPAIGN_STATUSES = ['queued', 'researching', 'sourcing', 'preparing', 'composing', 'rendering'] as const
