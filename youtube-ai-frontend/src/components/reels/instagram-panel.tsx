'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Eye, Heart, Loader2, MessageCircle, PauseCircle, RefreshCw } from 'lucide-react'
import { reelsApi } from '@/lib/reels-api'
import { cn } from '@/lib/utils'
import type { InstagramOverview, PostStatus } from '@/types/publishing'
import { compact, timeAgo } from './reel-ui'

type Recent = InstagramOverview['recent'][number]

/** Failed, cancelled and removed posts are an ops matter (developer report), not something the client sees. */
const SHOWN: PostStatus[] = ['published', 'queued', 'uploading', 'processing', 'scheduled', 'blocked']
const isLive = (s: PostStatus) => s === 'published'

/** The client's Instagram account: followers, today's posting, totals and the latest reels. Read-only: posting is automatic. */
export function InstagramPanel({ channelId }: { channelId: string }) {
  const [data, setData] = useState<InstagramOverview | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => {
    setRefreshing(true)
    setTick((t) => t + 1)
  }, [])

  useEffect(() => {
    if (!channelId) return
    let alive = true
    reelsApi
      .instagramOverview(channelId)
      .then((d) => alive && setData(d))
      // Any failure (route not deployed yet, service restarting) keeps the last numbers, or shows a calm "not available"
      // when there are none. It is never shown as an error.
      .catch(() => undefined)
      .finally(() => {
        if (!alive) return
        setLoaded(true)
        setRefreshing(false)
      })
    return () => {
      alive = false
    }
  }, [channelId, tick])

  // Keep the numbers fresh while this tab is open.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  if (!loaded) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
      </div>
    )
  }

  if (!data) {
    return (
      <Notice title="Instagram numbers are not available right now" body="They will appear here as soon as they are ready. You do not need to do anything.">
        <RefreshButton onClick={refresh} spinning={refreshing} />
      </Notice>
    )
  }

  if (!data.connected || data.state === 'missing') {
    return (
      <Notice title="Instagram is not connected" body="Connect the Facebook login that owns your Instagram account and its reels will be posted and tracked here.">
        <Link href="/settings" className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold">
          Connect it in Settings
        </Link>
      </Notice>
    )
  }

  const { account, lanes, totals } = data
  const recent = data.recent.filter((r) => SHOWN.includes(r.status))
  const needsReconnect = data.state === 'needs_reconnect'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-9 h-9 rounded-xl bg-pink-500/10 text-pink-500 flex items-center justify-center text-xs font-extrabold leading-none">IG</span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">{account?.name ?? 'Instagram account'}</p>
          <p className="text-xs text-zinc-500">
            {account?.followers != null ? `${account.followers.toLocaleString()} followers` : 'Followers will appear shortly'}
            {account?.fetchedAt ? ` · updated ${timeAgo(account.fetchedAt)}` : ''}
          </p>
        </div>
        {needsReconnect && (
          <Link href="/settings" className="px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-semibold">
            Reconnect in Settings
          </Link>
        )}
        {lanes.paused && (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-500/10 text-zinc-500 text-xs font-semibold">
            <PauseCircle className="w-3.5 h-3.5" /> Instagram posting is paused
          </span>
        )}
        <div className="ml-auto">
          <RefreshButton onClick={refresh} spinning={refreshing} />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Posted today" value={`${lanes.postedToday}`} hint={lanes.dailyCap ? `of ${lanes.dailyCap} a day at most` : undefined} />
        <Stat label="Older reels waiting" value={compact(lanes.backlogRemaining)} hint={lanes.backlogPerDay ? `${lanes.backlogPerDay} go out each day` : undefined} />
        <Stat label="Reels posted" value={compact(totals.posts)} />
        <Stat label="Total views" value={compact(totals.views)} hint={`${compact(totals.likes)} likes · ${compact(totals.comments)} comments`} accent />
      </div>

      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">Latest Instagram reels</h3>
        {recent.length === 0 ? (
          <div className="text-center py-12 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-800 text-zinc-400">
            <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">No Instagram reels yet</p>
            <p className="text-xs mt-1">New reels are posted here automatically.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {recent.map((r) => (
              <ReelRow key={r.postId} r={r} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function ReelRow({ r }: { r: Recent }) {
  const live = isLive(r.status)
  return (
    <li className="p-3 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 line-clamp-2">{r.title}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px] text-zinc-500">
            <span className={cn('px-2 py-0.5 rounded-md font-semibold', live ? 'bg-emerald-500/10 text-emerald-500' : 'bg-sky-500/10 text-sky-500')}>
              {live ? 'Published' : 'On its way'}
            </span>
            {r.publishedAt && <span>{timeAgo(r.publishedAt)}</span>}
            {live && (
              <>
                <span className="flex items-center gap-1">
                  <Eye className="w-3 h-3" /> {r.views != null ? compact(r.views) : '—'}
                </span>
                <span className="flex items-center gap-1">
                  <Heart className="w-3 h-3" /> {r.likes != null ? compact(r.likes) : '—'}
                </span>
                <span className="flex items-center gap-1">
                  <MessageCircle className="w-3 h-3" /> {r.comments != null ? compact(r.comments) : '—'}
                </span>
              </>
            )}
          </div>
        </div>
        {r.url && (
          <a href={r.url} target="_blank" rel="noreferrer" title="Open on Instagram" className="shrink-0 p-1.5 rounded-lg text-zinc-400 hover:text-amber-500">
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
      </div>
    </li>
  )
}

function Stat({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className="p-3.5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
      <p className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</p>
      <p className={cn('text-2xl font-bold tabular-nums mt-0.5', accent ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-900 dark:text-zinc-100')}>{value}</p>
      {hint && <p className="text-[11px] text-zinc-400 mt-0.5">{hint}</p>}
    </div>
  )
}

function RefreshButton({ onClick, spinning }: { onClick: () => void; spinning: boolean }) {
  return (
    <button onClick={onClick} title="Refresh" className="p-1.5 rounded-lg text-zinc-400 hover:text-amber-500">
      <RefreshCw className={cn('w-4 h-4', spinning && 'animate-spin')} />
    </button>
  )
}

function Notice({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-800 text-zinc-400 gap-3">
      <span className="w-10 h-10 rounded-xl bg-pink-500/10 text-pink-500 flex items-center justify-center text-sm font-extrabold leading-none">IG</span>
      <div>
        <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{title}</p>
        <p className="text-xs mt-1 max-w-sm">{body}</p>
      </div>
      {children}
    </div>
  )
}
