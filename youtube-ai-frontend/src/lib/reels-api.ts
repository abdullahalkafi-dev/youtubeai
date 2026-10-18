import { ApiError, getApiBaseUrl } from '@/lib/api'
import type {
  AccountsResponse,
  AnalyticsOverview,
  BreakdownBy,
  BreakdownRow,
  CampaignChatMessage,
  CampaignPerformance,
  PlatformId,
  PostMetadata,
  PostStatus,
  PreflightResponse,
  ReelPost,
  SeriesPoint,
} from '@/types/publishing'
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
  changeVisual: (channelId: string, reelId: string, visualId: string, action: 'replace' | 'remove') =>
    request<{ ok: boolean }>(`/channels/${channelId}/reels/${reelId}/visuals/${visualId}/${action}`, { method: 'POST' }),

  // ---- campaign performance & assistant ----
  campaignPerformance: (channelId: string, campaignId: string) =>
    request<CampaignPerformance>(`/channels/${channelId}/campaigns/${campaignId}/performance`),
  campaignChat: (channelId: string, campaignId: string) =>
    request<{ messages: CampaignChatMessage[] }>(`/channels/${channelId}/campaigns/${campaignId}/chat`),
  askCampaign: (channelId: string, campaignId: string, question: string) =>
    request<{ answer: string }>(`/channels/${channelId}/campaigns/${campaignId}/chat`, { method: 'POST', body: JSON.stringify({ question }) }),
  clearCampaignChat: (channelId: string, campaignId: string) =>
    request<{ ok: boolean }>(`/channels/${channelId}/campaigns/${campaignId}/chat`, { method: 'DELETE' }),

  // ---- publishing (manual) ----
  accounts: (channelId: string) => request<AccountsResponse>(`/channels/${channelId}/accounts`),
  preflight: (channelId: string, reelId: string, body: { platform?: PlatformId; metadata?: Partial<PostMetadata> }) =>
    request<PreflightResponse>(`/channels/${channelId}/reels/${reelId}/preflight`, { method: 'POST', body: JSON.stringify(body) }),
  publish: (channelId: string, reelId: string, body: { platform?: PlatformId; metadata?: Partial<PostMetadata>; confirm: true }) =>
    request<ReelPost>(`/channels/${channelId}/reels/${reelId}/posts`, { method: 'POST', body: JSON.stringify(body) }),
  addManualPost: (channelId: string, reelId: string, body: { platform: PlatformId; url: string; postedAt?: string }) =>
    request<ReelPost>(`/channels/${channelId}/reels/${reelId}/posts/manual`, { method: 'POST', body: JSON.stringify(body) }),
  reelPosts: (channelId: string, reelId: string) => request<ReelPost[]>(`/channels/${channelId}/reels/${reelId}/posts`),
  cancelPost: (channelId: string, postId: string) => request<{ ok: boolean }>(`/channels/${channelId}/posts/${postId}/cancel`, { method: 'POST' }),
  retryPost: (channelId: string, postId: string) => request<{ ok: boolean }>(`/channels/${channelId}/posts/${postId}/retry`, { method: 'POST' }),
  refreshPostMetrics: (channelId: string, postId: string) =>
    request<{ ok: boolean; message: string }>(`/channels/${channelId}/posts/${postId}/refresh-metrics`, { method: 'POST' }),
  analyticsOverview: (channelId: string, period: string) => request<AnalyticsOverview>(`/channels/${channelId}/analytics/overview?period=${period}`),
  analyticsBreakdown: (channelId: string, by: BreakdownBy, period: string) =>
    request<{ by: BreakdownBy; period: string; rows: BreakdownRow[] }>(`/channels/${channelId}/analytics/breakdown?by=${by}&period=${period}`),
  postSeries: (channelId: string, postId: string) => request<SeriesPoint[]>(`/channels/${channelId}/analytics/posts/${postId}/series`),
  listPosts: (channelId: string, params: { platform?: PlatformId; status?: PostStatus; period?: string; limit?: number } = {}) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v))
    return request<{ total: number; items: ReelPost[] }>(`/channels/${channelId}/posts?${q.toString()}`)
  },

  coverage: (channelId: string) => request<Coverage>(`/channels/${channelId}/coverage`),
  insights: (channelId: string, period: 'week' | 'month') => request<Insights>(`/channels/${channelId}/insights?period=${period}`),
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const ACTIVE_CAMPAIGN_STATUSES = ['queued', 'researching', 'sourcing', 'preparing', 'composing', 'rendering'] as const
