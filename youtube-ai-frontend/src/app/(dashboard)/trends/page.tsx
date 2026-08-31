'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { fetchTrends, refreshTrends, seedThreadFromTrend, setHistoryDays } from '@/store/slices/trends-slice'
import { setActiveThread, selectThread } from '@/store/slices/chat-slice'
import { Card, CardContent } from '@/components/ui/card'
import { RefreshCw, TrendingUp, ExternalLink, Loader2, Play, AlertCircle, Calendar, Newspaper, Sparkles, Flame, Zap, Target } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { showApiErrorToast } from '@/lib/error-handler'
import { toast } from 'sonner'

const HISTORY_OPTIONS = [
  { label: 'Today', value: null },
  { label: '3 Days', value: 3 },
  { label: '5 Days', value: 5 },
  { label: '2 Weeks', value: 14 },
]

export default function TrendsPage() {
  const dispatch = useAppDispatch()
  const router = useRouter()
  const { topics, loading, refreshing, historyDays } = useAppSelector((s) => s.trends)
  const channelId = useAppSelector((s) => s.auth.activeChannelId)
  const [activeBadgeTab, setActiveBadgeTab] = useState<'all' | 'viral' | 'gap' | 'breaking'>('all')

  useEffect(() => {
    if (channelId) {
      dispatch(fetchTrends({ channelId, days: historyDays || undefined }))
    }
  }, [channelId, dispatch, historyDays])

  const handleRefresh = async () => {
    if (!channelId) return
    try {
      await dispatch(refreshTrends({ channelId, days: historyDays || undefined })).unwrap()
      toast.success('Trends refreshed')
    } catch (err: any) {
      showApiErrorToast(err, 'Failed to refresh trends')
    }
  }

  const handleGoToThread = async (topicId: string) => {
    if (!channelId) return
    try {
      const thread = await dispatch(seedThreadFromTrend({ channelId, topicId })).unwrap()
      dispatch(setActiveThread(thread.id))
      dispatch(selectThread(thread.id))
      router.push('/chat')
      toast.success('Thread created with topic context')
    } catch (err: any) {
      showApiErrorToast(err, 'Failed to create thread')
    }
  }

  const handleHistoryFilter = (days: number | null) => {
    dispatch(setHistoryDays(days))
  }

  const filteredTopics = topics.filter((t) => {
    if (activeBadgeTab === 'all') return true
    if (activeBadgeTab === 'viral') return t.badge === 'viral' || t.opportunityScore >= 80
    if (activeBadgeTab === 'gap') return t.badge === 'gap' || t.opportunityLabel === 'Open Gap' || !t.youtubeVideoId
    if (activeBadgeTab === 'breaking') return t.badge === 'breaking' || (t.publishedAt && Date.now() - new Date(t.publishedAt).getTime() < 24 * 60 * 60 * 1000)
    return true
  })

  return (
    <div className="p-4 lg:p-6 2xl:p-8 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-gray-900 dark:text-white font-heading flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-indigo-500" />
            Trending Topics
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Top stories in criminal psychology and federal cases this week
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 transition shadow-sm shadow-indigo-500/20 disabled:opacity-50"
        >
          {refreshing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          {refreshing ? 'Searching...' : 'Refresh'}
        </button>
      </div>

      {/* Filters: Category Badges + History */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-gray-200 dark:border-gray-800">
        {/* Category Tabs */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {[
            { id: 'all', label: 'All Trends' },
            { id: 'viral', label: '🔥 Viral Breakouts' },
            { id: 'gap', label: '🎯 Untapped Gaps' },
            { id: 'breaking', label: '⚡ Breaking News' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveBadgeTab(tab.id as any)}
              className={`text-xs font-bold px-3.5 py-1.5 rounded-full transition ${
                activeBadgeTab === tab.id
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
                  : 'bg-gray-100 dark:bg-gray-800/80 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* History Filter */}
        <div className="flex items-center gap-2">
          <Calendar className="w-3.5 h-3.5 text-gray-400" />
          <span className="text-xs text-gray-400">Timeframe:</span>
          {HISTORY_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              onClick={() => handleHistoryFilter(opt.value)}
              className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg transition ${
                historyDays === opt.value
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900 shadow-sm'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {loading && topics.length === 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-72 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {/* Topics Grid */}
      {filteredTopics.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredTopics.map((topic) => (
            <Card key={topic.id} className="hover:shadow-xl transition-all duration-300 overflow-hidden flex flex-col h-full border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 rounded-xl">
              {/* Header Media Container: 16:9 aspect ratio for ALL cards */}
              {topic.youtubeVideoId && topic.youtubeThumbnailUrl ? (
                <a
                  href={topic.youtubeVideoUrl || `https://www.youtube.com/watch?v=${topic.youtubeVideoId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block aspect-video w-full overflow-hidden relative group bg-slate-900 shrink-0"
                >
                  <img
                    src={topic.youtubeThumbnailUrl}
                    alt={topic.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex flex-col justify-between p-3 transition-opacity">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-red-600/90 text-white shadow-sm backdrop-blur-sm">
                        <Play className="w-2.5 h-2.5 fill-current" /> YouTube Video
                      </span>
                      {topic.opportunityScore > 0 && (
                        <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-amber-400 border border-amber-500/30">
                          {topic.opportunityScore} pts
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-white/90">
                      <div className="w-8 h-8 rounded-full bg-red-600/90 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                        <Play className="w-4 h-4 text-white fill-white ml-0.5" />
                      </div>
                      {topic.youtubeChannelTitle && (
                        <span className="text-[11px] font-medium text-gray-200 bg-black/50 px-2 py-0.5 rounded backdrop-blur-sm truncate max-w-[180px]">
                          {topic.youtubeChannelTitle}
                        </span>
                      )}
                    </div>
                  </div>
                </a>
              ) : (
                /* Sleek Dark Gradient Header for Cards WITHOUT YouTube Video (Open Gap / Web News) */
                <div className="aspect-video w-full overflow-hidden relative bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-4 flex flex-col justify-between shrink-0 border-b border-indigo-500/10">
                  {/* Background Watermark Decorative Pattern */}
                  <div className="absolute -right-4 -bottom-4 opacity-10 text-indigo-400 pointer-events-none">
                    <TrendingUp className="w-32 h-32" />
                  </div>
                  <div className="flex items-center justify-between relative z-10">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 backdrop-blur-md">
                      <Newspaper className="w-3 h-3" />
                      {topic.opportunityLabel === 'Open Gap' ? 'Open Gap Topic' : 'Web News Search'}
                    </span>
                    {topic.opportunityScore > 0 && (
                      <span className="text-[10px] font-extrabold px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 backdrop-blur-md">
                        Score: {topic.opportunityScore}
                      </span>
                    )}
                  </div>
                  <div className="relative z-10">
                    <div className="flex items-center gap-2 text-indigo-200/80 text-xs font-medium">
                      <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
                      <span className="line-clamp-1">{topic.source || 'Trending Topic'}</span>
                    </div>
                  </div>
                </div>
              )}

              <CardContent className="p-4 sm:p-5 flex flex-col flex-1">
                <div className="flex-1">
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-2 leading-snug line-clamp-2">
                    {topic.title}
                  </h3>
                  <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed line-clamp-3">
                    {topic.summary}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800/80 space-y-2.5">
                  {/* Opportunity Badge */}
                  {topic.opportunityLabel && (
                    <div className={`flex items-center gap-1.5 text-[10px] font-semibold ${
                      topic.opportunityLabel === 'Open Gap'
                        ? 'text-amber-600 dark:text-amber-400'
                        : topic.opportunityLabel === 'High Opportunity'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : topic.opportunityLabel === 'Medium Opportunity'
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-gray-500 dark:text-gray-400'
                    }`}>
                      {topic.opportunityLabel === 'Open Gap' ? (
                        <AlertCircle className="w-3 h-3 shrink-0" />
                      ) : topic.youtubeVideoId ? (
                        <Play className="w-3 h-3 fill-current shrink-0" />
                      ) : (
                        <Sparkles className="w-3 h-3 shrink-0" />
                      )}
                      <span>{topic.opportunityLabel}</span>
                      {topic.youtubeChannelTitle && (
                        <span className="text-gray-400 dark:text-gray-500 font-normal truncate">by {topic.youtubeChannelTitle}</span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-2">
                      {(() => {
                        const rawUrl = (topic as any).sourceUrl || topic.source;
                        const validHref = (rawUrl && typeof rawUrl === 'string' && rawUrl.startsWith('http'))
                          ? rawUrl
                          : `https://www.google.com/search?q=${encodeURIComponent(topic.title + ' ' + (topic.source || ''))}`;
                        return (
                          <a
                            href={validHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-[10px] font-medium text-indigo-500 hover:text-indigo-600 dark:text-indigo-400 transition"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Source
                          </a>
                        );
                      })()}
                      <span className="text-[10px] text-gray-400">{formatDate(topic.publishedAt || topic.fetchedAt)}</span>
                    </div>

                    <button
                      onClick={() => handleGoToThread(topic.id)}
                      className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300 dark:hover:bg-indigo-500/30 transition shadow-sm"
                    >
                      Go to Thread
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && topics.length === 0 && (
        <div className="text-center py-16">
          <TrendingUp className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">No trending topics yet</p>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Click Refresh to discover trending stories in criminal psychology
          </p>
        </div>
      )}
    </div>
  )
}
