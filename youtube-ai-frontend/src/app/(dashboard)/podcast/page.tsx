'use client'

import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, Loader2, Plus, Podcast, RefreshCw, Rss } from 'lucide-react'
import { useAppSelector } from '@/store/hooks'
import { errorMessage } from '@/lib/reels-api'
import { podcastApi, youtubeIdFrom, type PodcastEpisodeRow, type PodcastStatus } from '@/lib/podcast-api'
import { cn } from '@/lib/utils'
import { compact, timeAgo } from '@/components/reels/reel-ui'

/** What the client sees. Failed episodes are a developer matter (ops alert), so they never appear here. */
const STAGE_LABEL: Record<string, string> = {
  audio: 'Preparing the audio',
  meta: 'Writing the details',
  create: 'Creating the episode',
  upload: 'Uploading the audio',
  processing: 'Buzzsprout is processing it',
  chapters: 'Adding chapters',
  publish: 'Publishing',
}

const minutes = (sec: number) => `${Math.max(1, Math.round(sec / 60))} min`

export default function PodcastPage() {
  const channelId = useAppSelector((s) => s.auth.activeChannelId) || ''
  const [status, setStatus] = useState<PodcastStatus | null>(null)
  const [episodes, setEpisodes] = useState<PodcastEpisodeRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [tick, setTick] = useState(0)
  const [link, setLink] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [addedNote, setAddedNote] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setRefreshing(true)
    setTick((t) => t + 1)
  }, [])

  useEffect(() => {
    if (!channelId) return
    let alive = true
    Promise.all([podcastApi.status(channelId), podcastApi.episodes(channelId)])
      .then(([s, e]) => {
        if (!alive) return
        setStatus(s)
        setEpisodes(e.episodes)
        setUnavailable(false)
      })
      .catch(() => alive && setUnavailable(true))
      .finally(() => {
        if (!alive) return
        setLoaded(true)
        setRefreshing(false)
      })
    return () => {
      alive = false
    }
  }, [channelId, tick])

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  const add = async () => {
    const id = youtubeIdFrom(link)
    setAddError(null)
    setAddedNote(null)
    if (!id) {
      setAddError('Paste a YouTube link or the 11-character video id.')
      return
    }
    setAdding(true)
    try {
      await podcastApi.add(channelId, id)
      setLink('')
      setAddedNote('Added. It will appear below and go live on the podcast when it is ready.')
      refresh()
    } catch (err) {
      setAddError(errorMessage(err))
    } finally {
      setAdding(false)
    }
  }

  const shown = episodes.filter((e) => e.status === 'uploaded' || e.status === 'processing' || e.status === 'queued')
  const published = status?.counts.uploaded ?? 0
  const inProgress = (status?.counts.processing ?? 0) + (status?.counts.queued ?? 0)

  if (!loaded) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center">
          <Podcast className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Podcast</h1>
          <p className="text-xs text-zinc-500 truncate">{status?.show?.title ?? 'Your long videos, published as podcast episodes on Buzzsprout'}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {status?.show?.rssUrl && (
            <a href={status.show.rssUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-zinc-500 hover:text-amber-500 bg-zinc-500/10">
              <Rss className="w-3.5 h-3.5" /> RSS feed
            </a>
          )}
          <button onClick={refresh} title="Refresh" className="p-1.5 rounded-lg text-zinc-400 hover:text-amber-500">
            <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
          </button>
        </div>
      </div>

      {unavailable && !status ? (
        <div className="text-center py-16 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-800 text-zinc-400">
          <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Podcast numbers are not available right now</p>
          <p className="text-xs mt-1">They will appear here as soon as they are ready. You do not need to do anything.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Episodes published" value={compact(published)} accent />
            <Stat label="On their way" value={String(inProgress)} />
            <Stat
              label="New videos"
              value={status?.enabled && status.auto ? 'Automatic' : 'Manual'}
              hint={status?.enabled && status.auto ? `Videos over ${Math.round((status?.minDurationSec ?? 600) / 60)} min go live by themselves` : 'Add a video below'}
            />
            <Stat label="Latest episode" value={status?.latest?.publishedAt ? timeAgo(status.latest.publishedAt) : '—'} hint={status?.latest?.title} />
          </div>

          <div className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
            <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Put a video on the podcast</p>
            <p className="text-xs text-zinc-500 mt-0.5">Paste a YouTube link. The audio is cleaned (long silences shortened), the details and chapters come from the video, and the episode goes live.</p>
            <div className="mt-3 flex flex-col sm:flex-row gap-2">
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !adding && add()}
                placeholder="https://www.youtube.com/watch?v=…"
                className="flex-1 px-3 py-2 rounded-lg text-sm bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-amber-500"
              />
              <button
                onClick={add}
                disabled={adding || !link.trim()}
                className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black text-sm font-bold"
              >
                {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add
              </button>
            </div>
            {addError && <p className="text-xs text-red-500 mt-2">{addError}</p>}
            {addedNote && <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2">{addedNote}</p>}
          </div>

          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">Episodes</h2>
            {shown.length === 0 ? (
              <div className="text-center py-12 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-800 text-zinc-400">
                <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">No episodes yet</p>
                <p className="text-xs mt-1">New long videos become podcast episodes here.</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {shown.map((e) => (
                  <EpisodeCard key={e.youtubeId} e={e} />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function EpisodeCard({ e }: { e: PodcastEpisodeRow }) {
  const live = e.status === 'uploaded'
  const a = e.audio
  return (
    <li className="p-3.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 line-clamp-2">{e.meta?.title ?? e.title}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px] text-zinc-500">
            <span className={cn('px-2 py-0.5 rounded-md font-semibold', live ? 'bg-emerald-500/10 text-emerald-500' : 'bg-sky-500/10 text-sky-500')}>
              {live ? 'Live on the podcast' : (e.stage && STAGE_LABEL[e.stage]) || 'Waiting its turn'}
            </span>
            {live && e.buzzsprout?.publishedAt && <span>{timeAgo(e.buzzsprout.publishedAt)}</span>}
            {a && <span>{minutes(a.durationSec)}</span>}
            {a && a.removedSec >= 30 && <span>{minutes(a.removedSec)} of silence removed</span>}
            {e.meta && e.meta.chapters.length > 0 && <span>{e.meta.chapters.length} chapters</span>}
            {e.videoViews != null && <span>{compact(e.videoViews)} views on YouTube</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {e.buzzsprout?.pageUrl && (
            <a href={e.buzzsprout.pageUrl} target="_blank" rel="noreferrer" title="Open the episode page" className="p-1.5 rounded-lg text-zinc-400 hover:text-amber-500">
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
        </div>
      </div>
    </li>
  )
}

function Stat({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className="p-3.5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
      <p className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</p>
      <p className={cn('text-2xl font-bold tabular-nums mt-0.5', accent ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-900 dark:text-zinc-100')}>{value}</p>
      {hint && <p className="text-[11px] text-zinc-400 mt-0.5 line-clamp-2">{hint}</p>}
    </div>
  )
}
