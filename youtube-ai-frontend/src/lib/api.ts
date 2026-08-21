import type { Video, PaginatedVideos, VideoStats } from '@/types/video'
import type { Channel } from '@/types/channel'
import type { SeoSuggestion } from '@/types/seo'
import type { Thread, ThreadListItem, Message, SendMessageResponse } from '@/types/chat'
import type { QueueItem, QueueStats } from '@/types/queue'
import type { CommentsResponse, Comment, AiReplyOption } from '@/types/comment'
import type { TrendingTopic } from '@/types/trend'
import type { QuotaUsage, QuotaLog } from '@/types/quota'
import type { HttpLogItem, LogStatsResponse, PaginatedLogsResponse, LogQueryParams } from '@/types/dev-log'

export function getApiBaseUrl(): string {
  let url = process.env.NEXT_PUBLIC_API_URL

  if (!url && typeof window !== 'undefined') {
    const { protocol, hostname } = window.location
    if (hostname.includes('devtunnels.ms') && hostname.includes('-3000.')) {
      url = `${protocol}//${hostname.replace('-3000.', '-5001.')}`
    } else if (hostname === 'localhost' || hostname === '127.0.0.1') {
      url = `${protocol}//${hostname}:5001`
    } else {
      url = `${protocol}//${hostname}`
    }
  }

  if (!url) {
    url = 'http://localhost:5001'
  }

  // Strip trailing slashes AND trailing /api so endpoints starting with /api (like '/api/auth/login') don't create double '/api/api/'
  return url.replace(/\/$/, '').replace(/\/api$/, '')
}

export function formatAssetUrl(url: any): string {
  if (!url || typeof url !== 'string') return ''
  const base = getApiBaseUrl()

  // Clean double bucket prefixes if present in legacy URLs (e.g. /thumbnails/thumbnails/...)
  let cleanUrl = url.replace(/\/thumbnails\/thumbnails\//g, '/thumbnails/')

  // Convert direct localhost/minio URLs to backend proxy route
  if (cleanUrl.match(/^https?:\/\/(?:localhost|127\.0\.0\.1|minio)(?::900[0-9])?\/thumbnails\//i)) {
    cleanUrl = cleanUrl.replace(/^https?:\/\/(?:localhost|127\.0\.0\.1|minio)(?::900[0-9])?\/thumbnails\//i, '/api/assets/minio/')
  } else if (cleanUrl.includes(':9000/thumbnails/') || cleanUrl.includes(':9005/thumbnails/')) {
    cleanUrl = cleanUrl.replace(/^https?:\/\/[^/]+:(?:9000|9005)\/thumbnails\//i, '/api/assets/minio/')
  }

  if (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://')) return cleanUrl
  const cleanPath = cleanUrl.startsWith('/') ? cleanUrl : `/${cleanUrl}`
  return `${base}${cleanPath}`.replace('/api/api/', '/api/')
}

let dispatchLogout: (() => void) | null = null
let isLoggingOut = false

export function setLogoutHandler(handler: () => void) {
  dispatchLogout = handler
}

class ApiClient {
  private get baseUrl(): string {
    return getApiBaseUrl()
  }

  private getToken(): string | null {
    if (typeof window === 'undefined') return null
    return localStorage.getItem('auth_token')
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const token = this.getToken()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    }

    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
    const rawUrl = `${this.baseUrl}${cleanEndpoint}`
    const targetUrl = rawUrl.replace('/api/api/', '/api/')

    const response = await fetch(targetUrl, {
      ...options,
      headers,
      signal: options.signal || AbortSignal.timeout(180000),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }))
      // Auto-logout on 401 (but NOT for login endpoint — 401 there means wrong password)
      if (response.status === 401 && typeof window !== 'undefined' && !endpoint.includes('/auth/login')) {
        if (!isLoggingOut) {
          isLoggingOut = true
          localStorage.removeItem('auth_token')
          dispatchLogout?.()
          window.location.href = '/login'
        }
      }
      throw new Error(error.message || `API error: ${response.status}`)
    }

    const data = await response.json()
    return data.data ?? data
  }

  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' })
  }

  async post<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  async patch<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' })
  }

  // Auth
  async login(email: string, password: string) {
    return this.post<{ access_token: string; id: string; email: string; name?: string; avatar?: string }>(
      '/api/auth/login',
      { email, password },
    )
  }

  async register(email: string, password: string, name?: string) {
    return this.post<{ access_token: string; id: string; email: string; name?: string }>(
      '/api/auth/register',
      { email, password, name },
    )
  }

  async getProfile() {
    return this.get<{ id: string; email: string; name?: string; avatar?: string }>('/api/auth/profile')
  }

  // Channel
  async getChannels() {
    return this.get<Channel[]>('/api/channels')
  }

  async getChannel(id: string) {
    return this.get<Channel>(`/api/channels/${id}`)
  }

  async createChannel(data: { name: string; handle?: string }) {
    return this.post<Channel>('/api/channels', data)
  }

  async syncChannel(id: string) {
    return this.post<{ synced: number; new: number; updated: number; deleted: number; drifted: number; errors: string[] }>(
      `/api/channels/${id}/sync`,
    )
  }

  async updateChannelSeoSettings(id: string, data: { dailyUpdateCap?: number; cronInterval?: number; autoPauseAtLimit?: boolean }) {
    return this.patch<Channel>(`/api/channels/${id}/seo-settings`, data)
  }

  async updateChannelApiKeys(id: string, data: { openaiApiKey?: string; youtubeApiKey?: string }) {
    return this.patch<Channel>(`/api/channels/${id}/api-keys`, data)
  }

  // Videos
  async getVideos(channelId: string, params?: { page?: number; limit?: number; search?: string; status?: string; sort?: string }) {
    const query = new URLSearchParams()
    if (params?.page) query.set('page', String(params.page))
    if (params?.limit) query.set('limit', String(params.limit))
    if (params?.search) query.set('search', params.search)
    if (params?.status) query.set('status', params.status)
    if (params?.sort) query.set('sort', params.sort)
    const qs = query.toString()
    return this.get<PaginatedVideos>(`/api/channels/${channelId}/videos${qs ? `?${qs}` : ''}`)
  }

  async getVideo(id: string) {
    return this.get<Video>(`/api/videos/${id}`)
  }

  async fetchVideoAnalytics(id: string) {
    return this.post<Video>(`/api/videos/${id}/analytics`)
  }

  async getVideoStats(channelId: string) {
    return this.get<VideoStats>(`/api/channels/${channelId}/videos/stats`)
  }

  async updateVideo(id: string, data: { title?: string; description?: string; tags?: string[]; seoStatus?: string; thumbnailUrl?: string }) {
    return this.patch<Video>(`/api/videos/${id}`, data)
  }

  async setVideoThumbnail(videoId: string, thumbnailUrl: string) {
    return this.post<Video>(`/api/videos/${videoId}/thumbnail`, { thumbnailUrl })
  }

  async getDriftedVideos(channelId: string) {
    return this.get<Array<{ id: string; title: string; youtubeTitle: string; youtubeDescription?: string; youtubeTags?: string[]; youtubeId: string; thumbnailUrl: string; seoStatus: string; hasTitleDrift: boolean; hasDescriptionDrift: boolean; hasTagsDrift: boolean }>>(
      `/api/channels/${channelId}/videos/drifted`,
    )
  }

  async pullFromYoutube(videoId: string) {
    return this.post<Video>(`/api/videos/${videoId}/pull-from-youtube`)
  }

  async pushToYoutube(videoId: string) {
    return this.post<Video>(`/api/videos/${videoId}/push-to-youtube`)
  }

  // SEO
  async generateSeo(videoId: string, customInstructions?: string) {
    return this.post<SeoSuggestion>('/api/seo/generate', { videoId, customInstructions })
  }

  async getSeoSuggestions(channelId: string) {
    return this.get<SeoSuggestion[]>(`/api/channels/${channelId}/seo/suggestions`)
  }

  async approveSeo(id: string) {
    return this.patch<{ success: boolean; error?: string; youtubePushed?: boolean; dailyCount: number; dailyCap: number }>(`/api/seo/suggestions/${id}/approve`)
  }

  async rejectSeo(id: string) {
    return this.patch<SeoSuggestion>(`/api/seo/suggestions/${id}/reject`)
  }

  async getSeoVersions(videoId: string) {
    return this.get<import('@/types/video').VideoVersion[]>(`/api/videos/${videoId}/seo-versions`)
  }

  async rollbackSeoVersion(versionId: string) {
    return this.patch<Video>(`/api/seo/versions/${versionId}/rollback`)
  }

  // Chat
  async getThreads(channelId: string, includeArchived = false) {
    const query = includeArchived ? '?includeArchived=true' : ''
    return this.get<ThreadListItem[]>(`/api/channels/${channelId}/threads${query}`)
  }

  async getThread(id: string) {
    return this.get<Thread>(`/api/threads/${id}`)
  }

  async createThread(channelId: string, data: { title?: string; type: string; videoId?: string }) {
    return this.post<Thread>(`/api/channels/${channelId}/threads`, data)
  }

  async getUniqueHostImages() {
    return this.get<Array<{ id: string; filename: string; url: string; title: string }>>('/api/assets/unique-images')
  }

  async getLogoAssets() {
    return this.get<Array<{ id: string; filename: string; url: string; title: string }>>('/api/assets/logos')
  }

  async generateThumbnailImage(
    threadId: string,
    data: {
      text: string
      visual: string
      colors: string
      conceptTitle?: string
      videoTitle?: string
      selectedHostImage?: string
      logoPosition?: 'top-left' | 'top-right' | 'none'
      messageId?: string
    },
  ) {
    return this.post<{ imageUrl: string; revisedPrompt: string }>(`/api/threads/${threadId}/generate-thumbnail-image`, data)
  }

  async generateSceneImage(
    threadId: string,
    data: {
      scene: string
      style: string
      colors: string
      textOverlay?: string
      videoTitle?: string
      referenceImageUrl?: string
      logoPosition?: 'top-right' | 'none'
      messageId?: string
    },
  ) {
    return this.post<{ imageUrl: string; revisedPrompt: string }>(`/api/threads/${threadId}/generate-scene-image`, data)
  }

  async editImage(
    threadId: string,
    data: {
      prompt: string
      baseImageUrl: string
      referenceImageUrls?: string[]
    },
  ) {
    return this.post<{ imageUrl: string }>(`/api/threads/${threadId}/edit-image`, data)
  }

  async generateImageDirect(
    threadId: string,
    data: {
      prompt: string
      videoTitle?: string
      logoPosition?: 'top-right' | 'none'
    },
  ) {
    return this.post<{ imageUrl: string }>(`/api/threads/${threadId}/generate-image-direct`, data)
  }

  async sendMessage(threadId: string, content: string, skill?: string) {
    return this.post<SendMessageResponse>(`/api/threads/${threadId}/messages`, { content, skill })
  }

  async sendMessageStream(
    threadId: string,
    content: string,
    skill: string | undefined,
    onChunk: (chunk: string) => void,
    onDone: (messageId: string, usage?: any) => void,
    onError: (error: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const token = this.getToken()
    const response = await fetch(`${this.baseUrl}/api/threads/${threadId}/messages/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ content, skill }),
      signal,
    })

    if (!response.ok) {
      if (response.status === 401 && typeof window !== 'undefined') {
        localStorage.removeItem('auth_token')
        dispatchLogout?.()
        window.location.href = '/login'
        return
      }
      const err = await response.json().catch(() => ({ message: response.statusText }))
      throw new Error(err.message || `Stream error: ${response.status}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''

    try {
      let streamDone = false
      while (!streamDone) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.type === 'chunk' && data.content) {
                onChunk(data.content)
              } else if (data.type === 'done') {
                onDone(data.messageId, data.usage)
                streamDone = true
                break
              } else if (data.type === 'error') {
                onError(data.content || 'An error occurred')
                streamDone = true
                break
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    } catch (error: any) {
      onError(error.message)
    }
  }

  async uploadFile(threadId: string, file: File, content?: string) {
    const token = this.getToken()
    const formData = new FormData()
    formData.append('file', file)
    if (content) formData.append('content', content)

    const response = await fetch(`${this.baseUrl}/api/threads/${threadId}/messages/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    })

    if (!response.ok) {
      if (response.status === 401 && typeof window !== 'undefined') {
        localStorage.removeItem('auth_token')
        dispatchLogout?.()
        window.location.href = '/login'
        throw new Error('Session expired')
      }
      const err = await response.json().catch(() => ({ message: response.statusText }))
      throw new Error(err.message || `Upload error: ${response.status}`)
    }

    const data = await response.json()
    return data.data ?? data
  }

  async renameThread(id: string, title: string) {
    return this.patch<Thread>(`/api/threads/${id}`, { title })
  }

  async archiveThread(id: string) {
    return this.post<{ id: string }>(`/api/threads/${id}/archive`)
  }

  async deleteThread(id: string) {
    return this.delete<{ id: string }>(`/api/threads/${id}`)
  }

  async findThreadByVideoId(channelId: string, videoId: string) {
    return this.get<Thread | null>(`/api/channels/${channelId}/threads/video/${videoId}`)
  }

  async deleteMessage(threadId: string, messageId: string) {
    return this.delete<{ success: boolean }>(`/api/threads/${threadId}/messages/${messageId}`)
  }

  // Queue
  async getQueueItems(channelId: string) {
    return this.get<QueueItem[]>(`/api/channels/${channelId}/queue`)
  }

  async getQueueStats(channelId: string) {
    return this.get<QueueStats>(`/api/channels/${channelId}/queue/stats`)
  }

  async addToQueue(channelId: string, videoId: string, videoTitle: string) {
    return this.post<{ item?: QueueItem; queued: boolean; message?: string }>(`/api/channels/${channelId}/queue`, { videoId, videoTitle })
  }

  async removeFromQueue(id: string) {
    return this.delete<{ id: string }>(`/api/queue/${id}`)
  }

  async toggleQueue(channelId: string) {
    return this.post<{ isActive: boolean }>(`/api/channels/${channelId}/queue/toggle`)
  }

  // Google OAuth URL
  getGoogleAuthUrl() {
    return `${this.baseUrl}/api/auth/google`
  }

  // Comments
  async getComments(videoId: string, pageToken?: string, order?: string) {
    const params = new URLSearchParams()
    if (pageToken) params.set('pageToken', pageToken)
    if (order) params.set('order', order)
    const query = params.toString() ? `?${params.toString()}` : ''
    return this.get<CommentsResponse>(`/api/videos/${videoId}/comments${query}`)
  }

  async getCommentReplies(videoId: string, commentId: string, pageToken?: string) {
    const query = pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ''
    return this.get<{ replies: Comment[]; nextPageToken?: string }>(
      `/api/videos/${videoId}/comments/${commentId}/replies${query}`,
    )
  }

  async syncComments(videoId: string, order?: string) {
    return this.post<CommentsResponse>(`/api/videos/${videoId}/comments/sync`, { order })
  }

  async generateReply(videoId: string, commentId: string, commentText: string) {
    return this.post<{ reply: string; replies?: AiReplyOption[] }>(`/api/videos/${videoId}/comments/generate-reply`, {
      commentId,
      commentText,
    })
  }

  async generateReplies(videoId: string, commentId: string, commentText: string) {
    return this.post<{ reply: string; replies: AiReplyOption[] }>(`/api/videos/${videoId}/comments/generate-replies`, {
      commentId,
      commentText,
    })
  }

  async postReply(videoId: string, parentId: string, text: string) {
    return this.post<{ success: boolean; mock: boolean; commentId?: string }>(
      `/api/videos/${videoId}/comments/reply`,
      { parentId, text },
    )
  }

  // Trends
  async getTrends(channelId: string, days?: number) {
    const query = days ? `?days=${days}` : ''
    return this.get<TrendingTopic[]>(`/api/channels/${channelId}/trends${query}`)
  }

  async refreshTrends(channelId: string) {
    return this.post<TrendingTopic[]>(`/api/channels/${channelId}/trends/refresh`)
  }

  async getRefreshStatus(channelId: string) {
    return this.get<{ running: boolean; startedAt?: string; completedAt?: string; error?: string }>(
      `/api/channels/${channelId}/trends/refresh/status`
    )
  }

  async seedThreadFromTrend(channelId: string, topicId: string) {
    return this.post<Thread>(`/api/channels/${channelId}/trends/seed-thread`, { topicId })
  }

  // Quota
  async getQuotaUsage(channelId: string) {
    return this.get<QuotaUsage>(`/api/channels/${channelId}/quota`)
  }

  async getQuotaLogs(channelId: string, limit?: number) {
    const query = limit ? `?limit=${limit}` : ''
    return this.get<QuotaLog[]>(`/api/channels/${channelId}/quota/logs${query}`)
  }

  // Analytics
  async getSearchTerms(channelId: string, period?: number) {
    const query = period ? `?period=${period}` : ''
    return this.get<Array<{ term: string; views: number; watchMinutes: number }>>(
      `/api/channels/${channelId}/analytics/search-terms${query}`
    )
  }

  async getTrafficSources(channelId: string, period?: number) {
    const query = period ? `?period=${period}` : ''
    return this.get<Array<{ source: string; views: number; watchMinutes: number; subsGained: number }>>(
      `/api/channels/${channelId}/analytics/traffic-sources${query}`
    )
  }

  async getRetention(channelId: string, period?: number) {
    const query = period ? `?period=${period}` : ''
    return this.get<Array<{ date: string; retentionPercent: number; avgDuration: number }>>(
      `/api/channels/${channelId}/analytics/retention${query}`
    )
  }

  async getRevenue(channelId: string, period?: number) {
    const query = period ? `?period=${period}` : ''
    return this.get<Array<{ date: string; revenue: number; adRevenue: number }>>(
      `/api/channels/${channelId}/analytics/revenue${query}`
    )
  }

  async getTopVideosByWatchTime(channelId: string, period?: number, limit?: number) {
    const params = new URLSearchParams()
    if (period) params.set('period', String(period))
    if (limit) params.set('limit', String(limit))
    const query = params.toString() ? `?${params}` : ''
    return this.get<Array<{ videoId: string; title: string; views: number; watchMinutes: number; retentionPercent: number; revenue: number }>>(
      `/api/channels/${channelId}/analytics/top-videos${query}`
    )
  }

  // Revival
  async getRevivalPriority(channelId: string, period?: number) {
    const query = period ? `?period=${period}` : ''
    return this.get<Array<{ videoId: string; title: string; viewCount: number; searchDemand: number; matchCount: number; publishedAt: string; thumbnailUrl: string }>>(
      `/api/channels/${channelId}/revival/priority${query}`
    )
  }

  // Keywords
  async researchKeyword(channelId: string, keyword: string) {
    return this.get<{
      keyword: string
      suggestions: string[]
      expanded: string[]
      searchDemand: number
      competition: number
      overallScore: number
      topVideos: Array<{ title: string; views: number; channel: string; tags: string[] }>
    }>(`/api/channels/${channelId}/keywords/research?q=${encodeURIComponent(keyword)}`)
  }

  async getRelatedKeywords(channelId: string, keyword: string) {
    return this.get<string[]>(
      `/api/channels/${channelId}/keywords/related?q=${encodeURIComponent(keyword)}`
    )
  }

  // Competitors
  async listCompetitors(channelId: string) {
    return this.get<Array<{
      _id: string
      youtubeChannelId: string
      title: string
      thumbnailUrl: string
      subscriberCount: number
      videoCount: number
      viewCount: number
      isAutoDetected: boolean
      discoveredAt: string
    }>>(`/api/channels/${channelId}/competitors`)
  }

  async discoverCompetitors(channelId: string) {
    return this.post<Array<any>>(`/api/channels/${channelId}/competitors/discover`)
  }

  async addCompetitor(channelId: string, youtubeChannelId: string) {
    return this.post<any>(`/api/channels/${channelId}/competitors`, { youtubeChannelId })
  }

  async removeCompetitor(channelId: string, competitorId: string) {
    return this.delete<any>(`/api/channels/${channelId}/competitors/${competitorId}`)
  }

  async getCompetitorUploads(channelId: string, days?: number) {
    const query = days ? `?days=${days}` : ''
    return this.get<Array<{
      videoId: string
      title: string
      thumbnailUrl: string
      viewCount: number
      publishedAt: string
      channelTitle: string
    }>>(`/api/channels/${channelId}/competitors/uploads${query}`)
  }

  async getContentGaps(channelId: string) {
    return this.get<Array<{
      topic: string
      competitorChannel: string
      competitorVideoTitle: string
      competitorViews: number
      searchDemand: number
    }>>(`/api/channels/${channelId}/competitors/gaps`)
  }

  // Developer Logs & Diagnostics
  async getDevLogs(params?: LogQueryParams): Promise<PaginatedLogsResponse> {
    const searchParams = new URLSearchParams()
    if (params?.page) searchParams.set('page', String(params.page))
    if (params?.limit) searchParams.set('limit', String(params.limit))
    if (params?.level && params.level !== 'all') searchParams.set('level', params.level)
    if (params?.statusCode && params.statusCode !== 'all') searchParams.set('statusCode', params.statusCode)
    if (params?.method && params.method !== 'all') searchParams.set('method', params.method)
    if (params?.search) searchParams.set('search', params.search)
    if (params?.startDate) searchParams.set('startDate', params.startDate)
    if (params?.endDate) searchParams.set('endDate', params.endDate)
    if (params?.minDuration) searchParams.set('minDuration', String(params.minDuration))
    if (params?.sort) searchParams.set('sort', params.sort)

    const query = searchParams.toString() ? `?${searchParams.toString()}` : ''
    return this.get<PaginatedLogsResponse>(`/api/dev/logs${query}`)
  }

  async getDevLogStats(days = 14): Promise<LogStatsResponse> {
    return this.get<LogStatsResponse>(`/api/dev/logs/stats?days=${days}`)
  }

  async triggerTestError(type?: string): Promise<any> {
    const query = type ? `?type=${type}` : ''
    return this.post<any>(`/api/dev/logs/test-error${query}`, {})
  }

  async clearDevLogs(options?: { olderThanDays?: number; onlyErrors?: boolean }): Promise<{ deletedCount: number }> {
    const searchParams = new URLSearchParams()
    if (options?.olderThanDays) searchParams.set('olderThanDays', String(options.olderThanDays))
    if (options?.onlyErrors) searchParams.set('onlyErrors', 'true')
    const query = searchParams.toString() ? `?${searchParams.toString()}` : ''
    return this.delete<{ deletedCount: number }>(`/api/dev/logs${query}`)
  }
}

export const api = new ApiClient()
export default api
