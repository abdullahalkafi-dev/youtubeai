'use client'

import { useEffect, useRef, useState } from 'react'
import { useAppSelector, useAppDispatch } from '@/store/hooks'
import { fetchVideos, setFilters } from '@/store/slices/videos-slice'
import { VideoTable } from '@/components/videos/video-table'
import { VideoFilters } from '@/components/videos/video-filters'
import { api } from '@/lib/api'
import { showApiErrorToast } from '@/lib/error-handler'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

export default function VideosPage() {
  const dispatch = useAppDispatch()
  const channelId = useAppSelector(s => s.auth.activeChannelId)
  const { loading, pagination, filters } = useAppSelector(s => s.videos)
  const [syncing, setSyncing] = useState(false)
  const initialFetchDone = useRef(false)

  // Initial fetch on mount only
  useEffect(() => {
    if (channelId && !initialFetchDone.current) {
      initialFetchDone.current = true
      dispatch(fetchVideos({ channelId }))
    }
  }, [channelId, dispatch])

  // Re-fetch when status or sort changes
  useEffect(() => {
    if (!channelId || !initialFetchDone.current) return
    dispatch(fetchVideos({ channelId, page: 1, limit: pagination.limit, search: filters.search, status: filters.status, sort: filters.sort }))
  }, [filters.status, filters.sort])

  const handleSync = async () => {
    if (!channelId || syncing) return
    setSyncing(true)
    try {
      toast.info("Syncing channel...")
      const result = await api.syncChannel(channelId)
      const parts = [`${result.synced} processed`, `${result.new} new`, `${result.updated} updated`]
      if (result.deleted > 0) parts.push(`${result.deleted} deleted`)
      if (result.drifted > 0) parts.push(`${result.drifted} drifted`)

      if (result.errors && result.errors.length > 0) {
        toast.warning(`Synced with warnings: ${result.errors[0]}`)
      } else {
        toast.success(`Synced! ${parts.join(', ')}`)
      }
      dispatch(fetchVideos({ channelId, page: 1, limit: pagination.limit, search: filters.search, status: filters.status, sort: filters.sort }))
    } catch (err: unknown) {
      showApiErrorToast(err, "Sync Channel Failed")
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="p-4 lg:p-6 2xl:p-8 max-w-[1600px] mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-gray-900 dark:text-white font-heading">Video Library</h1>
          <p className="text-sm lg:text-base text-gray-400 dark:text-gray-500 mt-0.5">
            {loading ? 'Loading...' : `${pagination.total} videos synced`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filters.status}
            onChange={(e) => dispatch(setFilters({ status: e.target.value }))}
            className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-500 px-3 py-2"
          >
            <option value="all">All Status</option>
            <option value="not_started">Not Started</option>
            <option value="optimized">Optimized</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="deleted">Deleted from YouTube</option>
          </select>
          <select
            value={filters.sort}
            onChange={(e) => dispatch(setFilters({ sort: e.target.value }))}
            className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-500 px-3 py-2"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="views">Most Views</option>
            <option value="likes">Most Likes</option>
          </select>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="bg-indigo-500 text-white font-semibold text-xs px-4 py-2 rounded-lg hover:bg-indigo-600 transition shadow-sm shadow-indigo-500/20 flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {syncing ? 'Syncing...' : 'Sync Channel'}
          </button>
        </div>
      </div>
      <VideoFilters />
      {loading ? (
        <div className="text-center py-12">
          <div className="w-8 h-8 border-[3px] border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-400">Loading videos...</p>
        </div>
      ) : (
        <VideoTable />
      )}
    </div>
  )
}
