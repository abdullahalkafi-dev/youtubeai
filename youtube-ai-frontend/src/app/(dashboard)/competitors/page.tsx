'use client'

import { useEffect, useState } from 'react'
import { useAppSelector } from '@/store/hooks'
import api from '@/lib/api'
import { showApiErrorToast } from '@/lib/error-handler'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Target, RefreshCw, Plus, Trash2, TrendingUp, Users, Video, ExternalLink } from 'lucide-react'

interface Competitor {
  _id: string
  youtubeChannelId: string
  title: string
  thumbnailUrl: string
  subscriberCount: number
  videoCount: number
  viewCount: number
  isAutoDetected: boolean
  discoveredAt: string
}

interface CompetitorVideo {
  videoId: string
  title: string
  thumbnailUrl: string
  viewCount: number
  publishedAt: string
  channelTitle: string
}

interface ContentGap {
  topic: string
  competitorChannel: string
  competitorVideoTitle: string
  competitorViews: number
  searchDemand: number
}

type Tab = 'competitors' | 'uploads' | 'gaps'

export default function CompetitorsPage() {
  const channelId = useAppSelector((s) => s.auth.activeChannelId)
  const [tab, setTab] = useState<Tab>('competitors')
  const [competitors, setCompetitors] = useState<Competitor[]>([])
  const [uploads, setUploads] = useState<CompetitorVideo[]>([])
  const [gaps, setGaps] = useState<ContentGap[]>([])
  const [loading, setLoading] = useState(true)
  const [discovering, setDiscovering] = useState(false)
  const [addUrl, setAddUrl] = useState('')
  const [adding, setAdding] = useState(false)

  const loadData = async () => {
    if (!channelId) return
    setLoading(true)
    try {
      const [comp, up, gap] = await Promise.all([
        api.listCompetitors(channelId),
        api.getCompetitorUploads(channelId, 30),
        api.getContentGaps(channelId),
      ])
      setCompetitors(comp)
      setUploads(up)
      setGaps(gap)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [channelId])

  const handleDiscover = async () => {
    if (!channelId) return
    setDiscovering(true)
    try {
      await api.discoverCompetitors(channelId)
      await loadData()
    } catch (err: any) {
      showApiErrorToast(err, 'Failed to discover competitors')
    } finally {
      setDiscovering(false)
    }
  }

  const handleAdd = async () => {
    if (!channelId || !addUrl.trim()) return
    setAdding(true)
    try {
      // Extract channel ID from URL or use as-is
      const channelIdOrUrl = addUrl.trim()
      await api.addCompetitor(channelId, channelIdOrUrl)
      setAddUrl('')
      await loadData()
    } catch (err: any) {
      showApiErrorToast(err, 'Failed to add competitor')
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (competitorId: string) => {
    if (!channelId) return
    try {
      await api.removeCompetitor(channelId, competitorId)
      setCompetitors((prev) => prev.filter((c) => c._id !== competitorId))
    } catch {
      // ignore
    }
  }

  const tabs = [
    { id: 'competitors' as Tab, label: 'Competitors', count: competitors.length },
    { id: 'uploads' as Tab, label: 'Recent Uploads', count: uploads.length },
    { id: 'gaps' as Tab, label: 'Content Gaps', count: gaps.length },
  ]

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Target className="w-6 h-6 text-rose-500" />
            Competitor Monitoring
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Track competitors, find content gaps, and discover opportunities
          </p>
        </div>
        <button
          onClick={handleDiscover}
          disabled={discovering}
          className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition"
        >
          <RefreshCw className={`w-4 h-4 ${discovering ? 'animate-spin' : ''}`} />
          {discovering ? 'Discovering...' : 'Auto-Detect'}
        </button>
      </div>

      {/* Add Competitor */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-3">
            <input
              type="text"
              value={addUrl}
              onChange={(e) => setAddUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder="Paste YouTube channel ID or URL to add manually..."
              className="flex-1 px-4 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            <button
              onClick={handleAdd}
              disabled={adding || !addUrl.trim()}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 transition"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition ${
              tab === t.id
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {t.label}
            <span className="ml-1.5 px-1.5 py-0.5 text-[10px] bg-gray-100 dark:bg-gray-800 rounded-full">
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
        </div>
      ) : (
        <>
          {/* Competitors Tab */}
          {tab === 'competitors' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {competitors.length === 0 ? (
                <Card className="lg:col-span-3">
                  <CardContent className="py-12 text-center">
                    <Target className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                    <p className="text-sm text-gray-500">No competitors tracked yet.</p>
                    <p className="text-xs text-gray-400 mt-1">Click &quot;Auto-Detect&quot; or add manually.</p>
                  </CardContent>
                </Card>
              ) : (
                competitors.map((comp) => (
                  <Card key={comp._id} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        {comp.thumbnailUrl ? (
                          <img
                            src={comp.thumbnailUrl}
                            alt=""
                            className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                            <Users className="w-5 h-5 text-gray-400" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                            {comp.title}
                          </p>
                          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                            {comp.subscriberCount > 0 && (
                              <span className="flex items-center gap-1">
                                <Users className="w-3 h-3" />
                                {comp.subscriberCount.toLocaleString()}
                              </span>
                            )}
                            {comp.videoCount > 0 && (
                              <span className="flex items-center gap-1">
                                <Video className="w-3 h-3" />
                                {comp.videoCount.toLocaleString()}
                              </span>
                            )}
                          </div>
                          {comp.isAutoDetected && (
                            <span className="inline-block mt-1 px-1.5 py-0.5 text-[10px] bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded">
                              Auto-detected
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => handleRemove(comp._id)}
                          className="text-gray-400 hover:text-red-500 transition p-1"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          )}

          {/* Uploads Tab */}
          {tab === 'uploads' && (
            <div className="space-y-3">
              {uploads.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <Video className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                    <p className="text-sm text-gray-500">No recent uploads from competitors.</p>
                    <p className="text-xs text-gray-400 mt-1">Add competitors first, then check back.</p>
                  </CardContent>
                </Card>
              ) : (
                uploads.map((video, i) => (
                  <Card key={i} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-4">
                        {video.thumbnailUrl && (
                          <img
                            src={video.thumbnailUrl}
                            alt=""
                            className="w-24 h-14 object-cover rounded-md flex-shrink-0"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                            {video.title}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {video.channelTitle}
                            {video.viewCount > 0 && ` • ${video.viewCount.toLocaleString()} views`}
                          </p>
                        </div>
                        <a
                          href={`https://youtube.com/watch?v=${video.videoId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gray-400 hover:text-indigo-500 transition"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          )}

          {/* Content Gaps Tab */}
          {tab === 'gaps' && (
            <div className="space-y-3">
              {gaps.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <TrendingUp className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                    <p className="text-sm text-gray-500">No content gaps found.</p>
                    <p className="text-xs text-gray-400 mt-1">Add competitors to analyze gaps.</p>
                  </CardContent>
                </Card>
              ) : (
                gaps.map((gap, i) => (
                  <Card key={i} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <span className="flex-shrink-0 w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center text-sm font-bold text-amber-600 dark:text-amber-400">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white">
                            {gap.topic}
                          </p>
                          <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                            <span>By {gap.competitorChannel}</span>
                            {gap.competitorViews > 0 && (
                              <span>{gap.competitorViews.toLocaleString()} views</span>
                            )}
                          </div>
                        </div>
                        <div className="flex-shrink-0 text-right">
                          <p className="text-[10px] text-gray-400 uppercase tracking-wider">Search Demand</p>
                          <p className="text-lg font-bold text-emerald-600">{gap.searchDemand}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
