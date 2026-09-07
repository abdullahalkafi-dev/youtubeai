'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/utils'
import type { VideoTimelineResponse, VideoTimelinePhase, VideoTimelineMilestone } from '@/types/video'
import {
  TrendingUp,
  RefreshCw,
  Clock,
  Sparkles,
  Layers,
  AlertCircle,
  Eye,
  CheckCircle2,
} from 'lucide-react'
import { toast } from 'sonner'

interface VideoAnalyticsTimelineProps {
  videoId: string
  publishedAt?: string | null
}

const MILESTONE_COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b']

export function VideoAnalyticsTimeline({ videoId, publishedAt }: VideoAnalyticsTimelineProps) {
  const [timeline, setTimeline] = useState<VideoTimelineResponse | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [refreshing, setRefreshing] = useState<boolean>(false)
  const [selectedRange, setSelectedRange] = useState<'30d' | '90d' | 'all'>('all')
  const [error, setError] = useState<string | null>(null)

  const fetchTimeline = useCallback(
    async (isManualRefresh = false, range: '30d' | '90d' | 'all' = selectedRange) => {
      if (!videoId) return
      if (isManualRefresh) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      setError(null)

      try {
        const data = await api.getVideoTimeline(videoId, isManualRefresh, range)
        setTimeline(data)
        if (isManualRefresh) {
          toast.success('Live analytics updated from YouTube!', {
            description: `Fetched latest view data (${data?.dailyData?.length || 0} days).`,
          })
        }
      } catch (err: any) {
        const msg = err?.message || 'Failed to fetch timeline analytics'
        setError(msg)
        if (isManualRefresh) {
          toast.error('Failed to refresh analytics', { description: msg })
        }
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [videoId]
  )

  useEffect(() => {
    fetchTimeline(false, selectedRange)
  }, [fetchTimeline, selectedRange])

  const handleRangeChange = (range: '30d' | '90d' | 'all') => {
    setSelectedRange(range)
  }

  const handleManualRefresh = () => {
    fetchTimeline(true, selectedRange)
  }

  // Format timestamp for display
  const formatCachedTime = (isoString?: string) => {
    if (!isoString) return ''
    try {
      const date = new Date(isoString)
      if (isNaN(date.getTime())) return ''
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    } catch {
      return ''
    }
  }

  // Format chart dates nicely (e.g. "Aug 15")
  const formatChartDate = (dateStr: string) => {
    if (!dateStr) return ''
    try {
      const [y, m, d] = dateStr.split('-').map(Number)
      if (!y || !m || !d) return dateStr
      const date = new Date(y, m - 1, d)
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
    } catch {
      return dateStr
    }
  }

  // Loading skeleton state
  if (loading && !timeline) {
    return (
      <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="space-y-2">
              <div className="h-4 w-48 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
              <div className="h-3 w-32 bg-gray-100 dark:bg-gray-800/60 rounded animate-pulse" />
            </div>
            <div className="h-8 w-24 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 bg-gray-100/70 dark:bg-gray-800/40 rounded-xl animate-pulse" />
            ))}
          </div>
          <div className="h-64 w-full bg-gray-100/50 dark:bg-gray-800/30 rounded-xl animate-pulse flex items-center justify-center">
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <RefreshCw className="w-4 h-4 animate-spin text-indigo-500" />
              <span>Loading YouTube view velocity timeline...</span>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Error state
  if (error && (!timeline || !timeline.dailyData || timeline.dailyData.length === 0)) {
    return (
      <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 shadow-sm">
        <CardContent className="p-6 text-center">
          <div className="w-10 h-10 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto mb-3">
            <AlertCircle className="w-5 h-5" />
          </div>
          <h4 className="text-sm font-bold text-gray-900 dark:text-white">Timeline Analytics Unavailable</h4>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-md mx-auto">
            {error || 'Unable to connect to YouTube Analytics API for this video.'}
          </p>
          <button
            onClick={() => handleManualRefresh()}
            className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition shadow-sm"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
        </CardContent>
      </Card>
    )
  }

  const milestones: VideoTimelineMilestone[] = timeline?.milestones || []
  const phases: VideoTimelinePhase[] = timeline?.phases || []
  const dailyData = timeline?.dailyData || []
  const totalViewsInPeriod = timeline?.totalViewsInPeriod ?? 0
  const isFromCache = timeline?.fromCache ?? false
  const cachedTime = formatCachedTime(timeline?.cachedAt)

  // Custom Recharts Tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0]?.payload
      if (!data) return null

      return (
        <div className="bg-gray-950/95 text-white border border-gray-800 rounded-xl p-3 shadow-2xl backdrop-blur-md text-xs min-w-[190px] z-50 pointer-events-none">
          <div className="flex items-center justify-between gap-3 mb-1.5 border-b border-gray-800/80 pb-1.5">
            <span className="font-semibold text-gray-200">{formatChartDate(data.date)}</span>
            <span className="text-[10px] font-mono text-gray-400">{data.date}</span>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 flex items-center gap-1">
                <Eye className="w-3 h-3 text-indigo-400" /> Daily Views:
              </span>
              <span className="font-bold text-white text-sm font-mono">{formatNumber(data.views || 0)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-400 flex items-center gap-1">
                <Clock className="w-3 h-3 text-emerald-400" /> Watch Time:
              </span>
              <span className="font-medium text-emerald-300 font-mono">
                {Math.round(data.watchMinutes || 0)} min
              </span>
            </div>
            <div className="pt-1.5 mt-1 border-t border-gray-800/60 flex items-center justify-between">
              <span className="text-[10px] text-gray-400">SEO State:</span>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300">
                {data.versionLabel || 'Original'}
              </span>
            </div>
          </div>
        </div>
      )
    }
    return null
  }

  return (
    <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
      <CardContent className="p-5 lg:p-6 space-y-6">
        {/* Top Header Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-bold text-gray-900 dark:text-white font-heading flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-500" />
                SEO Impact & View Velocity Timeline
              </h3>
              {isFromCache ? (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300 flex items-center gap-1 border border-indigo-100 dark:border-indigo-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                  Cached (2h TTL) &middot; {cachedTime}
                </span>
              ) : (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300 flex items-center gap-1 border border-emerald-100 dark:border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Live &middot; {cachedTime}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400">
              Visualizes daily views across all SEO version milestones from upload to current date
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {/* Range Pills */}
            <div className="bg-gray-100 dark:bg-gray-800 p-1 rounded-xl flex items-center text-xs font-semibold">
              <button
                type="button"
                onClick={() => handleRangeChange('30d')}
                className={`px-2.5 py-1 rounded-lg transition ${
                  selectedRange === '30d'
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-xs'
                    : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                30D
              </button>
              <button
                type="button"
                onClick={() => handleRangeChange('90d')}
                className={`px-2.5 py-1 rounded-lg transition ${
                  selectedRange === '90d'
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-xs'
                    : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                90D
              </button>
              <button
                type="button"
                onClick={() => handleRangeChange('all')}
                className={`px-2.5 py-1 rounded-lg transition ${
                  selectedRange === 'all'
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-xs'
                    : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                All Time
              </button>
            </div>

            {/* Refresh Button */}
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-xs font-semibold text-gray-700 dark:text-gray-200 transition disabled:opacity-50 shadow-xs"
              title="Pull latest real-time data from YouTube and update Redis cache"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-indigo-500' : ''}`} />
              <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>
          </div>
        </div>

        {/* Phase Comparison KPI Cards */}
        {phases.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {phases.map((phase, idx) => {
              const isBaseline = phase.phaseName === 'baseline'
              const colorIndex = Math.max(0, idx - 1)
              const color = isBaseline ? '#6b7280' : MILESTONE_COLORS[colorIndex % MILESTONE_COLORS.length] || '#10b981'
              const lift = phase.liftPercentFromBaseline

              return (
                <div
                  key={phase.phaseName || idx}
                  className="bg-gray-50/70 dark:bg-gray-800/40 border border-gray-200/80 dark:border-gray-800 rounded-xl p-3.5 flex flex-col justify-between"
                  style={{ borderLeftColor: color, borderLeftWidth: '3px' }}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="text-xs font-bold text-gray-800 dark:text-gray-200 truncate font-heading">
                      {phase.label}
                    </span>
                    {lift !== null && lift !== undefined && !isBaseline && (
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          lift > 0
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
                            : lift < 0
                            ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                        }`}
                      >
                        {lift > 0 ? `+${lift}%` : `${lift}%`}
                      </span>
                    )}
                  </div>
                  <div className="mt-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-xl font-black text-gray-900 dark:text-white font-mono">
                        {phase.avgDailyViews.toFixed(1)}
                      </span>
                      <span className="text-[11px] text-gray-400 font-medium">views/day</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-gray-400 mt-1">
                      <span>{formatNumber(phase.totalViews)} views total</span>
                      <span>{phase.totalDays} days</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Recharts Area Chart */}
        <div className="w-full h-72 lg:h-80 pt-2">
          {dailyData.length === 0 ? (
            <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 text-xs">
              <Layers className="w-6 h-6 mb-2 text-gray-300 dark:text-gray-700" />
              <span>No daily view records found for this period yet.</span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyData} margin={{ top: 15, right: 20, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="viewsGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.45} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                  </linearGradient>
                </defs>

                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-gray-200 dark:text-gray-800/80" vertical={false} />

                <XAxis
                  dataKey="date"
                  tickFormatter={formatChartDate}
                  stroke="#9ca3af"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={25}
                />

                <YAxis
                  stroke="#9ca3af"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))}
                />

                <Tooltip content={<CustomTooltip />} />

                {/* Vertical Milestone Markers for each SEO version */}
                {milestones.map((milestone, idx) => {
                  const color = MILESTONE_COLORS[idx % MILESTONE_COLORS.length]
                  return (
                    <ReferenceLine
                      key={milestone.date + idx}
                      x={milestone.date}
                      stroke={color}
                      strokeDasharray="4 4"
                      strokeWidth={2}
                      label={{
                        value: milestone.label,
                        position: 'insideTopLeft',
                        fill: color,
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    />
                  )
                })}

                <Area
                  type="monotone"
                  dataKey="views"
                  name="Daily Views"
                  stroke="#6366f1"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#viewsGradient)"
                  activeDot={{ r: 5, fill: '#4f46e5', stroke: '#fff', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Milestone Legend & Note Footer */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-gray-100 dark:border-gray-800/80 text-[11px] text-gray-400">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-semibold text-gray-600 dark:text-gray-400 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-indigo-500" /> Milestones:
            </span>
            {milestones.length === 0 ? (
              <span className="italic text-gray-400">No AI optimizations applied yet</span>
            ) : (
              milestones.map((m, idx) => {
                const color = MILESTONE_COLORS[idx % MILESTONE_COLORS.length]
                return (
                  <span key={m.date + idx} className="inline-flex items-center gap-1.5 font-medium">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                    <span className="text-gray-700 dark:text-gray-300 font-bold">{m.label}</span>
                  </span>
                )
              })
            )}
          </div>
          <div className="text-[10px] text-gray-400 italic">
            * Official YouTube Analytics metrics finalize within 24–48 hours after bot-filtering.
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
