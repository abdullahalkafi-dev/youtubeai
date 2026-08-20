'use client'

import { useEffect, useState } from 'react'
import { useAppSelector } from '@/store/hooks'
import api, { formatAssetUrl } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RefreshCw, TrendingUp, Eye, ArrowRight } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface RevivalVideo {
  videoId: string
  title: string
  viewCount: number
  searchDemand: number
  matchCount: number
  publishedAt: string
  thumbnailUrl: string
}

export default function RevivalPage() {
  const channelId = useAppSelector((s) => s.auth.activeChannelId)
  const router = useRouter()
  const [videos, setVideos] = useState<RevivalVideo[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState(90)

  useEffect(() => {
    if (!channelId) return
    setLoading(true)
    api.getRevivalPriority(channelId, period)
      .then(setVideos)
      .catch(() => setVideos([]))
      .finally(() => setLoading(false))
  }, [channelId, period])

  const handleOptimize = (videoId: string) => {
    router.push(`/videos/${videoId}`)
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <RefreshCw className="w-6 h-6 text-indigo-500" />
            Revival Priority
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Videos ranked by search demand — re-optimize these first for maximum impact
          </p>
        </div>
        <div className="flex gap-1.5">
          {[30, 90, 365].map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium transition ${
                period === p
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {p} days
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
        </div>
      ) : videos.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <RefreshCw className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No search demand data available yet.</p>
            <p className="text-xs text-gray-400 mt-1">Data comes from YouTube Analytics — it may take 24-48 hours to appear.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {videos.map((video, i) => (
            <Card key={video.videoId} className="hover:shadow-md transition-shadow cursor-pointer" onClick={() => handleOptimize(video.videoId)}>
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  {/* Rank */}
                  <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center">
                    <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{i + 1}</span>
                  </div>

                  {/* Thumbnail */}
                  {video.thumbnailUrl && (
                    <img
                      src={formatAssetUrl(video.thumbnailUrl)}
                      alt=""
                      className="w-24 h-14 object-cover rounded-md flex-shrink-0"
                    />
                  )}

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{video.title}</p>
                    <div className="flex items-center gap-4 mt-1">
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <Eye className="w-3 h-3" />
                        {video.viewCount.toLocaleString()} views
                      </span>
                      <span className="text-xs text-gray-500">
                        {video.matchCount} search term{video.matchCount !== 1 ? 's' : ''} matching
                      </span>
                      {video.publishedAt && (
                        <span className="text-xs text-gray-400">
                          {new Date(video.publishedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Search Demand Score */}
                  <div className="flex-shrink-0 text-right">
                    <div className="flex items-center gap-2">
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wider">Search Demand</p>
                        <p className="text-lg font-bold text-emerald-600">{video.searchDemand.toLocaleString()}</p>
                      </div>
                      <div className="w-8 h-8 rounded-full bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
                        <TrendingUp className="w-4 h-4 text-emerald-500" />
                      </div>
                    </div>
                  </div>

                  {/* Action */}
                  <ArrowRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
