'use client'

import { useEffect, useState } from 'react'
import { useAppSelector } from '@/store/hooks'
import { api } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceDot } from 'recharts'
import { formatNumber } from '@/lib/utils'
import type { Video } from '@/types/video'

interface ChartData {
  date: string
  views: number
  videoTitle?: string
  isPublishDay?: boolean
}

export function PerformanceChart() {
  const channelId = useAppSelector(s => s.auth.activeChannelId)
  const [data, setData] = useState<ChartData[]>([])

  useEffect(() => {
    if (!channelId) return
    api.getVideos(channelId, { limit: 50, sort: 'newest' })
      .then((result) => {
        const videos = result.items || []
        if (videos.length === 0) { setData([]); return }

        // Build date-based view data (last 30 days)
        const now = new Date()
        const dayMap: Record<string, { views: number; videoTitle?: string }> = {}

        // Initialize last 30 days
        for (let i = 29; i >= 0; i--) {
          const d = new Date(now)
          d.setDate(d.getDate() - i)
          const key = d.toISOString().split('T')[0]
          dayMap[key] = { views: 0 }
        }

        // Aggregate views by publish date
        const publishDates = new Set<string>()
        videos.forEach((v: Video) => {
          if (!v.publishedAt) return
          const dateKey = v.publishedAt.split('T')[0]
          publishDates.add(dateKey)
          if (dayMap[dateKey]) {
            dayMap[dateKey].views += v.viewCount
            dayMap[dateKey].videoTitle = v.title
          }
        })

        // Convert to chart data
        const chartData: ChartData[] = Object.entries(dayMap).map(([date, d]) => ({
          date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          views: d.views,
          videoTitle: d.videoTitle,
          isPublishDay: publishDates.has(date),
        }))

        setData(chartData)
      })
      .catch(() => {})
  }, [channelId])

  if (data.length === 0) {
    return (
      <Card className="hover:shadow-md transition-shadow">
        <CardContent className="p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 font-heading">Performance</h3>
          <div className="h-56 flex items-center justify-center">
            <p className="text-xs text-gray-400">No data yet. Sync your channel to see performance.</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const publishDays = data.filter(d => d.isPublishDay)

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 font-heading">Performance (Last 30 Days)</h3>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id="colorViews" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#9ca3af' }} axisLine={false} tickLine={false} interval={4} />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={(v) => formatNumber(v)} />
              <Tooltip
                contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '12px' }}
                formatter={(value: any, name: any, props: any) => {
                  const label = props.payload?.videoTitle ? ` (${props.payload.videoTitle.slice(0, 30)}...)` : ''
                  return [formatNumber(Number(value)), `Views${label}`]
                }}
              />
              <Area type="monotone" dataKey="views" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#colorViews)" />
              {publishDays.map((d, i) => (
                <ReferenceDot key={i} x={d.date} y={d.views} r={4} fill="#6366f1" stroke="white" strokeWidth={2} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center gap-5 mt-3 text-[10px] text-gray-400">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-indigo-500" />Views by Day</span>
          {publishDays.length > 0 && <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-indigo-500 ring-2 ring-indigo-200" />Video Published</span>}
        </div>
      </CardContent>
    </Card>
  )
}
