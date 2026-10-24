'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, Eye, Heart, Loader2, MessageCircle, Plus, RefreshCw, RotateCcw, Square } from 'lucide-react'
import { toast } from 'sonner'
import { errorMessage, reelsApi } from '@/lib/reels-api'
import type { Reel } from '@/types/reel'
import type { PlatformId, ReelPost } from '@/types/publishing'
import { compact, PLATFORM_LABEL, PostStatusBadge, timeAgo } from './reel-ui'
import { fmtNYDateTime } from '@/lib/time'

const ACTIVE = ['queued', 'uploading', 'processing', 'blocked']
const PLATFORM_CHOICES: PlatformId[] = ['youtube', 'instagram', 'facebook', 'x', 'linkedin']

/** Where this reel has gone (or is going), with live status and the latest numbers. */
export function PostsPanel({
  channelId,
  reel,
  reloadKey,
  onReelChanged,
}: {
  channelId: string
  reel: Reel
  reloadKey: number
  onReelChanged: (r: Reel) => void
}) {
  const [posts, setPosts] = useState<ReelPost[] | null>(null)
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [showManual, setShowManual] = useState(false)
  const [manualPlatform, setManualPlatform] = useState<PlatformId>('instagram')
  const [manualUrl, setManualUrl] = useState('')
  const refresh = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    let alive = true
    reelsApi
      .reelPosts(channelId, reel.id)
      .then((p) => alive && setPosts(p))
      .catch(() => alive && setPosts((prev) => prev ?? []))
    return () => {
      alive = false
    }
  }, [channelId, reel.id, tick, reloadKey])

  const active = !!posts?.some((p) => ACTIVE.includes(p.status))
  useEffect(() => {
    if (!active) return
    const t = setInterval(refresh, 4000)
    return () => clearInterval(t)
  }, [active, refresh])

  // Once something is published the reel itself becomes "posted": pull the fresh reel (once, not in a loop).
  const live = !!posts?.some((p) => p.status === 'published' || p.status === 'scheduled')
  const onChangedRef = useRef(onReelChanged)
  useEffect(() => {
    onChangedRef.current = onReelChanged
  })
  useEffect(() => {
    if (!live || reel.status !== 'todo') return
    let alive = true
    reelsApi
      .getReel(channelId, reel.id)
      .then((r) => alive && onChangedRef.current(r))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [live, reel.status, reel.id, channelId])

  const act = async (key: string, fn: () => Promise<{ message?: string } | unknown>, ok: string) => {
    setBusy(key)
    try {
      const res = (await fn()) as { message?: string; ok?: boolean } | undefined
      toast[res && res.ok === false ? 'error' : 'success'](res?.message || ok)
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const addManual = async () => {
    if (!manualUrl.trim()) return toast.error('Paste the link to the post first')
    await act('manual', () => reelsApi.addManualPost(channelId, reel.id, { platform: manualPlatform, url: manualUrl.trim() }), 'Post recorded')
    setManualUrl('')
    setShowManual(false)
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">Published on</h3>
        <button onClick={() => setShowManual((v) => !v)} className="text-[11px] font-semibold text-zinc-500 hover:text-amber-500 flex items-center gap-1">
          <Plus className="w-3 h-3" /> Add a post made elsewhere
        </button>
      </div>

      {showManual && (
        <div className="mb-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 flex flex-wrap gap-2">
          <select
            value={manualPlatform}
            onChange={(e) => setManualPlatform(e.target.value as PlatformId)}
            className="px-2 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-xs dark:text-zinc-100"
          >
            {PLATFORM_CHOICES.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABEL[p]}
              </option>
            ))}
          </select>
          <input
            value={manualUrl}
            onChange={(e) => setManualUrl(e.target.value)}
            placeholder="Link to the post"
            className="flex-1 min-w-[180px] px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-xs dark:text-zinc-100"
          />
          <button onClick={addManual} disabled={busy === 'manual'} className="px-3 py-2 rounded-lg bg-zinc-800 dark:bg-zinc-100 text-white dark:text-black text-xs font-bold">
            Save
          </button>
          <p className="w-full text-[10px] text-zinc-400">YouTube links are tracked automatically; other platforms are recorded without numbers for now.</p>
        </div>
      )}

      {posts && <ReelTotals posts={posts} />}

      {posts === null ? (
        <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
      ) : posts.length === 0 ? (
        <p className="text-xs text-zinc-500">Not published anywhere yet. Use <b>Publish</b> to upload it to YouTube.</p>
      ) : (
        <ul className="space-y-2">
          {posts.map((p) => (
            <li key={p.id} className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-zinc-800 dark:text-zinc-100">{PLATFORM_LABEL[p.platform]}</span>
                <PostStatusBadge status={p.status} />
                {p.source === 'manual' && <span className="text-[10px] text-zinc-400">added manually</span>}
                {p.privacy && p.source === 'api' && <span className="text-[10px] text-zinc-400">{p.scheduleAt ? `scheduled ${fmtNYDateTime(p.scheduleAt)}` : p.privacy}</span>}
                <span className="ml-auto text-[10px] text-zinc-400">{timeAgo(p.publishedAt ?? p.createdAt)}</span>
              </div>

              {p.status === 'uploading' && (
                <div className="h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                  <div className="h-full bg-amber-500 transition-all" style={{ width: `${Math.round(p.progress * 100)}%` }} />
                </div>
              )}
              {p.error && p.status !== 'published' && (
                <p className="text-[11px] text-red-500">
                  {p.error}
                  {p.status === 'blocked' && p.blockedUntil ? ` (resumes ${fmtNYDateTime(p.blockedUntil)})` : ''}
                </p>
              )}
              {p.warnings.map((w, i) => (
                <p key={i} className="text-[11px] text-amber-600 dark:text-amber-400">{w}</p>
              ))}

              <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
                {p.url && (
                  <a href={p.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-emerald-500 hover:underline truncate max-w-[220px]">
                    <ExternalLink className="w-3 h-3 shrink-0" /> Open post
                  </a>
                )}
                {p.latestMetrics && (
                  <>
                    <span className="flex items-center gap-1"><Eye className="w-3 h-3" /> {compact(p.latestMetrics.views)}</span>
                    {p.latestMetrics.likes !== undefined && <span className="flex items-center gap-1"><Heart className="w-3 h-3" /> {compact(p.latestMetrics.likes)}</span>}
                    {p.latestMetrics.comments !== undefined && <span className="flex items-center gap-1"><MessageCircle className="w-3 h-3" /> {compact(p.latestMetrics.comments)}</span>}
                  </>
                )}
                <span className="ml-auto flex gap-1.5">
                  {['queued', 'blocked', 'uploading'].includes(p.status) && (
                    <button onClick={() => act(`c${p.id}`, () => reelsApi.cancelPost(channelId, p.id), 'Cancelled')} disabled={!!busy} className="px-2 py-1 rounded-md bg-zinc-200/70 dark:bg-zinc-700/60 hover:text-red-500 flex items-center gap-1">
                      <Square className="w-3 h-3" /> Cancel
                    </button>
                  )}
                  {['failed', 'blocked'].includes(p.status) && !p.externalId && (
                    <button onClick={() => act(`r${p.id}`, () => reelsApi.retryPost(channelId, p.id), 'Retrying')} disabled={!!busy} className="px-2 py-1 rounded-md bg-zinc-200/70 dark:bg-zinc-700/60 hover:text-amber-500 flex items-center gap-1">
                      <RotateCcw className="w-3 h-3" /> Retry
                    </button>
                  )}
                  {p.status === 'published' && p.externalId && (
                    <button onClick={() => act(`m${p.id}`, () => reelsApi.refreshPostMetrics(channelId, p.id), 'Numbers refreshed')} disabled={!!busy} className="px-2 py-1 rounded-md bg-zinc-200/70 dark:bg-zinc-700/60 hover:text-amber-500 flex items-center gap-1">
                      {busy === `m${p.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Refresh
                    </button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Views for this reel across every platform it was published on. */
function ReelTotals({ posts }: { posts: ReelPost[] }) {
  const live = posts.filter((p) => p.status === 'published')
  if (!live.length) return null
  const measured = live.filter((p) => p.latestMetrics)
  const sum = (k: 'views' | 'likes' | 'comments') => measured.reduce((n, p) => n + (p.latestMetrics?.[k] ?? 0), 0)
  const byPlatform = new Map<PlatformId, { views: number; tracked: boolean }>()
  for (const p of live) {
    const prev = byPlatform.get(p.platform) ?? { views: 0, tracked: false }
    byPlatform.set(p.platform, { views: prev.views + (p.latestMetrics?.views ?? 0), tracked: prev.tracked || !!p.latestMetrics })
  }
  return (
    <div className="mb-3 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-1">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Total views</p>
          <p className="text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">{measured.length ? compact(sum('views')) : '—'}</p>
        </div>
        <span className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300 pb-1">
          <Heart className="w-3.5 h-3.5" /> {compact(sum('likes'))} likes
        </span>
        <span className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300 pb-1">
          <MessageCircle className="w-3.5 h-3.5" /> {compact(sum('comments'))} comments
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {[...byPlatform.entries()].map(([platform, v]) => (
          <span key={platform} className="px-2 py-0.5 rounded-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-[11px] text-zinc-600 dark:text-zinc-300">
            <b>{PLATFORM_LABEL[platform]}</b> {v.tracked ? `${compact(v.views)} views` : 'no numbers yet'}
          </span>
        ))}
      </div>
      {!measured.length && <p className="text-[11px] text-zinc-500 mt-1">Numbers appear about an hour after publishing.</p>}
    </div>
  )
}
