'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Clapperboard, Film, Inbox, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useAppSelector } from '@/store/hooks'
import { ACTIVE_CAMPAIGN_STATUSES, reelsApi, errorMessage } from '@/lib/reels-api'
import type { CampaignSummary, Reel, ReelServiceStatus, ReelStatus } from '@/types/reel'
import { NewCampaignModal } from '@/components/reels/new-campaign-modal'
import { YouTubeConnectBanner } from '@/components/reels/youtube-connect'
import { ReelCard } from '@/components/reels/reel-card'
import { ReelDetailModal } from '@/components/reels/reel-detail-modal'
import { CoveragePanel } from '@/components/reels/coverage-panel'
import { AccountsBar } from '@/components/reels/accounts-bar'
import { PerformancePanel } from '@/components/reels/performance-panel'
import { DailyPanel } from '@/components/reels/daily-panel'
import { DeleteCampaignDialog } from '@/components/reels/delete-campaign-dialog'
import { CampaignStatusBadge, compact, timeAgo } from '@/components/reels/reel-ui'

type Tab = 'campaigns' | 'daily' | 'library' | 'performance' | 'coverage'
const LIBRARY_FILTERS: Array<{ id: ReelStatus | 'all'; label: string }> = [
  { id: 'todo', label: 'To-do' },
  { id: 'posted', label: 'Posted' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'all', label: 'All' },
]

export default function ReelsPage() {
  const channelId = useAppSelector((s) => s.auth.activeChannelId) || ''
  const [tab, setTab] = useState<Tab>('campaigns')
  const [status, setStatus] = useState<ReelServiceStatus | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([])
  const [reels, setReels] = useState<Reel[]>([])
  const [reelTotal, setReelTotal] = useState(0)
  const [filter, setFilter] = useState<ReelStatus | 'all'>('todo')
  const [period, setPeriod] = useState<'7d' | '30d' | 'all'>('all')
  const [entity, setEntity] = useState<{ slug: string; name: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [openReel, setOpenReel] = useState<Reel | null>(null)
  const [deleting, setDeleting] = useState<CampaignSummary | null>(null)

  // Bumping a tick re-runs the matching fetch effect (state is only set from async callbacks).
  const [tick, setTick] = useState(0)
  const [libTick, setLibTick] = useState(0)
  const refresh = useCallback(() => setTick((t) => t + 1), [])
  const refreshLibrary = useCallback(() => setLibTick((t) => t + 1), [])

  useEffect(() => {
    if (!channelId) return
    let alive = true
    Promise.all([
      reelsApi.status().then((s) => alive && setStatus(s)).catch(() => undefined),
      reelsApi
        .listCampaigns(channelId)
        .then((list) => {
          if (!alive) return
          setCampaigns(list)
          setError(null)
        })
        .catch((err) => alive && setError(errorMessage(err))),
    ]).finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [channelId, tick])

  useEffect(() => {
    if (tab !== 'library' || !channelId) return
    let alive = true
    reelsApi
      .listReels(channelId, { status: filter === 'all' ? undefined : filter, period, entity: entity?.slug, limit: 60 })
      .then((res) => {
        if (!alive) return
        setReels(res.items)
        setReelTotal(res.total)
      })
      .catch((err) => alive && setError(errorMessage(err)))
    return () => {
      alive = false
    }
  }, [tab, channelId, filter, period, entity, libTick])

  // Live progress while anything is running.
  const anyActive = campaigns.some((c) => (ACTIVE_CAMPAIGN_STATUSES as readonly string[]).includes(c.status))
  useEffect(() => {
    if (!anyActive) return
    const t = setInterval(refresh, 5000)
    return () => clearInterval(t)
  }, [anyActive, refresh])

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-amber-500/10 text-amber-500">
              <Clapperboard className="w-6 h-6" />
            </span>
            <span>Reels Studio</span>
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Campaigns research what is working, mine your own videos, and build hook → story → payoff reels. Finished reels wait in To-do.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          disabled={status?.enabled === false}
          className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold text-sm flex items-center gap-2 transition active:scale-95 shadow-md"
        >
          <Plus className="w-4 h-4" /> New campaign
        </button>
      </div>

      <YouTubeConnectBanner status={status} onFixed={refresh} />
      {channelId && <AccountsBar channelId={channelId} />}
      {status?.enabled === false && (
        <div className="p-3 rounded-xl bg-zinc-500/10 text-xs text-zinc-500">Reel generation is currently turned off by the administrator.</div>
      )}
      {error && <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-500">{error}</div>}

      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {(
          [
            ['campaigns', 'Campaigns'],
            ['daily', 'Daily reels'],
            ['library', 'Reel library'],
            ['performance', 'Performance'],
            ['coverage', 'Coverage & insights'],
          ] as Array<[Tab, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition ${tab === id ? 'border-amber-500 text-zinc-900 dark:text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'campaigns' &&
        (loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
          </div>
        ) : campaigns.length === 0 ? (
          <Empty icon={<Clapperboard className="w-8 h-8" />} title="No campaigns yet" body="Start one with a topic, a person or a theme — e.g. “viral reels about prison intake”." />
        ) : (
          <div className="space-y-3">
            {campaigns.map((c) => (
              <Link
                key={c.id}
                href={`/reels/${c.id}`}
                className="block p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-amber-500/60 transition"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <CampaignStatusBadge status={c.status} />
                      {c.origin === 'daily' && <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400">Daily</span>}
                      {c.origin === 'video' && <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-violet-500/10 text-violet-600 dark:text-violet-400">Your upload</span>}
                      <span className="text-[11px] text-zinc-400">{timeAgo(c.createdAt)}</span>
                    </div>
                    <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100 mt-1.5 truncate">{c.name}</p>
                    <p className="text-xs text-zinc-500 mt-0.5 truncate">{c.blockedReason === 'youtube_login_required' ? 'Waiting for YouTube reconnect' : c.progress?.message}</p>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    {!!c.performance?.posts && (
                      <div className="text-right">
                        <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{compact(c.performance.views)}</p>
                        <p className="text-[10px] uppercase tracking-wider text-zinc-400">views</p>
                      </div>
                    )}
                    <div className="text-right">
                      <p className="text-lg font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">
                        {(c.reelCounts.todo ?? 0) + (c.reelCounts.posted ?? 0)}
                        <span className="text-xs text-zinc-400 font-normal">/{c.settings.targetReels}</span>
                      </p>
                      <p className="text-[10px] uppercase tracking-wider text-zinc-400">reels ready</p>
                    </div>
                    {!(ACTIVE_CAMPAIGN_STATUSES as readonly string[]).includes(c.status) && (
                      <button
                        type="button"
                        title="Delete this campaign"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setDeleting(c)
                        }}
                        className="p-1.5 rounded-lg text-zinc-300 hover:text-red-500 hover:bg-red-500/10"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                    <ChevronRight className="w-4 h-4 text-zinc-400" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ))}

      {tab === 'library' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {LIBRARY_FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${filter === f.id ? 'bg-amber-500 text-black' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'}`}
              >
                {f.label}
              </button>
            ))}
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as typeof period)}
              className="px-3 py-1.5 rounded-lg text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-0"
            >
              <option value="all">All time</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
            </select>
            {entity && (
              <button onClick={() => setEntity(null)} className="px-3 py-1.5 rounded-lg text-xs bg-violet-500/10 text-violet-500 font-semibold">
                {entity.name} ✕
              </button>
            )}
            <span className="text-xs text-zinc-400 ml-auto">{reelTotal} reels</span>
            <button onClick={refreshLibrary} className="p-1.5 rounded-lg text-zinc-400 hover:text-amber-500">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
          {reels.length === 0 ? (
            <Empty icon={<Inbox className="w-8 h-8" />} title="Nothing here" body="Reels appear here when campaigns finish rendering." />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {reels.map((r) => (
                <ReelCard key={r.id} reel={r} onOpen={setOpenReel} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'daily' && channelId && <DailyPanel channelId={channelId} />}

      {tab === 'performance' && channelId && <PerformancePanel channelId={channelId} />}

      {tab === 'coverage' && channelId && (
        <CoveragePanel
          channelId={channelId}
          onPickEntity={(slug, name) => {
            setEntity({ slug, name })
            setFilter('all')
            setTab('library')
          }}
        />
      )}

      {deleting && channelId && (
        <DeleteCampaignDialog
          channelId={channelId}
          campaignId={deleting.id}
          name={deleting.name}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setCampaigns((prev) => prev.filter((x) => x.id !== deleting.id))
            setDeleting(null)
            refresh()
          }}
        />
      )}

      {showNew && (
        <NewCampaignModal
          channelId={channelId}
          onClose={() => setShowNew(false)}
          onCreated={(c) => {
            setShowNew(false)
            setCampaigns((prev) => [c, ...prev])
            setTab('campaigns')
          }}
        />
      )}
      {openReel && (
        <ReelDetailModal
          channelId={channelId}
          reel={openReel}
          onClose={() => setOpenReel(null)}
          onChanged={(r) => {
            setOpenReel(r)
            setReels((prev) => prev.map((x) => (x.id === r.id ? r : x)))
          }}
        />
      )}
    </div>
  )
}

function Empty({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-800 text-zinc-400">
      {icon ?? <Film className="w-8 h-8" />}
      <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mt-3">{title}</p>
      <p className="text-xs mt-1 max-w-sm">{body}</p>
    </div>
  )
}
