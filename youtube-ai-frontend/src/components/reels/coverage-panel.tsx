'use client'

import { useEffect, useState } from 'react'
import { Brain, Gem, Loader2, Users } from 'lucide-react'
import { reelsApi } from '@/lib/reels-api'
import type { Coverage, Insights } from '@/types/reel'
import { compact, timeAgo } from './reel-ui'

/** "What has already been made" — the memory that keeps campaigns from repeating themselves. */
export function CoveragePanel({ channelId, onPickEntity }: { channelId: string; onPickEntity?: (slug: string, name: string) => void }) {
  const [coverage, setCoverage] = useState<Coverage | null>(null)
  const [insights, setInsights] = useState<Insights | null>(null)
  const [period, setPeriod] = useState<'week' | 'month'>('week')

  useEffect(() => {
    if (!channelId) return
    let alive = true
    Promise.all([reelsApi.coverage(channelId), reelsApi.insights(channelId, period)])
      .then(([c, i]) => {
        if (!alive) return
        setCoverage(c)
        setInsights(i)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [channelId, period])

  if (!coverage) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Activity</h3>
        <div className="flex rounded-lg bg-zinc-100 dark:bg-zinc-800 p-0.5">
          {(['week', 'month'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 rounded-md text-xs font-semibold ${period === p ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm' : 'text-zinc-500'}`}
            >
              This {p}
            </button>
          ))}
        </div>
      </div>

      {insights && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Stat label="Reels made" value={insights.reelsCreated} />
          <Stat label="Posted" value={insights.reelsPosted} />
          <Stat label="Waiting in To-do" value={insights.reelsByStatus.todo ?? 0} />
          <Stat label="Rejected" value={insights.reelsByStatus.rejected ?? 0} />
          <Stat label="Minutes analyzed" value={insights.usage.transcribedMinutes} />
        </div>
      )}

      {coverage && (
        <>
          <div className="flex items-center gap-3 p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
            <span className="p-2.5 rounded-xl bg-violet-500/10 text-violet-500">
              <Brain className="w-5 h-5" />
            </span>
            <div className="flex-1">
              <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Moment bank</p>
              <p className="text-xs text-zinc-500">
                {compact(coverage.momentBank.unused)} unused reel-worthy moments · {compact(coverage.momentBank.used)} already used ·{' '}
                {coverage.momentBank.retired} retired. New campaigns reuse unused moments first and never repeat used ones.
              </p>
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
              <Users className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Coverage by person / topic</h3>
            </div>
            {coverage.entities.length === 0 ? (
              <p className="p-6 text-xs text-zinc-500">Nothing yet — coverage builds up as campaigns run.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-zinc-400">
                    <tr>
                      <th className="text-left px-4 py-2">Name</th>
                      <th className="text-right px-3 py-2">Reels</th>
                      <th className="text-right px-3 py-2">Posted</th>
                      <th className="text-right px-3 py-2">To-do</th>
                      <th className="text-right px-3 py-2">Rejected</th>
                      <th className="text-right px-3 py-2">Last made</th>
                      <th className="text-right px-4 py-2">Unused strong moments</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coverage.entities.map((e) => (
                      <tr
                        key={e.slug}
                        onClick={() => onPickEntity?.(e.slug, e.name)}
                        className="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 cursor-pointer"
                      >
                        <td className="px-4 py-2 font-semibold text-zinc-800 dark:text-zinc-200">{e.name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{e.total}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-500">{e.posted}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-indigo-500">{e.todo}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-zinc-400">{e.rejected}</td>
                        <td className="px-3 py-2 text-right text-zinc-500">{timeAgo(e.last)}</td>
                        <td className="px-4 py-2 text-right">
                          <span className="inline-flex items-center gap-1 font-semibold text-amber-500">
                            <Gem className="w-3 h-3" /> {e.untappedStrongMoments}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
      <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">{label}</p>
      <p className="text-xl font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">{value.toLocaleString()}</p>
    </div>
  )
}
