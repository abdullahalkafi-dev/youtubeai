'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import {
  fetchComments,
  syncComments,
  clearComments,
  setSortBy,
  setFilterStatus,
  setSearchQuery,
} from '@/store/slices/comments-slice'
import type { SortOrder, CommentFilterStatus } from '@/store/slices/comments-slice'
import { CommentItem } from './comment-item'
import {
  MessageSquareOff,
  RefreshCw,
  Loader2,
  Search,
  CheckCircle2,
  Clock,
  MessageSquare,
  Sparkles,
  X,
  Filter,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface CommentsSectionProps {
  videoId: string
  youtubeId?: string
}

export function CommentsSection({ videoId, youtubeId }: CommentsSectionProps) {
  const dispatch = useAppDispatch()
  const {
    threads,
    loading,
    syncing,
    commentsDisabled,
    nextPageToken,
    totalCount,
    error,
    isDemoMode,
    sortBy,
    filterStatus,
    searchQuery,
  } = useAppSelector((s) => s.comments)

  const [localSearch, setLocalSearch] = useState(searchQuery)

  useEffect(() => {
    dispatch(fetchComments({ videoId, order: sortBy }))
    return () => {
      dispatch(clearComments())
    }
  }, [videoId, dispatch])

  const handleSync = async () => {
    try {
      await dispatch(syncComments({ videoId, order: sortBy })).unwrap()
      toast.success('Comments synced with YouTube')
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

  const handleFilterChange = (status: CommentFilterStatus) => {
    dispatch(setFilterStatus(status))
  }

  const handleSearchChange = (val: string) => {
    setLocalSearch(val)
    dispatch(setSearchQuery(val))
  }

  // Count calculations
  const { respondedCount, unrespondedCount } = useMemo(() => {
    let responded = 0
    let unresponded = 0
    threads.forEach((t) => {
      if (t.hasCreatorReplied) {
        responded++
      } else {
        unresponded++
      }
    })
    return { respondedCount: responded, unrespondedCount: unresponded }
  }, [threads])

  // Filtered thread list
  const filteredThreads = useMemo(() => {
    let result = threads

    // Filter by status
    if (filterStatus === 'unresponded') {
      result = result.filter((t) => !t.hasCreatorReplied)
    } else if (filterStatus === 'responded') {
      result = result.filter((t) => t.hasCreatorReplied)
    }

    // Filter by search term
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (t) =>
          t.text.toLowerCase().includes(q) ||
          t.authorName.toLowerCase().includes(q) ||
          t.replies.some((r) => r.text.toLowerCase().includes(q) || r.authorName.toLowerCase().includes(q)),
      )
    }

    return result
  }, [threads, filterStatus, searchQuery])

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 space-y-4 shadow-sm font-sans">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 dark:border-gray-800 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white font-heading">
                Comments & Community Management
              </h3>
              {totalCount > 0 && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-semibold">
                  {totalCount.toLocaleString()} total
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Engage viewers with 10-tone AI replies & track responded comments
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Sort Toggle */}
          <div className="flex items-center rounded-xl bg-gray-100 dark:bg-gray-800 p-0.5 border border-gray-200/80 dark:border-gray-700/80">
            <button
              onClick={() => handleSortChange('relevance')}
              className={cn(
                'text-xs font-semibold px-3 py-1 rounded-lg transition',
                sortBy === 'relevance'
                  ? 'bg-white dark:bg-gray-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300',
              )}
            >
              Top
            </button>
            <button
              onClick={() => handleSortChange('time')}
              className={cn(
                'text-xs font-semibold px-3 py-1 rounded-lg transition',
                sortBy === 'time'
                  ? 'bg-white dark:bg-gray-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300',
              )}
            >
              Newest
            </button>
          </div>

          {/* Sync Button */}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/80 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 transition shadow-xs disabled:opacity-50"
            title="Sync latest comments with YouTube"
          >
            {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Sync
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      {!commentsDisabled && (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {/* Status Filter Chips */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => handleFilterChange('all')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition border',
                filterStatus === 'all'
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm shadow-indigo-600/20'
                  : 'bg-gray-50 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800',
              )}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              All Comments ({threads.length})
            </button>

            <button
              onClick={() => handleFilterChange('unresponded')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition border',
                filterStatus === 'unresponded'
                  ? 'bg-amber-500 text-white border-amber-500 shadow-sm shadow-amber-500/20'
                  : 'bg-amber-50/50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-900/50 hover:bg-amber-100/60',
              )}
            >
              <Clock className="w-3.5 h-3.5" />
              ⚡ Unresponded ({unrespondedCount})
            </button>

            <button
              onClick={() => handleFilterChange('responded')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition border',
                filterStatus === 'responded'
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm shadow-emerald-600/20'
                  : 'bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50 hover:bg-emerald-100/60',
              )}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              ✓ Responded ({respondedCount})
            </button>
          </div>

          {/* Search Box */}
          <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={localSearch}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search comments or author..."
              className="w-full pl-8 pr-8 py-1.5 bg-gray-50 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
            />
            {localSearch && (
              <button
                onClick={() => handleSearchChange('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-xs text-rose-600 dark:text-rose-400">
          {error}
        </div>
      )}

      {/* Comments Disabled */}
      {commentsDisabled && (
        <div className="text-center py-10 space-y-2">
          <MessageSquareOff className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto" />
          <p className="text-xs text-gray-400 font-medium">Comments are disabled on this video</p>
        </div>
      )}

      {/* Loading Skeletons */}
      {loading && threads.length === 0 && (
        <div className="space-y-3 pt-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-3.5 rounded-xl border border-gray-100 dark:border-gray-800 animate-pulse space-y-2">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-800" />
                <div className="space-y-1 flex-1">
                  <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-28" />
                  <div className="h-2.5 bg-gray-100 dark:bg-gray-800/60 rounded w-16" />
                </div>
              </div>
              <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-full" />
              <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-3/4" />
            </div>
          ))}
        </div>
      )}

      {/* Comments List */}
      {!commentsDisabled && filteredThreads.length > 0 && (
        <div className="space-y-3 pt-1">
          {filteredThreads.map((thread) => (
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
              hasCreatorReplied={thread.hasCreatorReplied}
            />
          ))}
        </div>
      )}

      {/* Filtered Empty State */}
      {!loading && !commentsDisabled && threads.length > 0 && filteredThreads.length === 0 && (
        <div className="text-center py-10 space-y-2 bg-gray-50/50 dark:bg-gray-800/30 rounded-xl border border-dashed border-gray-200 dark:border-gray-800">
          <Filter className="w-8 h-8 text-gray-400 mx-auto" />
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
            No comments match "{filterStatus === 'unresponded' ? 'Unresponded' : filterStatus === 'responded' ? 'Responded' : 'All'}" filter
          </p>
          {searchQuery && <p className="text-[11px] text-gray-400">Search query: "{searchQuery}"</p>}
          <button
            onClick={() => {
              handleFilterChange('all')
              handleSearchChange('')
            }}
            className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold hover:underline mt-1"
          >
            Reset Filters
          </button>
        </div>
      )}

      {/* Global Empty State */}
      {!loading && !commentsDisabled && threads.length === 0 && (
        <div className="text-center py-10 space-y-3">
          {isDemoMode ? (
            <>
              <MessageSquareOff className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto" />
              <p className="text-xs text-gray-400">
                YouTube account not connected. Please re-login with Google to view comments.
              </p>
            </>
          ) : (
            <>
              <MessageSquare className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto" />
              <p className="text-xs text-gray-400">No comments found on this video yet.</p>
              <button
                onClick={handleSync}
                className="px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-500 transition shadow-sm"
              >
                Sync with YouTube
              </button>
            </>
          )}
        </div>
      )}

      {/* Load More Button */}
      {nextPageToken && filterStatus === 'all' && !searchQuery && (
        <button
          onClick={handleLoadMore}
          disabled={loading}
          className="w-full mt-3 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 font-semibold py-2.5 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/50 transition flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          {loading ? 'Loading More Comments...' : 'Load More Comments from YouTube'}
        </button>
      )}
    </div>
  )
}
