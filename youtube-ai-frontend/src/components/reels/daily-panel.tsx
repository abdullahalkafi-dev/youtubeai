'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, Brain, CalendarClock, ChevronRight, Compass, Eye, Flame, History, Info, Loader2, PauseCircle, Play, Sparkles, Trash2, TrendingDown, TrendingUp, Trophy, Minus } from 'lucide-react'
import { toast } from 'sonner'
import { errorMessage, reelsApi } from '@/lib/reels-api'
import { cn } from '@/lib/utils'
import type { DailyBrain, DailyDay, DailyHealthNote, DailyOverview, DailyPreview } from '@/types/publishing'
import { compact } from './reel-ui'

const SIGNAL = {
  trend: { label: 'Trending now', icon: Flame, cls: 'text-red-500 bg-red-500/10' },
  performance: { label: 'More of what worked', icon: Trophy, cls: 'text-amber-600 dark:text-amber-400 bg-amber-500/10' },
  explore: { label: 'Exploring something new', icon: Compass, cls: 'text-sky-600 dark:text-sky-400 bg-sky-500/10' },
  archive: { label: 'From your archive', icon: History, cls: 'text-violet-600 dark:text-violet-400 bg-violet-500/10' },
} as const

const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

/** The nightly automatic campaign: switch, next run, results per day and which kind of topic works best. */
export function DailyPanel({ channelId }: { channelId: string }) {
  const [data, setData] = useState<DailyOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'toggle' | 'run' | 'preview' | null>(null)
  const [preview, setPreview] = useState<DailyPreview | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    let alive = true
    reelsApi
      .daily(channelId)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((err) => alive && setError(errorMessage(err)))
    return () => {
      alive = false
    }
  }, [channelId, tick])

  const making = !!data?.days.some((d) => d.status === 'running' || (d.status === 'started' && d.progress))
  useEffect(() => {
    if (!making) return
    const t = setInterval(reload, 8000)
    return () => clearInterval(t)
  }, [making, reload])

  const toggle = async () => {
    if (!data) return
    setBusy('toggle')
    try {
      setData(await reelsApi.setDaily(channelId, !data.enabled))
      toast.success(data.enabled ? 'Daily reels paused' : 'Daily reels turned on')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }
  const showPreview = async () => {
    setBusy('preview')
    try {
      setPreview(await reelsApi.dailyPreview(channelId))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }
  const runNow = async () => {
    if (!confirm("Pick today's topic and start making reels now?")) return
    setBusy('run')
    try {
      setData(await reelsApi.runDailyNow(channelId))
      toast.success("Today's daily campaign has started")
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  if (error) return <div className="p-3 rounded-xl bg-red-500/10 text-xs text-red-500">{error}</div>
  if (!data)
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
      </div>
    )

  const today = data.days.find((d) => d.date === data.today)
  const canRunNow = !today || today.status === 'skipped' || today.status === 'failed'
  const next = new Date(data.nextRunAt)
  const chart = [...data.days]
    .filter((d) => d.campaignId)
    .slice(0, 30)
    .reverse()
    .map((d) => ({ day: new Date(`${d.date}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), views: d.views }))
  const anyViews = chart.some((c) => c.views > 0)
  const bestSignal = [...data.bySignal].filter((s) => s.days > 0).sort((a, b) => b.avgPerPost - a.avgPerPost)[0]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-amber-500" /> Daily reels
          </h3>
          <p className="text-xs text-zinc-500 mt-1">
            Every night at 4:00 AM New York time we score today&apos;s topics (what&apos;s trending, what your channel is being watched for, what we have not covered lately, and
            how much strong footage you have) and make 4–7 reels from your videos: about 60% on the best topic and the rest on a new one to learn what else works.
            They wait here for you — nothing is posted automatically yet.
          </p>
          <p className="text-[11px] mt-2 text-zinc-600 dark:text-zinc-300">
            {data.enabled ? (
              <>
                Next run: <b>{next.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</b> your time
              </>
            ) : (
              <span className="text-zinc-500">Paused — turn it on to get new reels every morning.</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={showPreview} disabled={!!busy} title="See what the AI would pick today, without making anything" className="px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-xs font-semibold text-zinc-700 dark:text-zinc-200 flex items-center gap-1.5 disabled:opacity-50">
            {busy === 'preview' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Preview pick
          </button>
          {canRunNow && (
            <button onClick={runNow} disabled={!!busy} className="px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-xs font-semibold text-zinc-700 dark:text-zinc-200 flex items-center gap-1.5 disabled:opacity-50">
              {busy === 'run' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Run today now
            </button>
          )}
          <button
            onClick={toggle}
            disabled={!!busy}
            role="switch"
            aria-checked={data.enabled}
            className={cn('relative w-14 h-8 rounded-full transition', data.enabled ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-700')}
            title={data.enabled ? 'On — click to pause' : 'Paused — click to turn on'}
          >
            <span className={cn('absolute top-1 w-6 h-6 rounded-full bg-white shadow transition-all', data.enabled ? 'left-7' : 'left-1')} />
          </button>
        </div>
      </div>

      <HealthBanner notes={data.health} />
      {preview && <PreviewPanel p={preview} onClose={() => setPreview(null)} />}
      {data.brain && <BrainPanel b={data.brain} />}

      {/* Insights */}
      {data.days.some((d) => d.posts > 0) && (
        <div className="grid md:grid-cols-[1fr_1.4fr] gap-4">
          <div className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-3">
            <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">Which daily topics work best</p>
            {data.bySignal.map((s) => {
              const meta = SIGNAL[s.signal]
              const max = Math.max(1, ...data.bySignal.map((x) => x.avgPerPost))
              return (
                <div key={s.signal} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className={cn('px-2 py-0.5 rounded-md font-semibold flex items-center gap-1', meta.cls)}>
                      <meta.icon className="w-3 h-3" /> {meta.label}
                    </span>
                    <span className="tabular-nums text-zinc-500">{s.days ? `${compact(s.avgPerPost)} views/post` : 'no data yet'}</span>
                  </div>
                  <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                    <div className="h-full bg-amber-500 rounded-full" style={{ width: `${(s.avgPerPost / max) * 100}%` }} />
                  </div>
                </div>
              )
            })}
            {bestSignal && <p className="text-[11px] text-zinc-500">So far, “{SIGNAL[bestSignal.signal].label}” days earn the most views per post.</p>}
          </div>
          <div className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
            <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100 mb-2">Views from each day&apos;s reels</p>
            {anyViews ? (
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="#71717a" />
                    <YAxis tick={{ fontSize: 10 }} stroke="#71717a" allowDecimals={false} />
                    <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 11 }} />
                    <Bar dataKey="views" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Views" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-xs text-zinc-500">Publish some daily reels to see which days do best.</p>
            )}
          </div>
        </div>
      )}

      {/* Days */}
      {data.days.length === 0 ? (
        <div className="p-8 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-800 text-center text-xs text-zinc-500">
          No daily campaigns yet. The first one runs {data.enabled ? `at ${next.toLocaleString(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit' })}` : 'once you turn it on'}.
        </div>
      ) : (
        <div className="space-y-2">
          {data.days.map((d) => (
            <DayCard key={d.date} d={d} />
          ))}
        </div>
      )}
    </div>
  )
}

function DayCard({ d }: { d: DailyDay }) {
  const signal = d.topic ? SIGNAL[d.topic.signal] : null
  const making = d.status === 'running' || (d.status === 'started' && !!d.progress)
  const body = (
    <div className={cn('p-4 rounded-2xl border bg-white dark:bg-zinc-900 transition', d.campaignId ? 'border-zinc-200 dark:border-zinc-800 hover:border-amber-500/60' : 'border-zinc-200 dark:border-zinc-800')}>
      <div className="flex items-start gap-3">
        <div className="w-16 shrink-0">
          <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">{fmtDay(d.date)}</p>
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          {d.status === 'skipped' ? (
            <p className="text-xs text-zinc-500 flex items-center gap-1.5">
              <PauseCircle className="w-4 h-4" /> Skipped — {d.reason}
              {d.shadow?.topic ? <span className="text-zinc-400"> · would have picked “{d.shadow.topic}”{d.shadow.exploreTopic ? ` + explore “${d.shadow.exploreTopic}”` : ''}</span> : null}
            </p>
          ) : d.deleted ? (
            <p className="text-xs text-zinc-500 flex items-center gap-1.5">
              <Trash2 className="w-4 h-4" /> {d.topic?.name ?? 'Daily campaign'} — campaign deleted
              {d.posts > 0 ? ` (${compact(d.views)} views from videos that stay on YouTube)` : ''}
            </p>
          ) : d.status === 'failed' ? (
            <p className="text-xs text-red-500 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" /> Didn&apos;t run: {d.reason}. It retries automatically at 6 AM New York time.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">{d.topic?.name ?? 'Choosing today’s topic…'}</p>
                {signal && (
                  <span className={cn('px-1.5 py-0.5 rounded-md text-[10px] font-semibold flex items-center gap-1', signal.cls)}>
                    <signal.icon className="w-3 h-3" /> {signal.label}
                  </span>
                )}
                {d.verdict && <Verdict v={d.verdict} />}
              </div>
              {d.topic?.why && <p className="text-[11px] text-zinc-500 line-clamp-2">{d.topic.why}</p>}
              {d.exploreTopic && (
                <p className="text-[11px] text-zinc-600 dark:text-zinc-300 flex flex-wrap items-center gap-1.5">
                  <span className={cn('px-1.5 py-0.5 rounded-md text-[10px] font-semibold flex items-center gap-1', SIGNAL.explore.cls)}>
                    <Compass className="w-3 h-3" /> Explore
                  </span>
                  {d.exploreTopic.name}
                  {d.mainReels != null && d.exploreReels != null && <span className="text-zinc-400">({d.mainReels} + {d.exploreReels} reels)</span>}
                </p>
              )}
              <p className="text-[11px] text-zinc-600 dark:text-zinc-300 flex flex-wrap gap-x-3">
                {making ? (
                  <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                    <Loader2 className="w-3 h-3 animate-spin" /> {d.progress ?? 'Starting…'}
                  </span>
                ) : (
                  <span>
                    {d.reelsReady} reel{d.reelsReady === 1 ? '' : 's'} ready{d.reelsPosted ? ` · ${d.reelsPosted} posted` : ''}
                  </span>
                )}
                {d.posts > 0 && (
                  <span className="flex items-center gap-1">
                    <Eye className="w-3 h-3" /> {compact(d.views)} views
                  </span>
                )}
              </p>
            </>
          )}
        </div>
        {d.campaignId && <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0 mt-1" />}
      </div>
    </div>
  )
  return d.campaignId ? <Link href={`/reels/${d.campaignId}`}>{body}</Link> : body
}

function Verdict({ v }: { v: 'better' | 'similar' | 'worse' }) {
  const m = {
    better: { icon: TrendingUp, label: 'Above average', cls: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' },
    similar: { icon: Minus, label: 'Average', cls: 'text-sky-600 dark:text-sky-400 bg-sky-500/10' },
    worse: { icon: TrendingDown, label: 'Below average', cls: 'text-amber-600 dark:text-amber-400 bg-amber-500/10' },
  }[v]
  return (
    <span className={cn('px-1.5 py-0.5 rounded-md text-[10px] font-semibold flex items-center gap-1', m.cls)}>
      <m.icon className="w-3 h-3" /> {m.label}
    </span>
  )
}

function HealthBanner({ notes }: { notes: DailyHealthNote[] }) {
  if (!notes.length) return null
  return (
    <div className="space-y-2">
      {notes.map((n) => (
        <div
          key={n.code}
          className={cn(
            'px-3 py-2 rounded-xl text-xs flex items-start gap-2',
            n.level === 'error' ? 'bg-red-500/10 text-red-600 dark:text-red-400' : n.level === 'warn' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
          )}
        >
          {n.level === 'info' ? <Info className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>{n.message}</span>
        </div>
      ))}
    </div>
  )
}

function PreviewPanel({ p, onClose }: { p: DailyPreview; onClose: () => void }) {
  return (
    <div className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-amber-500/40 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-amber-500" /> What the AI would pick today (nothing was started)
          </p>
          {p.main ? (
            <p className="text-xs text-zinc-700 dark:text-zinc-300 mt-1">
              <b>Main:</b> {p.main.name} ({p.main.reels} reels, score {p.main.score}) — {p.main.why}
              {p.explore && (
                <>
                  <br />
                  <b>Explore:</b> {p.explore.name} ({p.explore.reels} reels, score {p.explore.score}) — {p.explore.why}
                </>
              )}
            </p>
          ) : (
            <p className="text-xs text-zinc-500 mt-1">No topic has enough strong footage today.</p>
          )}
        </div>
        <button onClick={onClose} className="text-[11px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
          Close
        </button>
      </div>
      {p.degraded.length > 0 && <p className="text-[11px] text-amber-600 dark:text-amber-400">Limited information today: {p.degraded.join(' · ')}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="py-1 pr-2 font-medium">Topic</th>
              <th className="py-1 pr-2 font-medium">Score</th>
              <th className="py-1 pr-2 font-medium">Strong footage</th>
              <th className="py-1 pr-2 font-medium">Trend</th>
              <th className="py-1 pr-2 font-medium">Channel traffic</th>
              <th className="py-1 font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {p.candidates.map((c) => (
              <tr key={c.name} className="border-t border-zinc-100 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300">
                <td className="py-1 pr-2">{c.name}</td>
                <td className="py-1 pr-2 tabular-nums">{c.score}</td>
                <td className="py-1 pr-2 tabular-nums">{c.strongMoments ?? '–'}</td>
                <td className="py-1 pr-2 tabular-nums">{c.trendMatch ? `${Math.round(c.trendMatch * 100)}%` : '–'}</td>
                <td className="py-1 pr-2 tabular-nums">{c.velocityShare ? `${Math.round(c.velocityShare * 100)}%` : '–'}</td>
                <td className="py-1">{c.picked ? <b className="text-emerald-600 dark:text-emerald-400">{c.picked === 'main' ? 'Main' : 'Explore'}</b> : c.eligible === false ? <span className="text-zinc-400">{c.reason}</span> : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function BrainPanel({ b }: { b: DailyBrain }) {
  if (!b.pillars.length && !b.own) return null
  const maxLift = 1.6
  return (
    <details className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 group">
      <summary className="cursor-pointer text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2 list-none">
        <Brain className="w-4 h-4 text-amber-500" /> What the AI knows today
        <span className="font-normal text-zinc-500">— topics covered, what your channel is watched for, how fresh the trends are</span>
      </summary>
      <div className="grid md:grid-cols-2 gap-5 mt-4">
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-zinc-500">Topic areas (days since we made a reel · how they perform)</p>
          {b.pillars.map((p) => (
            <div key={p.key} className="space-y-0.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-zinc-800 dark:text-zinc-200">{p.name}</span>
                <span className="text-zinc-500 tabular-nums">
                  {p.daysSinceCovered === null ? 'never' : p.daysSinceCovered === 0 ? 'today' : `${p.daysSinceCovered}d ago`}
                  {p.posts ? ` · ${p.posts} posts` : ''}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden" title={`Performance index ${p.lift} (1 = channel average)${p.posts ? '' : ' — from your older videos, no reels posted yet'}`}>
                <div className={cn('h-full rounded-full', p.posts ? 'bg-amber-500' : 'bg-zinc-400')} style={{ width: `${Math.min(100, (p.lift / maxLift) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-3">
          {b.own && (
            <div>
              <p className="text-[11px] font-semibold text-zinc-500">
                Your channel&apos;s last 3 days ({compact(b.own.views3d)} views, through {b.own.through})
              </p>
              {b.own.byEntity.length ? (
                <ul className="mt-1 space-y-0.5">
                  {b.own.byEntity.map((e) => (
                    <li key={e.key} className="flex justify-between text-[11px] text-zinc-800 dark:text-zinc-200">
                      <span className="capitalize">{e.key}</span>
                      <span className="tabular-nums text-zinc-500">{Math.round(e.share3d * 100)}%</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-zinc-500 mt-1">No single person stands out.</p>
              )}
            </div>
          )}
          {b.trends && (
            <div>
              <p className="text-[11px] font-semibold text-zinc-500">Trends</p>
              <p className="text-[11px] text-zinc-800 dark:text-zinc-200 mt-1">
                {b.trends.usable} usable of {b.trends.count} · newest scan {b.trends.ageHours === null ? 'none' : `${b.trends.ageHours}h old`}
              </p>
            </div>
          )}
          {b.degraded.length > 0 && <p className="text-[11px] text-amber-600 dark:text-amber-400">{b.degraded.join(' · ')}</p>}
        </div>
      </div>
    </details>
  )
}
