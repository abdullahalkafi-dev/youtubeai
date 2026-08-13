'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useCallback, useState } from 'react'
import { useAppSelector, useAppDispatch } from '@/store/hooks'
import { createThread } from '@/store/slices/chat-slice'
import { generateSeo } from '@/store/slices/seo-slice'
import { fetchVideos } from '@/store/slices/videos-slice'
import { Badge } from '@/components/ui/badge'
import { formatNumber, formatDate } from '@/lib/utils'
import { SEO_STATUS } from '@/lib/constants'
import { Play, Sparkles, MessageSquare, ExternalLink, ArrowDown, ArrowUp, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import api from '@/lib/api'

export function VideoTable() {
  const router = useRouter()
  const dispatch = useAppDispatch()
  const videos = useAppSelector(s => s.videos.items)
  const filters = useAppSelector(s => s.videos.filters)
  const pagination = useAppSelector(s => s.videos.pagination)
  const channelId = useAppSelector(s => s.auth.activeChannelId)
  const initialSearchRef = useRef(filters.search)
  const [optimizingIds, setOptimizingIds] = useState<Record<string, boolean>>({})
  const [loadingAction, setLoadingAction] = useState<string | null>(null)

  // Fetch videos when search changes (skip initial mount — VideosPage handles that)
  useEffect(() => {
    if (!channelId) return
    // Skip if search hasn't changed from initial value
    if (filters.search === initialSearchRef.current) return
    dispatch(fetchVideos({ channelId, page: 1, limit: pagination.limit, search: filters.search, status: filters.status, sort: filters.sort }))
  }, [filters.search, channelId, dispatch])

  const handleGenerateSeo = async (videoId: string, title: string) => {
    setOptimizingIds(prev => ({ ...prev, [videoId]: true }))
    try {
      await dispatch(generateSeo({ videoId })).unwrap()
      toast.success("SEO content generation started...", { description: `Optimizing: ${title}` })
    } catch (err: any) {
      toast.error(err.message || "Failed to start SEO generation")
      setOptimizingIds(prev => ({ ...prev, [videoId]: false }))
    }
  }

  const handleOpenChat = (video: typeof videos[0]) => {
    if (!channelId) return
    dispatch(createThread({
      channelId,
      title: video.title.length > 40 ? video.title.slice(0, 40) + '...' : video.title,
      type: 'video',
      videoId: video.id,
    }))
    toast.success("Thread created", { description: video.title })
    router.push('/chat')
  }

  const handlePullFromYoutube = async (videoId: string, title: string) => {
    setLoadingAction(videoId)
    try {
      await api.pullFromYoutube(videoId)
      toast.success("Pulled from YouTube", { description: "Video now matches YouTube" })
      if (channelId) {
        dispatch(fetchVideos({ channelId, page: pagination.page, limit: pagination.limit, search: filters.search, status: filters.status, sort: filters.sort }))
      }
    } catch (error: any) {
      toast.error("Pull failed", { description: error.message })
    } finally {
      setLoadingAction(null)
    }
  }

  const handlePushToYoutube = async (videoId: string, title: string) => {
    setLoadingAction(videoId)
    try {
      await api.pushToYoutube(videoId)
      toast.success("Pushed to YouTube", { description: `"${title}" sent to YouTube` })
      if (channelId) {
        dispatch(fetchVideos({ channelId, page: pagination.page, limit: pagination.limit, search: filters.search, status: filters.status, sort: filters.sort }))
      }
    } catch (error: any) {
      toast.error("Push failed", { description: error.message })
    } finally {
      setLoadingAction(null)
    }
  }

  const handlePageChange = useCallback((page: number) => {
    if (!channelId) return
    dispatch(fetchVideos({ channelId, page, limit: pagination.limit, search: filters.search, status: filters.status, sort: filters.sort }))
  }, [channelId, dispatch, pagination.limit, filters.search, filters.status, filters.sort])

  const pageNumbers = []
  const maxPages = Math.min(pagination.totalPages, 5)
  const startPage = Math.max(1, pagination.page - 2)
  const endPage = Math.min(pagination.totalPages, startPage + maxPages - 1)
  for (let i = startPage; i <= endPage; i++) {
    pageNumbers.push(i)
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px]">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
              <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wider px-5 py-3">Video</th>
              <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wider px-5 py-3 hidden sm:table-cell">Views</th>
              <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wider px-5 py-3 hidden md:table-cell">Likes / Comments</th>
              <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wider px-5 py-3 hidden lg:table-cell">Status</th>
              <th className="text-right text-xs font-semibold text-gray-400 uppercase tracking-wider px-5 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {videos.map((video) => {
              const isDrifted = video.youtubeTitle && video.title !== video.youtubeTitle
              const isDeleted = video.deletedFromYoutube
              return (
                <tr key={video.id} className={`border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition ${isDeleted ? 'opacity-50' : ''}`}>
                  <td className="px-5 py-3.5">
                    <Link href={`/videos/${video.id}`} className="flex items-center gap-3">
                      <div className="w-16 h-10 bg-gray-100 dark:bg-gray-800 rounded-lg shrink-0 overflow-hidden flex items-center justify-center">
                        {video.thumbnailUrl ? (
                          <img src={video.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Play className="w-5 h-5 text-gray-400" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white truncate max-w-[350px]">
                          {video.title}
                          {isDeleted && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase ml-1.5 align-middle bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400">
                              Deleted
                            </span>
                          )}
                          {isDrifted && !isDeleted && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase ml-1.5 align-middle bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400" title={`YouTube: "${video.youtubeTitle}"`}>
                              Drift
                            </span>
                          )}
                          {video.privacyStatus && video.privacyStatus !== 'public' && !isDeleted && (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase ml-1.5 align-middle ${
                              video.privacyStatus === 'private' ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400'
                            }`}>
                              {video.privacyStatus}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-gray-400">{video.publishedAt ? formatDate(video.publishedAt) : 'Unknown'} · {video.duration || 'N/A'}</p>
                      </div>
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 hidden sm:table-cell">
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">{formatNumber(video.viewCount)}</span>
                  </td>
                  <td className="px-5 py-3.5 hidden md:table-cell">
                    <span className="text-sm font-medium text-gray-600 dark:text-gray-300">{formatNumber(video.likeCount)} / {formatNumber(video.commentCount)}</span>
                  </td>
                  <td className="px-5 py-3.5 hidden lg:table-cell">
                    <Badge variant={optimizingIds[video.id] ? 'yellow' : (SEO_STATUS[video.seoStatus]?.variant || 'gray')}>
                      {optimizingIds[video.id] ? 'Pending' : (SEO_STATUS[video.seoStatus]?.label || video.seoStatus)}
                    </Badge>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {isDrifted && !isDeleted && (
                        <>
                          <button
                            onClick={() => handlePullFromYoutube(video.id, video.title)}
                            disabled={optimizingIds[video.id]}
                            className="text-gray-400 hover:text-blue-500 p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-500/10 transition disabled:opacity-50"
                            title="Pull from YouTube (use YouTube's title)"
                          >
                            <ArrowDown className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handlePushToYoutube(video.id, video.title)}
                            disabled={optimizingIds[video.id]}
                            className="text-gray-400 hover:text-green-500 p-1.5 rounded-lg hover:bg-green-50 dark:hover:bg-green-500/10 transition disabled:opacity-50"
                            title="Push to YouTube (send DB title to YouTube)"
                          >
                            <ArrowUp className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      {!isDeleted && (
                        <>
                          <button
                            onClick={() => handleGenerateSeo(video.id, video.title)}
                            disabled={optimizingIds[video.id]}
                            className="text-gray-400 hover:text-indigo-500 p-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition disabled:opacity-50"
                            title="Generate SEO"
                          >
                            {optimizingIds[video.id] ? (
                              <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                            ) : (
                              <Sparkles className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            onClick={() => handleOpenChat(video)}
                            className="text-gray-400 hover:text-indigo-500 p-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition"
                            title="Write Script"
                          >
                            <MessageSquare className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      {video.videoUrl && (
                        <a href={video.videoUrl} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition" title="View on YouTube">
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {videos.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center">
                  <p className="text-sm text-gray-400">No videos match your search</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-800/20">
        <p className="text-xs text-gray-400">Showing {videos.length} of {formatNumber(pagination.total)} videos</p>
        {pagination.totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => handlePageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="px-2.5 py-1 text-xs text-gray-400 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:text-gray-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              &larr;
            </button>
            {pageNumbers.map(page => (
              <button
                key={page}
                onClick={() => handlePageChange(page)}
                className={`px-2.5 py-1 text-xs rounded-lg font-bold shadow-sm ${
                  page === pagination.page
                    ? 'text-white bg-indigo-500'
                    : 'text-gray-400 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:text-gray-600'
                } transition`}
              >
                {page}
              </button>
            ))}
            <button
              onClick={() => handlePageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="px-2.5 py-1 text-xs text-gray-400 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:text-gray-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              &rarr;
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
