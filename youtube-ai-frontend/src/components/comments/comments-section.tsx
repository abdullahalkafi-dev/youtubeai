'use client'

import { useEffect } from 'react'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { fetchComments, syncComments, clearComments, setSortBy } from '@/store/slices/comments-slice'
import type { SortOrder } from '@/store/slices/comments-slice'
import { CommentItem } from './comment-item'
import { MessageSquareOff, RefreshCw, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface CommentsSectionProps {
  videoId: string
  youtubeId?: string
}

export function CommentsSection({ videoId, youtubeId }: CommentsSectionProps) {
  const dispatch = useAppDispatch()
  const { threads, loading, syncing, commentsDisabled, nextPageToken, totalCount, error, isDemoMode, sortBy } =
    useAppSelector((s) => s.comments)

  useEffect(() => {
    dispatch(fetchComments({ videoId, order: sortBy }))
    return () => {
      dispatch(clearComments())
    }
  }, [videoId, dispatch])

  const handleSync = async () => {
    try {
      await dispatch(syncComments({ videoId, order: sortBy })).unwrap()
      toast.success('Comments synced')
    } catch {
      toast.error('Failed to sync comments')
    }
  }

  const handleLoadMore = () => {
    if (nextPageToken) {
      dispatch(fetchComments({ videoId, pageToken: nextPageToken, order: sortBy }))
    }
  }

  const handleSortChange = (newSort: SortOrder) => {
    if (newSort === sortBy) return
    dispatch(setSortBy(newSort))
    dispatch(fetchComments({ videoId, order: newSort }))
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white font-heading">
            Comments
          </h3>
          {totalCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 font-medium">
              {totalCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Sort Toggle */}
          <div className="flex items-center rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button
              onClick={() => handleSortChange('relevance')}
              className={cn(
                'text-[10px] font-medium px-2.5 py-1 transition',
                sortBy === 'relevance'
                  ? 'bg-indigo-500 text-white'
                  : 'text-gray-400 hover:text-indigo-500'
              )}
            >
              Top
            </button>
            <button
              onClick={() => handleSortChange('time')}
              className={cn(
                'text-[10px] font-medium px-2.5 py-1 transition',
                sortBy === 'time'
                  ? 'bg-indigo-500 text-white'
                  : 'text-gray-400 hover:text-indigo-500'
              )}
            >
              Newest
            </button>
          </div>

          {/* Sync Button */}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-indigo-500 transition font-medium"
          >
            {syncing ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
            Sync
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-500 dark:text-red-400 mb-3">{error}</p>
      )}

      {/* Comments Disabled */}
      {commentsDisabled && (
        <div className="text-center py-8">
          <MessageSquareOff className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
          <p className="text-xs text-gray-400">Comments are disabled on this video</p>
        </div>
      )}

      {/* Loading */}
      {loading && threads.length === 0 && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-start gap-2.5 animate-pulse">
              <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-800" />
              <div className="flex-1 space-y-1.5">
                <div className="h-2 bg-gray-200 dark:bg-gray-800 rounded w-24" />
                <div className="h-2 bg-gray-200 dark:bg-gray-800 rounded w-full" />
                <div className="h-2 bg-gray-200 dark:bg-gray-800 rounded w-16" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Comments List */}
      {!commentsDisabled && threads.length > 0 && (
        <div className="space-y-3">
          {threads.map((thread) => (
            <CommentItem
              key={thread.id}
              id={thread.id}
              authorName={thread.authorName}
              authorAvatar={thread.authorAvatar}
              text={thread.text}
              likeCount={thread.likeCount}
              replyCount={thread.replyCount}
              publishedAt={thread.publishedAt}
              replies={thread.replies}
              videoId={videoId}
            />
          ))}
        </div>
      )}

      {/* Load More */}
      {nextPageToken && (
        <button
          onClick={handleLoadMore}
          disabled={loading}
          className="w-full mt-4 text-xs text-indigo-500 hover:text-indigo-600 font-medium py-2 transition"
        >
          {loading ? 'Loading...' : 'Load More Comments'}
        </button>
      )}

      {/* Empty State */}
      {!loading && !commentsDisabled && threads.length === 0 && (
        <div className="text-center py-8">
          {isDemoMode ? (
            <>
              <MessageSquareOff className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p className="text-xs text-gray-400">YouTube account not connected. Please re-login with Google to view comments.</p>
            </>
          ) : (
            <p className="text-xs text-gray-400">No comments yet. Click Sync to fetch from YouTube.</p>
          )}
        </div>
      )}
    </div>
  )
}
