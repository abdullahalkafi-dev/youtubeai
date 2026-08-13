'use client'

import { useEffect } from 'react'
import { useAppSelector, useAppDispatch } from '@/store/hooks'
import { fetchQueueItems, fetchQueueStats, removeFromQueueAsync, toggleQueueAsync } from '@/store/slices/queue-slice'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { QUEUE_STATUS } from '@/lib/constants'
import { timeAgo } from '@/lib/utils'

export default function QueuePage() {
  const { items, stats, loading } = useAppSelector(s => s.queue)
  const channelId = useAppSelector(s => s.auth.activeChannelId)
  const dispatch = useAppDispatch()

  useEffect(() => {
    if (channelId) {
      dispatch(fetchQueueStats(channelId))
      dispatch(fetchQueueItems(channelId))
    }
  }, [channelId, dispatch])

  return (
    <div className="p-4 lg:p-6 2xl:p-8 max-w-[1600px] mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-gray-900 dark:text-white font-heading">Update Queue</h1>
          <p className="text-sm lg:text-base text-gray-400 mt-0.5">
            {stats ? `${stats.dailyCap} videos/day · Cron every ${stats.cronInterval} min` : 'Loading...'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={stats?.isActive ? 'green' : 'gray'}>{stats?.isActive ? 'Active' : 'Paused'}</Badge>
          {channelId && (
            <button
              onClick={() => dispatch(toggleQueueAsync(channelId))}
              className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition ${stats?.isActive ? 'bg-rose-50 dark:bg-rose-500/10 text-rose-500 border-rose-100 dark:border-rose-500/20 hover:bg-rose-100' : 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 border-emerald-100 dark:border-emerald-500/20 hover:bg-emerald-100'}`}
            >
              {stats?.isActive ? 'Pause' : 'Resume'}
            </button>
          )}
        </div>
      </div>

      <Card className="mb-5">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-900 dark:text-white font-heading">Daily Quota</span>
            <span className="text-sm text-gray-400"><span className="text-indigo-600 dark:text-indigo-400 font-bold">{stats?.dailyUsed || 0}</span> / {stats?.dailyCap || 120}</span>
          </div>
          <div className="h-2.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-indigo-400 rounded-full transition-all"
              style={{ width: `${((stats?.dailyUsed || 0) / (stats?.dailyCap || 120)) * 100}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-xs text-gray-400">Resets midnight EST</span>
            <span className="text-xs text-gray-400">{(stats?.dailyCap || 120) - (stats?.dailyUsed || 0)} remaining</span>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="text-center py-8">
          <div className="w-6 h-6 border-[3px] border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-sm text-gray-400">Loading queue...</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900 dark:text-white">Active Queue</span>
            <span className="text-xs text-gray-400">·</span>
            <span className="text-xs text-gray-400">{items.length} items</span>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
                <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wider px-5 py-3">Video</th>
                <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wider px-5 py-3">Status</th>
                <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wider px-5 py-3 hidden sm:table-cell">Queued</th>
                <th className="text-right text-xs font-semibold text-gray-400 uppercase tracking-wider px-5 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-gray-50 dark:border-gray-800/50">
                  <td className="px-5 py-3">
                    <p className="text-sm text-gray-900 dark:text-white font-medium truncate max-w-[250px]">{item.videoTitle}</p>
                  </td>
                  <td className="px-5 py-3">
                    <Badge variant={QUEUE_STATUS[item.status]?.variant || 'gray'}>
                      {QUEUE_STATUS[item.status]?.label || item.status}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 hidden sm:table-cell">
                    <span className="text-xs text-gray-400">{timeAgo(item.queuedAt)}</span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    {item.status === 'queued' ? (
                      <button
                        onClick={() => dispatch(removeFromQueueAsync(item.id))}
                        className="text-xs text-rose-500 hover:text-rose-600 font-medium"
                      >
                        Remove
                      </button>
                    ) : item.status === 'processing' ? (
                      <span className="text-xs text-gray-400">...</span>
                    ) : item.status === 'done' ? (
                      <span className="text-xs text-indigo-500 font-medium cursor-pointer">View</span>
                    ) : null}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center">
                    <p className="text-sm text-gray-400">No items in queue</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
