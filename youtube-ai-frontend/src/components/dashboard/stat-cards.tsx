'use client'

import { useState, useEffect } from 'react'
import { useAppSelector } from '@/store/hooks'
import { api } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatNumber } from '@/lib/utils'
import type { VideoStats } from '@/types/video'

export function StatCards() {
  const channelId = useAppSelector(s => s.auth.activeChannelId)
  const channel = useAppSelector(s => s.auth.channels?.[0])
  const [stats, setStats] = useState<VideoStats | null>(null)

  useEffect(() => {
    if (channelId) {
      api.getVideoStats(channelId).then(setStats).catch(() => setStats(null))
    }
  }, [channelId])

  const cards = [
    { label: 'Videos', value: channel?.totalVideos || stats?.totalVideos || 0, badge: 'Synced', badgeVariant: 'blue' as const },
    { label: 'Total Views', value: channel?.totalViews || stats?.totalViews || 0, badge: 'All Time', badgeVariant: 'green' as const },
    { label: 'Total Likes', value: formatNumber(stats?.totalLikes || 0), badge: 'Engagement', badgeVariant: 'yellow' as const },
    { label: 'Avg Retention', value: typeof stats?.avgRetention === 'number' && !isNaN(stats.avgRetention) ? `${stats.avgRetention.toFixed(0)}%` : '0%', badge: 'Engagement', badgeVariant: 'purple' as const },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {cards.map((stat) => (
        <Card key={stat.label} className="hover:shadow-md transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{stat.label}</span>
              <Badge variant={stat.badgeVariant}>{stat.badge}</Badge>
            </div>
            <div className="flex items-baseline gap-1">
              <p className="text-2xl font-bold text-gray-900 dark:text-white font-heading">
                {typeof stat.value === 'number' ? formatNumber(stat.value) : stat.value}
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
