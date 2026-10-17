'use client'

import { useEffect, useState } from 'react'
import { ExternalLink, Eye, Heart, Lock, MessageCircle, TrendingDown, TrendingUp, Minus, Hourglass } from 'lucide-react'
import { reelsApi } from '@/lib/reels-api'
import { cn } from '@/lib/utils'
import type { CampaignPerformance as Perf, PlatformId } from '@/types/publishing'
import { compact, PLATFORM_LABEL, timeAgo } from './reel-ui'

const ALL_PLATFORMS: PlatformId[] = ['youtube', 'instagram', 'facebook', 'x', 'linkedin']
const LIVE: PlatformId[] = ['youtube']

const VERDICT = {
  better: { icon: TrendingUp, cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20', title: 'Doing better than your other campaigns', hint: 'Worth making more reels on this topic.' },
  similar: { icon: Minus, cls: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20', title: 'About the same as your other campaigns', hint: 'Steady. Try a new angle to push it further.' },
  worse: { icon: TrendingDown, cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20', title: 'Below your other campaigns so far', hint: 'Consider a different angle or stronger hooks.' },
  not_enough_data: { icon: Hourglass, cls: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20', title: 'Not enough views yet to compare', hint: 'Publish a few reels and check back in a day or two.' },
} as const

/** How this campaign's published reels are doing: views, per platform, best reels and a plain verdict. */
export function CampaignPerformance({ channelId, campaignId, refreshKey = 0 }: { channelId: string; campaignId: string; refreshKey?: number }) {
  const [data, setData] = useState<{ key: string; perf: Perf | null }>({ key: '', perf: null })
  const key = `${campaignId}:${refreshKey}`

  useEffect(() => {
    let alive = true
    reelsApi
      .campaignPerformance(channelId, campaignId)
      .then((perf) => alive && setData({ key, perf }))
      .catch(() => alive && setData({ key, perf: null }))
    return () => {
      alive = false
    }
  }, [channelId, campaignId, key])

  const p = data.perf
  if (!p) return null
  const v = VERDICT[p.comparison.verdict]
  const maxViews = Math.max(1, ...p.byPlatform.map((x) => x.views))

  return (
    <section className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">How this campaign is doing</h2>
        {p.lastUpdated && <span className="text-[11px] text-zinc-400">numbers updated {timeAgo(p.lastUpdated)}</span>}
      </div>

      {p.totals.posts === 0 ? (
        <p className="text-xs text-zinc-500">
          Nothing published yet{p.totals.pending ? ` (${p.totals.pending} on the way)` : ''}. Open a reel and press <b>Publish</b>. Its views will show up here.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Big icon={<Eye className="w-4 h-4" />} label="Views" value={compact(p.totals.views)} accent />
            <Big icon={<Heart className="w-4 h-4" />} label="Likes" value={compact(p.totals.likes)} />
            <Big icon={<MessageCircle className="w-4 h-4" />} label="Comments" value={compact(p.totals.comments)} />
            <Big label="Reels published" value={`${p.totals.reelsPublished} of ${p.totals.reelsReady}`} />
          </div>

          <div className={cn('flex items-start gap-3 p-3 rounded-xl border', v.cls)}>
            <v.icon className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="text-xs">
              <p className="font-bold">{v.title}</p>
              <p className="opacity-80">
                {v.hint}
                {p.comparison.verdict !== 'not_enough_data' && p.comparison.channelAvg !== null && (
                  <>
                    {' '}
                    ({compact(p.comparison.campaignAvg)} vs {compact(p.comparison.channelAvg)} {p.comparison.basis === 'first_day' ? 'first-day views' : 'views'} per post)
                  </>
                )}
              </p>
            </div>
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Views by platform</p>
            <div className="space-y-1.5">
              {ALL_PLATFORMS.map((id) => {
                const row = p.byPlatform.find((x) => x.platform === id)
                const live = LIVE.includes(id)
                return (
                  <div key={id} className="flex items-center gap-3 text-xs">
                    <span className={cn('w-20 shrink-0 font-semibold', live ? 'text-zinc-800 dark:text-zinc-200' : 'text-zinc-400')}>{PLATFORM_LABEL[id]}</span>
                    {row ? (
                      <>
                        <div className="flex-1 h-2.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                          <div className="h-full rounded-full bg-amber-500" style={{ width: `${Math.max(3, (row.views / maxViews) * 100)}%` }} />
                        </div>
                        <span className="w-28 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                          {compact(row.views)} views · {row.posts} {row.posts === 1 ? 'post' : 'posts'}
                        </span>
                      </>
                    ) : live ? (
                      <span className="text-zinc-400">no posts yet</span>
                    ) : (
                      <span className="flex items-center gap-1 text-zinc-400">
                        <Lock className="w-3 h-3" /> coming soon
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {p.reels.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Best reels</p>
              <ol className="space-y-1">
                {p.reels.slice(0, 5).map((r, i) => (
                  <li key={r.reelId} className="flex items-center gap-2 text-xs">
                    <span className="w-4 text-zinc-400 tabular-nums">{i + 1}.</span>
                    <span className="flex-1 truncate text-zinc-800 dark:text-zinc-200">{r.title}</span>
                    <span className="tabular-nums text-zinc-500 flex items-center gap-1">
                      <Eye className="w-3 h-3" /> {compact(r.views)}
                    </span>
                    {r.platforms[0]?.url && (
                      <a href={r.platforms[0].url} target="_blank" rel="noreferrer" className="text-zinc-400 hover:text-amber-500" title="Open post">
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}
          <p className="text-[10px] text-zinc-400">New posts keep gaining views for a few days. Numbers refresh automatically.</p>
        </>
      )}
    </section>
  )
}

function Big({ icon, label, value, accent }: { icon?: React.ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <div className={cn('p-3 rounded-xl', accent ? 'bg-amber-500/10' : 'bg-zinc-50 dark:bg-zinc-800/50')}>
      <p className="text-[10px] uppercase tracking-wider text-zinc-500 flex items-center gap-1">
        {icon} {label}
      </p>
      <p className={cn('text-xl font-bold tabular-nums', accent ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-900 dark:text-zinc-100')}>{value}</p>
    </div>
  )
}
