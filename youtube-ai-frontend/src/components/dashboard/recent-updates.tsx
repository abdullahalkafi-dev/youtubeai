'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useAppSelector } from '@/store/hooks'
import { api } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatNumber, formatDate } from '@/lib/utils'
import type { Video } from '@/types/video'

export function RecentUpdates() {
  const channelId = useAppSelector(s => s.auth.activeChannelId)
  const [recentVideos, setRecentVideos] = useState<Video[]>([])

  useEffect(() => {
    if (channelId) {
      api.getVideos(channelId, { limit: 5, sort: 'newest' })
        .then(result => setRecentVideos(result.items))
        .catch(() => setRecentVideos([]))
    }
  }, [channelId])

  const getStatus = (seoStatus: string) => {
    switch (seoStatus) {
      case 'optimized':
      case 'approved': return { label: 'done', variant: 'green' as const, color: 'bg-emerald-500' }
      case 'pending': return { label: 'queued', variant: 'yellow' as const, color: 'bg-amber-500' }
      case 'processing': return { label: 'processing', variant: 'blue' as const, color: 'bg-blue-500' }
      default: return { label: 'new', variant: 'gray' as const, color: 'bg-gray-400' }
    }
  }

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white font-heading">Recent Updates</h3>
          <Link href="/videos" className="text-xs text-indigo-500 hover:text-indigo-600 font-medium">View All</Link>
        </div>
        <div className="space-y-2.5">
          {recentVideos.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">No videos yet. Sync your channel.</p>
          ) : (
            recentVideos.map((video) => {
              const status = getStatus(video.seoStatus)
              return (
                <Link
                  key={video.id}
                  href={`/videos/${video.id}`}
                  className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 transition"
                >
                  <div className={`w-2 h-2 rounded-full shrink-0 ${status.color}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 dark:text-white font-medium truncate">{video.title}</p>
                    <p className="text-xs text-gray-400">{formatNumber(video.viewCount)} views · {video.publishedAt ? formatDate(video.publishedAt) : 'Unknown'}</p>
                  </div>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </Link>
              )
            })
          )}
        </div>
      </CardContent>
    </Card>
  )
}
