'use client'

import { useEffect } from 'react'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { fetchAnalytics, setPeriod } from '@/store/slices/analytics-slice'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BarChart3, Search, TrendingUp, DollarSign, Eye } from 'lucide-react'

const PERIODS = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 365, label: '365 days' },
] as const

export default function AnalyticsPage() {
  const dispatch = useAppDispatch()
  const { searchTerms, trafficSources, retention, revenue, topVideos, period, loading } =
    useAppSelector((s) => s.analytics)
  const channelId = useAppSelector((s) => s.auth.activeChannelId)

  useEffect(() => {
    if (channelId) {
      dispatch(fetchAnalytics({ channelId, period }))
    }
  }, [channelId, period, dispatch])

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-indigo-500" />
            Analytics
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Real data from YouTube Analytics API
          </p>
        </div>
        <div className="flex gap-1.5">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => dispatch(setPeriod(p.value))}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium transition ${
                period === p.value
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Traffic Sources */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Search className="w-4 h-4 text-emerald-500" />
                Traffic Sources
              </CardTitle>
            </CardHeader>
            <CardContent>
              {searchTerms.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No traffic source data available</p>
              ) : (
                <div className="space-y-3">
                  {searchTerms.map((source, i) => {
                    const maxViews = Math.max(...searchTerms.map((s) => s.views), 1)
                    const width = Math.round((source.views / maxViews) * 100)
                    return (
                      <div key={i}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-medium text-gray-700 dark:text-gray-300">{source.term}</span>
                          <span className="text-gray-500">{source.views.toLocaleString()} views • {Math.round(source.watchMinutes).toLocaleString()} min</span>
                        </div>
                        <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2.5">
                          <div
                            className="bg-gradient-to-r from-emerald-500 to-green-400 h-2.5 rounded-full transition-all"
                            style={{ width: `${width}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Traffic Sources Breakdown */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-cyan-500" />
                Traffic Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent>
              {trafficSources.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No traffic data available</p>
              ) : (
                <div className="space-y-3">
                  {trafficSources.map((source, i) => {
                    const maxViews = Math.max(...trafficSources.map((s) => s.views), 1)
                    const width = Math.round((source.views / maxViews) * 100)
                    return (
                      <div key={i}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-medium text-gray-700 dark:text-gray-300">{source.source}</span>
                          <span className="text-gray-500">{source.views.toLocaleString()} views</span>
                        </div>
                        <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2">
                          <div
                            className="bg-gradient-to-r from-cyan-500 to-blue-500 h-2 rounded-full transition-all"
                            style={{ width: `${width}%` }}
                          />
                        </div>
                        {source.subsGained > 0 && (
                          <p className="text-[10px] text-emerald-500 mt-0.5">+{source.subsGained} subscribers</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Revenue */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-amber-500" />
                Revenue Trends
              </CardTitle>
            </CardHeader>
            <CardContent>
              {revenue.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No revenue data available</p>
              ) : (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Total Revenue</span>
                    <span className="font-bold text-lg text-gray-900 dark:text-white">
                      ${revenue.reduce((sum, r) => sum + r.revenue, 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Ad Revenue</span>
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      ${revenue.reduce((sum, r) => sum + r.adRevenue, 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Daily Avg</span>
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      ${(revenue.reduce((sum, r) => sum + r.revenue, 0) / Math.max(revenue.length, 1)).toFixed(2)}
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top Videos by Watch Time */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Eye className="w-4 h-4 text-violet-500" />
                Top Videos by Watch Time
              </CardTitle>
            </CardHeader>
            <CardContent>
              {topVideos.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No video data available</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-100 dark:border-gray-800">
                        <th className="text-left py-2 px-3 font-semibold text-gray-500">Video</th>
                        <th className="text-right py-2 px-3 font-semibold text-gray-500">Views</th>
                        <th className="text-right py-2 px-3 font-semibold text-gray-500">Watch Min</th>
                        <th className="text-right py-2 px-3 font-semibold text-gray-500">Retention</th>
                        <th className="text-right py-2 px-3 font-semibold text-gray-500">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topVideos.map((video, i) => (
                        <tr key={i} className="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                          <td className="py-2 px-3">
                            <a
                              href={`https://youtube.com/watch?v=${video.videoId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium text-[11px] max-w-[300px] truncate block"
                              title={video.title}
                            >
                              {video.title}
                            </a>
                          </td>
                          <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400">{video.views.toLocaleString()}</td>
                          <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400">{Math.round(video.watchMinutes).toLocaleString()}</td>
                          <td className="py-2 px-3 text-right">
                            <span className={`font-medium ${video.retentionPercent >= 50 ? 'text-emerald-600' : video.retentionPercent >= 30 ? 'text-amber-600' : 'text-red-600'}`}>
                              {video.retentionPercent.toFixed(1)}%
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400">${video.revenue.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
