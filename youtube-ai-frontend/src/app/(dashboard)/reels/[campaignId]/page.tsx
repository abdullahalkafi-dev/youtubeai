'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle2, CircleDashed, ExternalLink, Loader2, Plus, RotateCcw, Sparkles, Square, Trash2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useAppSelector } from '@/store/hooks'
import { ACTIVE_CAMPAIGN_STATUSES, reelsApi, errorMessage } from '@/lib/reels-api'
import { cn } from '@/lib/utils'
import type { CampaignDetail, Reel, ReelServiceStatus } from '@/types/reel'
import { ReelCard } from '@/components/reels/reel-card'
import { ReelDetailModal } from '@/components/reels/reel-detail-modal'
import { YouTubeConnectBanner } from '@/components/reels/youtube-connect'
import { CampaignPerformance } from '@/components/reels/campaign-performance'
import { CampaignChat } from '@/components/reels/campaign-chat'
import { LinkVideoCard } from '@/components/reels/link-video-card'
import { DeleteCampaignDialog } from '@/components/reels/delete-campaign-dialog'
import { CampaignStatusBadge, compact, fmtSec, timeAgo } from '@/components/reels/reel-ui'

const STAGES: Array<{ id: string; label: string }> = [
  { id: 'researching', label: 'Research' },
  { id: 'sourcing', label: 'Find videos' },
  { id: 'preparing', label: 'Transcribe & mine' },
  { id: 'composing', label: 'Edit & review' },
  { id: 'rendering', label: 'Render' },
]
const ORDER = ['queued', 'researching', 'sourcing', 'preparing', 'composing', 'rendering', 'completed']

const SOURCE_STAGE: Record<string, string> = {
  queued: 'Queued',
  downloading: 'Downloading',
  downloaded: 'Downloaded',
  transcribing: 'Transcribing',
  mining: 'Finding moments',
  ready: 'Ready',
  blocked: 'Waiting for YouTube',
  failed: 'Skipped',
}

export default function CampaignPage() {
  const { campaignId } = useParams<{ campaignId: string }>()
  const channelId = useAppSelector((s) => s.auth.activeChannelId) || ''
  const [c, setC] = useState<CampaignDetail | null>(null)
  const [status, setStatus] = useState<ReelServiceStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openReel, setOpenReel] = useState<Reel | null>(null)
  const [busy, setBusy] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const router = useRouter()

  // Bumping the tick re-fetches; state is only set from async callbacks.
  const [tick, setTick] = useState(0)
  const load = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (!channelId || !campaignId) return
    let alive = true
    reelsApi
      .getCampaign(channelId, campaignId)
      .then((d) => {
        if (!alive) return
        setC(d)
        setError(null)
      })
      .catch((err) => alive && setError(errorMessage(err)))
    reelsApi
      .status()
      .then((s) => alive && setStatus(s))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [channelId, campaignId, tick])

  const active = !!c && ((ACTIVE_CAMPAIGN_STATUSES as readonly string[]).includes(c.status) || c.reels.some((r) => r.status === 'queued' || r.status === 'rendering'))
  useEffect(() => {
    if (!active) return
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [active, load])

  const cancel = async () => {
    if (!c || !window.confirm('Stop this campaign? Finished reels are kept.')) return
    setBusy(true)
    try {
      await reelsApi.cancelCampaign(channelId, c.id)
      load()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const topUp = async () => {
    if (!c) return
    setBusy(true)
    try {
      const r = await reelsApi.topUp(channelId, c.id)
      toast.success(`Looking for ${r.adding} more reel${r.adding === 1 ? '' : 's'} in the unreviewed moments`)
      load()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const refreshLook = async () => {
    if (!c) return
    const n = c.reels.filter((r) => r.status === 'todo').length
    if (!confirm(`Re-make ${n} reel${n === 1 ? '' : 's'} that are not posted yet with the latest voice and pictures? It takes about a minute per reel.`)) return
    setBusy(true)
    try {
      const r = await reelsApi.refreshLook(channelId, c.id)
      toast.success(`${r.queued} reels are being refreshed`)
      load()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const retry = async () => {
    if (!c) return
    setBusy(true)
    try {
      const r = await reelsApi.retryFailed(channelId, c.id)
      toast.success(`${r.retried} renders queued again`)
      load()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (!c) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        {error ? <p className="text-sm text-red-500">{error}</p> : <Loader2 className="w-6 h-6 animate-spin text-amber-500 mx-auto mt-16" />}
      </div>
    )
  }

  const stageIdx = ORDER.indexOf(c.status)
  const failedReels = c.reels.filter((r) => r.status === 'failed' && r.error !== 'Campaign cancelled').length
  const tokens = (c.usage?.promptTokens ?? 0) + (c.usage?.completionTokens ?? 0)

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="min-w-0">
          <Link href="/reels" className="text-xs text-zinc-500 hover:text-amber-500 flex items-center gap-1 mb-2">
            <ArrowLeft className="w-3.5 h-3.5" /> All campaigns
          </Link>
          <div className="flex items-center gap-2">
            <CampaignStatusBadge status={c.status} />
            <span className="text-[11px] text-zinc-400">started {timeAgo(c.createdAt)}</span>
          </div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mt-1">{c.name}</h1>
          <p className="text-xs text-zinc-500 mt-1">{c.brief}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          {(c.status === 'partial' || c.status === 'completed') && !active && (
            <button onClick={topUp} disabled={busy} className="px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" />
              {c.reels.filter((r) => ['todo', 'posted', 'queued', 'rendering'].includes(r.status)).length < c.settings.targetReels ? 'Find more reels' : 'Make 3 more'}
            </button>
          )}
          {!active && c.reels.some((r) => r.status === 'todo') && (
            <button onClick={refreshLook} disabled={busy} title="Re-make the reels that are not posted yet with the latest voice and pictures" className="px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> Refresh look
            </button>
          )}
          {failedReels > 0 && !active && (
            <button onClick={retry} disabled={busy} className="px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
              <RotateCcw className="w-3.5 h-3.5" /> Retry {failedReels} failed
            </button>
          )}
          {!active && (
            <button onClick={() => setShowDelete(true)} disabled={busy} title="Delete this campaign" className="px-3 py-2 rounded-xl bg-red-500/10 text-red-500 text-xs font-semibold flex items-center gap-1.5 hover:bg-red-500/20">
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          )}
          {(ACTIVE_CAMPAIGN_STATUSES as readonly string[]).includes(c.status) && (
            <button onClick={cancel} disabled={busy} className="px-3 py-2 rounded-xl bg-red-500/10 text-red-500 text-xs font-semibold flex items-center gap-1.5">
              <Square className="w-3.5 h-3.5" /> Stop
            </button>
          )}
        </div>
      </div>

      <YouTubeConnectBanner status={status} onFixed={load} />

      {/* Stage tracker */}
      <div className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
        <div className="grid grid-cols-5 gap-2">
          {STAGES.map((s) => {
            const idx = ORDER.indexOf(s.id)
            const done = stageIdx > idx || ['completed', 'partial'].includes(c.status)
            const current = c.status === s.id
            return (
              <div key={s.id} className="flex flex-col items-center text-center gap-1.5">
                {done ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                ) : current ? (
                  <Loader2 className="w-5 h-5 text-amber-500 animate-spin" />
                ) : c.status === 'failed' || c.status === 'cancelled' ? (
                  <XCircle className="w-5 h-5 text-zinc-300 dark:text-zinc-700" />
                ) : (
                  <CircleDashed className="w-5 h-5 text-zinc-300 dark:text-zinc-700" />
                )}
                <span className={cn('text-[11px] font-semibold', current ? 'text-amber-500' : done ? 'text-zinc-700 dark:text-zinc-300' : 'text-zinc-400')}>{s.label}</span>
              </div>
            )
          })}
        </div>
        <p className={cn('text-xs mt-4 text-center', c.status === 'failed' ? 'text-red-500' : 'text-zinc-500')}>{c.error || c.progress?.message}</p>
        <p className="text-[10px] mt-1 text-center text-zinc-400">
          AI usage: {compact(tokens)} tokens{c.usage?.costUsd ? ` (about $${c.usage.costUsd.toFixed(2)})` : ''} · {Math.round((c.usage?.sttSeconds ?? 0) / 60)} min transcribed
          {c.stats?.candidates ? ` · ${c.stats.candidates} reel ideas reviewed, ${c.stats.kept} kept` : ''}
        </p>
      </div>

      {c.origin === 'video' && c.reels.length > 0 && <LinkVideoCard channelId={channelId} campaignId={c.id} />}

      {/* How it is doing (published reels) */}
      {c.reels.some((r) => r.status === 'todo' || r.status === 'posted') && <CampaignPerformance channelId={channelId} campaignId={c.id} refreshKey={tick} />}

      {/* Reels */}
      {c.reels.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 mb-3">Reels ({c.reels.length})</h2>
          {c.explore ? (
            // A daily campaign: today's main topic, then the explore topic (a different kind of story, so we learn what else works)
            <div className="space-y-6">
              {(['main', 'explore'] as const).map((track) => {
                const list = c.reels.filter((r) => (r.track ?? 'main') === track)
                if (!list.length && track === 'main') return null
                return (
                  <div key={track}>
                    <div className="mb-2">
                      <p className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                        {track === 'main' ? 'Main topic' : 'Explore topic'}
                        <span className="font-normal text-zinc-500"> — {(track === 'main' ? c.name : c.explore!.name).replace(/^Daily [^:]*?(\(explore\))?:\s*/, '')}</span>
                      </p>
                      <p className="text-[11px] text-zinc-500 line-clamp-2">{track === 'main' ? c.brief : c.explore!.brief}</p>
                      {track === 'explore' && !list.length && <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">{c.explore!.error ? c.explore!.error : c.explore!.progress?.message ?? 'Working…'}</p>}
                    </div>
                    {list.length > 0 && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                        {list.map((r) => (
                          <ReelCard key={r.id} reel={r} onOpen={setOpenReel} />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {c.reels.map((r) => (
                <ReelCard key={r.id} reel={r} onOpen={setOpenReel} />
              ))}
            </div>
          )}
        </section>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Sources */}
        <section className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
          <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 mb-3">Source videos ({c.sources.length})</h2>
          {c.sources.length === 0 ? (
            <p className="text-xs text-zinc-500">Chosen after research.</p>
          ) : (
            <ul className="space-y-2.5">
              {c.sources.map((s) => (
                <li key={s.youtubeId} className="flex items-start gap-3">
                  <span
                    className={cn(
                      'mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap',
                      s.stage === 'ready' ? 'bg-emerald-500/10 text-emerald-500' : s.stage === 'failed' ? 'bg-zinc-500/10 text-zinc-400' : s.stage === 'blocked' ? 'bg-amber-500/10 text-amber-500' : 'bg-indigo-500/10 text-indigo-500',
                    )}
                  >
                    {SOURCE_STAGE[s.stage] ?? s.stage}
                  </span>
                  <div className="min-w-0">
                    <a href={`https://youtu.be/${s.youtubeId}`} target="_blank" rel="noreferrer" className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 hover:text-amber-500 line-clamp-1">
                      {s.title} <ExternalLink className="w-3 h-3 inline" />
                    </a>
                    <p className="text-[11px] text-zinc-500 line-clamp-2">
                      {compact(s.viewCount)} views · {fmtSec(s.durationSec)} {s.fromBank ? '· reused from bank' : ''} {s.momentCount ? `· ${s.momentCount} moments` : ''} — {s.reason}
                    </p>
                    {s.stage === 'failed' && s.stageError && <p className="text-[10px] text-zinc-400 line-clamp-1">{s.stageError}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Research */}
        <section className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
          <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 mb-3">What&apos;s working right now</h2>
          {!c.research ? (
            <p className="text-xs text-zinc-500">Research in progress…</p>
          ) : (
            <div className="space-y-3 text-xs text-zinc-600 dark:text-zinc-400">
              <p>{c.research.topicSummary}</p>
              {c.research.angles?.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1">Angles</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {c.research.angles.slice(0, 6).map((a, i) => (
                      <li key={i}>
                        <b className="text-zinc-700 dark:text-zinc-300">{a.angle}</b> — {a.whyItWorks}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {c.research.hookPatterns?.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1">Hook patterns</p>
                  <div className="flex flex-wrap gap-1.5">
                    {c.research.hookPatterns.slice(0, 8).map((h, i) => (
                      <span key={i} className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800">{h}</span>
                    ))}
                  </div>
                </div>
              )}
              {c.research.webSources?.length > 0 && (
                <p className="text-[10px] text-zinc-400">
                  Sources:{' '}
                  {c.research.webSources.slice(0, 6).map((s, i) => (
                    <a key={i} href={s.url} target="_blank" rel="noreferrer" className="hover:text-amber-500 mr-2 underline">
                      {s.title.slice(0, 40)}
                    </a>
                  ))}
                </p>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Why these reels — every idea and what happened to it */}
      {c.candidates?.length > 0 && (
        <section className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Reel ideas reviewed ({c.candidates.length})</h2>
            <p className="text-[11px] text-zinc-400">
              {c.stats.momentsShown ? `${c.stats.momentsShown} of ${c.stats.momentsAvailable} mined moments seen · ${c.stats.rounds} round(s) · ` : ''}
              {c.candidates.filter((x) => x.outcome === 'kept').length} kept
            </p>
          </div>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800 max-h-96 overflow-y-auto">
            {c.candidates.map((x) => (
              <li key={`${x.round}-${x.ref}`} className="py-2 flex gap-3">
                <span
                  className={cn(
                    'mt-0.5 h-fit px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap',
                    x.outcome === 'kept' ? 'bg-emerald-500/10 text-emerald-500' : x.outcome === 'spare' ? 'bg-sky-500/10 text-sky-500' : 'bg-zinc-500/10 text-zinc-400',
                  )}
                >
                  {x.outcome === 'kept' ? 'Kept' : x.outcome === 'spare' ? 'Spare' : 'Dropped'}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                    {x.concept} <span className="font-normal text-zinc-400">· round {x.round} · {fmtSec(x.durationSec)}{x.overall !== null ? ` · score ${x.overall}` : ''}{x.revised ? ' · revised' : ''}</span>
                  </p>
                  <p className="text-[11px] text-zinc-500">{x.reason}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Log */}
      <section className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
        <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 mb-3">Activity</h2>
        <ul className="space-y-1 max-h-64 overflow-y-auto font-mono">
          {[...c.log].reverse().map((l, i) => (
            <li key={i} className={cn('text-[11px]', l.level === 'error' ? 'text-red-500' : l.level === 'warn' ? 'text-amber-500' : 'text-zinc-500')}>
              <span className="text-zinc-400">{new Date(l.at).toLocaleTimeString()}</span> {l.msg}
            </li>
          ))}
        </ul>
      </section>

      <CampaignChat channelId={channelId} campaignId={c.id} campaignName={c.name} />
      {showDelete && (
        <DeleteCampaignDialog
          channelId={channelId}
          campaignId={c.id}
          name={c.name}
          onClose={() => setShowDelete(false)}
          onDeleted={() => router.push('/reels')}
        />
      )}

      {openReel && (
        <ReelDetailModal
          channelId={channelId}
          reel={openReel}
          onClose={() => setOpenReel(null)}
          onChanged={(r) => {
            setOpenReel(r)
            setC((prev) => (prev ? { ...prev, reels: prev.reels.map((x) => (x.id === r.id ? r : x)) } : prev))
          }}
        />
      )}
    </div>
  )
}
