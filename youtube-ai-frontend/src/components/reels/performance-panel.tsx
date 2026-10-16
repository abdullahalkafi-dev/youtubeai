'use client'

import { useEffect, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ExternalLink, Eye, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { errorMessage, reelsApi } from '@/lib/reels-api'
import { cn } from '@/lib/utils'
import type { AnalyticsOverview, BreakdownBy, BreakdownRow, ReelPost, SeriesPoint } from '@/types/publishing'
import { compact, PLATFORM_LABEL, PostStatusBadge, SHAPE_LABEL, timeAgo } from './reel-ui'

const PERIODS = [
  ['7d', '7 days'],
  ['30d', '30 days'],
  ['90d', '90 days'],
  ['all', 'All time'],
] as const

const BREAKDOWNS: Array<[BreakdownBy, string]> = [
  ['platform', 'Platform'],
  ['shape', 'Format'],
  ['theme', 'Topic'],
  ['entity', 'Person'],
  ['duration', 'Length'],
  ['weekday', 'Weekday'],
  ['campaign', 'Campaign'],
]

type Keyed<T> = { key: string; data: T } | null

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
      <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">{label}</p>
      <p className="text-xl font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">{value}</p>
      {hint && <p className="text-[10px] text-zinc-400">{hint}</p>}
    </div>
  )
}

/** What each published reel earned, and which kinds of reels perform. */
export function PerformancePanel({ channelId }: { channelId: string }) {
  const [period, setPeriod] = useState<(typeof PERIODS)[number][0]>('30d')
  const [by, setBy] = useState<BreakdownBy>('platform')
  const [overview, setOverview] = useState<Keyed<AnalyticsOverview>>(null)
  const [breakdown, setBreakdown] = useState<Keyed<BreakdownRow[]>>(null)
  const [posts, setPosts] = useState<Keyed<ReelPost[]>>(null)
  const [selected, setSelected] = useState<ReelPost | null>(null)
  const [series, setSeries] = useState<Keyed<SeriesPoint[]>>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  const baseKey = `${channelId}:${period}:${tick}`
  const bdKey = `${baseKey}:${by}`

  useEffect(() => {
    if (!channelId) return
    let alive = true
    Promise.all([reelsApi.analyticsOverview(channelId, period), reelsApi.listPosts(channelId, { status: 'published', period, limit: 100 })])
      .then(([o, p]) => {
        if (!alive) return
        setOverview({ key: baseKey, data: o })
        setPosts({ key: baseKey, data: [...p.items].sort((a, b) => (b.latestMetrics?.views ?? -1) - (a.latestMetrics?.views ?? -1)) })
        setError(null)
      })
      .catch((err) => alive && setError(errorMessage(err)))
    return () => {
      alive = false
    }
  }, [channelId, period, baseKey])

  useEffect(() => {
    if (!channelId) return
    let alive = true
    reelsApi
      .analyticsBreakdown(channelId, by, period)
      .then((r) => alive && setBreakdown({ key: bdKey, data: r.rows }))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [channelId, by, period, bdKey])

  const selectedId = selected?.id
  useEffect(() => {
    if (!channelId || !selectedId) return
    let alive = true
    reelsApi
      .postSeries(channelId, selectedId)
      .then((s) => alive && setSeries({ key: selectedId, data: s }))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [channelId, selectedId, tick])

  const refreshNumbers = async () => {
    if (!selected) return
    setRefreshing(true)
    try {
      const r = await reelsApi.refreshPostMetrics(channelId, selected.id)
      toast[r.ok ? 'success' : 'error'](r.message)
      setTick((t) => t + 1)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setRefreshing(false)
    }
  }

  const loaded = overview && overview.key === baseKey ? overview.data : null
  const rows = breakdown && breakdown.key === bdKey ? breakdown.data : null
  const list = posts && posts.key === baseKey ? posts.data : null
  const points = series && series.key === selectedId ? series.data : null
  const maxViews = Math.max(1, ...(rows ?? []).map((r) => r.views))
  const keyLabel = (k: string) => (by === 'shape' ? (SHAPE_LABEL as Record<string, string>)[k] ?? k : by === 'platform' ? (PLATFORM_LABEL as Record<string, string>)[k] ?? k : k)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Reel performance</h3>
          <p className="text-[11px] text-zinc-500">Numbers come from YouTube and appear within about an hour of publishing. Views count when a play starts.</p>
        </div>
        <div className="flex rounded-lg bg-zinc-100 dark:bg-zinc-800 p-0.5">
          {PERIODS.map(([id, label]) => (
            <button key={id} onClick={() => setPeriod(id)} className={cn('px-3 py-1 rounded-md text-xs font-semibold', period === id ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm' : 'text-zinc-500')}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="p-3 rounded-xl bg-red-500/10 text-xs text-red-500">{error}</div>}
      {!loaded && !error && (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
        </div>
      )}

      {loaded && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Stat label="Posts published" value={String(loaded.posts)} />
            <Stat label="Total views" value={compact(loaded.views)} />
            <Stat label="Avg views / post" value={compact(loaded.avgViewsPerPost)} />
            <Stat label="Likes" value={compact(loaded.likes)} />
            <Stat label="Watch time" value={`${compact(loaded.watchMinutes)} min`} />
          </div>

          {loaded.posts === 0 && (
            <div className="p-6 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-800 text-center text-xs text-zinc-500">
              Nothing published in this period yet. Publish a reel from its detail window and its numbers will show up here.
            </div>
          )}

          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 mr-2">What performs</span>
              {BREAKDOWNS.map(([id, label]) => (
                <button key={id} onClick={() => setBy(id)} className={cn('px-2.5 py-1 rounded-lg text-[11px] font-semibold', by === id ? 'bg-amber-500 text-black' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400')}>
                  {label}
                </button>
              ))}
            </div>
            {!rows ? (
              <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
            ) : rows.length === 0 ? (
              <p className="text-xs text-zinc-500">No numbers for this view yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-zinc-400">
                    <tr>
                      <th className="text-left py-2 pr-3">{BREAKDOWNS.find(([id]) => id === by)?.[1]}</th>
                      <th className="text-right px-3">Posts</th>
                      <th className="text-left px-3 w-[34%]">Views</th>
                      <th className="text-right px-3">Avg / post</th>
                      <th className="text-right px-3">Likes</th>
                      <th className="text-right pl-3">Avg view %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="py-2 pr-3 font-semibold text-zinc-800 dark:text-zinc-200">{keyLabel(r.key)}</td>
                        <td className="px-3 text-right tabular-nums">{r.posts}</td>
                        <td className="px-3">
                          <div className="flex items-center gap-2">
                            <div className="h-2 rounded-full bg-amber-500/80" style={{ width: `${Math.max(3, (r.views / maxViews) * 100)}%` }} />
                            <span className="tabular-nums text-zinc-500">{compact(r.views)}</span>
                          </div>
                        </td>
                        <td className="px-3 text-right tabular-nums">{compact(r.avgViews)}</td>
                        <td className="px-3 text-right tabular-nums">{compact(r.likes)}</td>
                        <td className="pl-3 text-right tabular-nums">{r.avgViewPct !== null ? `${r.avgViewPct}%` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid lg:grid-cols-[1fr_1fr] gap-6">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 text-xs font-bold text-zinc-900 dark:text-zinc-100">Posts ({list?.length ?? 0})</div>
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800 max-h-96 overflow-y-auto">
                {(list ?? []).map((p) => (
                  <li key={p.id}>
                    <button onClick={() => setSelected(p)} className={cn('w-full text-left px-4 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/40', selected?.id === p.id && 'bg-amber-500/5')}>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-zinc-400">{PLATFORM_LABEL[p.platform]}</span>
                        <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate flex-1">{p.title}</span>
                        <span className="flex items-center gap-1 text-xs tabular-nums text-zinc-500">
                          <Eye className="w-3 h-3" /> {p.latestMetrics ? compact(p.latestMetrics.views) : '—'}
                        </span>
                      </div>
                      <p className="text-[10px] text-zinc-400">{timeAgo(p.publishedAt)}</p>
                    </button>
                  </li>
                ))}
                {list && list.length === 0 && <li className="p-4 text-xs text-zinc-500">No published posts in this period.</li>}
              </ul>
            </div>

            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
              {!selected ? (
                <p className="text-xs text-zinc-500">Pick a post to see how its views grew.</p>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">{selected.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <PostStatusBadge status={selected.status} />
                        {selected.url && (
                          <a href={selected.url} target="_blank" rel="noreferrer" className="text-[11px] text-emerald-500 flex items-center gap-1">
                            <ExternalLink className="w-3 h-3" /> Open
                          </a>
                        )}
                      </div>
                    </div>
                    <button onClick={refreshNumbers} disabled={refreshing} className="px-2.5 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-[11px] font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1">
                      {refreshing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Refresh
                    </button>
                  </div>
                  {!points ? (
                    <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                  ) : points.length === 0 ? (
                    <p className="text-xs text-zinc-500">No snapshots yet. The first one is taken an hour after publishing.</p>
                  ) : (
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={points.map((p) => ({ ...p, label: p.checkpoint }))} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#71717a33" />
                          <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#71717a" />
                          <YAxis tick={{ fontSize: 10 }} stroke="#71717a" allowDecimals={false} />
                          <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 11 }} labelStyle={{ color: '#a1a1aa' }} />
                          <Line type="monotone" dataKey="views" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} name="Views" />
                          <Line type="monotone" dataKey="likes" stroke="#10b981" strokeWidth={1.5} dot={false} name="Likes" />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  {selected.latestMetrics && (
                    <div className="grid grid-cols-3 gap-2 text-center">
                      {[
                        ['Views', compact(selected.latestMetrics.views)],
                        ['Avg view %', selected.latestMetrics.avgViewPct !== undefined ? `${selected.latestMetrics.avgViewPct}%` : '—'],
                        ['Subs gained', selected.latestMetrics.subscribersGained !== undefined ? String(selected.latestMetrics.subscribersGained) : '—'],
                      ].map(([k, v]) => (
                        <div key={k} className="p-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
                          <p className="text-[10px] uppercase text-zinc-400">{k}</p>
                          <p className="text-sm font-bold text-zinc-800 dark:text-zinc-100">{v}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {selected.latestMetrics?.provisional && <p className="text-[10px] text-zinc-400">The latest days are provisional: YouTube finalises daily reports after 1–2 days.</p>}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
