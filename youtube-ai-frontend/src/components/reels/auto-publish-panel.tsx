'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, Compass, ExternalLink, Loader2, Rocket, Send, Settings2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { errorMessage, reelsApi } from '@/lib/reels-api'
import { cn } from '@/lib/utils'
import type { AutoPublishItem, AutoPublishOverview } from '@/types/publishing'
import { compact } from './reel-ui'

const STATUS: Record<AutoPublishItem['status'], { label: string; cls: string }> = {
  queued: { label: 'Waiting for its time', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-400' },
  uploading: { label: 'Uploading…', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  processing: { label: 'YouTube is processing', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  scheduled: { label: 'Scheduled', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-400' },
  published: { label: 'Published', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  failed: { label: 'Failed', cls: 'bg-red-500/10 text-red-600 dark:text-red-400' },
  cancelled: { label: 'Cancelled', cls: 'bg-zinc-500/10 text-zinc-500' },
  blocked: { label: 'Waiting (blocked)', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  removed: { label: 'Removed on YouTube', cls: 'bg-red-500/10 text-red-600 dark:text-red-400' },
}

const nyTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
const localTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
/** value for <input type="datetime-local"> in the viewer's own time zone */
const toLocalInput = (iso: string) => {
  const d = new Date(iso)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

/** Auto-publish: the day's good reels go to YouTube by themselves at times the AI chooses; every one can still be moved, published now or cancelled. */
export function AutoPublishPanel({ channelId }: { channelId: string }) {
  const [data, setData] = useState<AutoPublishOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [slots, setSlots] = useState('')
  const [minScore, setMinScore] = useState(75)
  const [maxPerDay, setMaxPerDay] = useState(7)
  const [tick, setTick] = useState(0)

  const apply = useCallback((d: AutoPublishOverview) => {
    setData(d)
    setSlots(d.settings.slots.join(', '))
    setMinScore(d.settings.minScore)
    setMaxPerDay(d.settings.maxPerDay)
  }, [])

  useEffect(() => {
    let alive = true
    reelsApi
      .autoPublish(channelId)
      .then((d) => alive && (apply(d), setError(null)))
      .catch((err) => alive && setError(errorMessage(err)))
    return () => {
      alive = false
    }
  }, [channelId, tick, apply])

  const waiting = !!data?.today?.items.some((i) => ['queued', 'uploading', 'processing'].includes(i.status))
  useEffect(() => {
    if (!waiting) return
    const t = setInterval(() => setTick((x) => x + 1), 30_000)
    return () => clearInterval(t)
  }, [waiting])

  const run = async (key: string, fn: () => Promise<AutoPublishOverview>, ok?: string) => {
    setBusy(key)
    try {
      apply(await fn())
      if (ok) toast.success(ok)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const toggle = () => {
    if (!data) return
    if (!data.settings.enabled) {
      const slotsText = data.settings.slots.join(', ')
      if (
        !confirm(
          `Turn on Auto-publish?\n\nEach morning, after the daily reels are made, the good ones (score ${data.settings.minScore}+) are posted to YouTube as ${data.settings.privacy.toUpperCase()} videos by themselves, at these New York times: ${slotsText}.\n\n` +
            'Until a reel\'s upload starts you can cancel it, move it or publish it right away. The system pauses itself if YouTube flags something or results collapse. Nothing is ever deleted from YouTube by this app.\n\n' +
            'Public posts of clips from long videos can draw copyright claims. Continue?',
        )
      )
        return
    }
    void run('toggle', () => reelsApi.setAutoPublish(channelId, { enabled: !data.settings.enabled }), data.settings.enabled ? 'Auto-publish turned off' : 'Auto-publish is on')
  }

  const saveSettings = () =>
    run(
      'save',
      () =>
        reelsApi.setAutoPublish(channelId, {
          slots: slots
            .split(/[,\s]+/)
            .map((s) => s.trim())
            .filter(Boolean),
          minScore,
          maxPerDay,
        }),
      'Saved',
    )

  const move = (it: AutoPublishItem) => {
    const v = prompt(`New time for “${it.title}” (your local time, YYYY-MM-DD HH:mm)`, toLocalInput(it.runAt).replace('T', ' '))
    if (!v) return
    const d = new Date(v.replace(' ', 'T'))
    if (Number.isNaN(d.getTime())) return toast.error('That time is not valid')
    void run(`move-${it.postId}`, () => reelsApi.autoPublishMove(channelId, it.postId, d.toISOString()), 'Moved')
  }

  if (error) return <div className="p-3 rounded-xl bg-red-500/10 text-xs text-red-500">{error}</div>
  if (!data)
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="w-5 h-5 animate-spin text-amber-500" />
      </div>
    )

  const { settings, today } = data
  const canPlan = settings.enabled && !settings.pausedReason && !today

  return (
    <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Rocket className="w-4 h-4 text-amber-500" /> Auto-publish to YouTube
          </h3>
          <p className="text-[11px] text-zinc-500 mt-1">
            {settings.enabled
              ? `On — good reels (score ${settings.minScore}+) go out as ${settings.privacy} videos at ${settings.slots.join(', ')} New York time, in a changing order so we learn which times work. You can still cancel, move or publish any of them yourself until its upload starts.`
              : 'Off — nothing is posted unless you publish it yourself. Turn it on and the day’s good reels go out by themselves at the times below.'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setOpen((o) => !o)} className="p-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300" title="Settings">
            <Settings2 className="w-4 h-4" />
          </button>
          <button
            onClick={toggle}
            disabled={busy === 'toggle'}
            role="switch"
            aria-checked={settings.enabled}
            className={cn('relative w-14 h-8 rounded-full transition', settings.enabled ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-700')}
            title={settings.enabled ? 'On — click to turn off' : 'Off — click to turn on'}
          >
            <span className={cn('absolute top-1 w-6 h-6 rounded-full bg-white shadow transition-all', settings.enabled ? 'left-7' : 'left-1')} />
          </button>
        </div>
      </div>

      {settings.pausedReason && (
        <div className="px-3 py-2 rounded-xl bg-red-500/10 text-xs text-red-600 dark:text-red-400 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p>{settings.pausedReason}</p>
            <button onClick={() => run('resume', () => reelsApi.setAutoPublish(channelId, { resume: true }), 'Resumed')} disabled={busy === 'resume'} className="mt-1 font-semibold underline">
              I have checked it — resume
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className="grid sm:grid-cols-3 gap-3 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50">
          <label className="text-[11px] text-zinc-500 sm:col-span-3">
            Times (New York, comma separated)
            <input value={slots} onChange={(e) => setSlots(e.target.value)} className="mt-1 w-full px-2 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100" placeholder="08:00, 12:00, 17:00, 20:00, 21:00" />
          </label>
          <label className="text-[11px] text-zinc-500">
            Minimum reel score (0–100)
            <input type="number" min={0} max={100} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} className="mt-1 w-full px-2 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100" />
          </label>
          <label className="text-[11px] text-zinc-500">
            Most posts per day
            <input type="number" min={1} max={10} value={maxPerDay} onChange={(e) => setMaxPerDay(Number(e.target.value))} className="mt-1 w-full px-2 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100" />
          </label>
          <label className="text-[11px] text-zinc-500">
            Visibility
            <select
              value={settings.privacy}
              onChange={(e) => run('privacy', () => reelsApi.setAutoPublish(channelId, { privacy: e.target.value as 'public' | 'unlisted' }), 'Saved')}
              className="mt-1 w-full px-2 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100"
            >
              <option value="public">Public</option>
              <option value="unlisted">Unlisted (check first)</option>
            </select>
          </label>
          <div className="sm:col-span-3 flex items-center justify-between">
            <p className="text-[11px] text-zinc-500">
              On 6–7 reel days {settings.extraSlots.join(' and ')} are added.{data.shortsBaseline ? ` Your usual Shorts get about ${compact(data.shortsBaseline)} views.` : ''}
            </p>
            <button onClick={saveSettings} disabled={busy === 'save'} className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-semibold disabled:opacity-50">
              Save
            </button>
          </div>
        </div>
      )}

      {/* Today's schedule */}
      {today ? (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-zinc-500">
            Today ({today.date}) {today.status === 'skipped' ? `— nothing planned: ${today.reason}` : `— ${today.items.length} planned`}
          </p>
          {today.items.map((it) => (
            <ScheduleRow key={it.postId} it={it} busy={busy} onNow={() => run(`now-${it.postId}`, () => reelsApi.autoPublishNow(channelId, it.postId), 'Uploading now')} onMove={() => move(it)} onCancel={() => confirm(`Cancel “${it.title}”? It will not be posted.`) && run(`cancel-${it.postId}`, () => reelsApi.autoPublishCancel(channelId, it.postId), 'Cancelled')} />
          ))}
          {today.held.length > 0 && (
            <div className="mt-2 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50">
              <p className="text-[11px] font-semibold text-zinc-500 mb-1">Held back (you can still publish these yourself)</p>
              {today.held.map((h) => (
                <p key={h.reelId} className="text-[11px] text-zinc-600 dark:text-zinc-300">
                  <span className="font-medium">{h.title}</span> — {h.reason}
                </p>
              ))}
            </div>
          )}
        </div>
      ) : settings.enabled && !settings.pausedReason ? (
        <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50">
          <p className="text-[11px] text-zinc-500 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> Today is planned automatically a few minutes after the daily reels are ready (checked every 10 minutes).
          </p>
          {canPlan && (
            <button onClick={() => run('plan', () => reelsApi.autoPublishPlan(channelId), 'Checked')} disabled={busy === 'plan'} className="px-3 py-1.5 rounded-lg bg-zinc-200 dark:bg-zinc-700 text-xs font-semibold text-zinc-800 dark:text-zinc-100 flex items-center gap-1.5 shrink-0">
              {busy === 'plan' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Plan now
            </button>
          )}
        </div>
      ) : null}

      {/* What the times have shown so far */}
      {data.slotReport.slots.some((s) => s.posts > 0) && (
        <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 space-y-1.5">
          <p className="text-[11px] font-semibold text-zinc-500">
            What the posting times have shown so far ({data.slotReport.observations} settled posts) — {data.slotReport.ready ? 'now favouring the better times, still testing the others' : 'still testing every time evenly'}
          </p>
          {data.slotReport.slots.map((s) => (
            <div key={s.slot} className="flex items-center gap-2 text-[11px]">
              <span className="w-12 tabular-nums text-zinc-700 dark:text-zinc-200">{s.slot}</span>
              <div className="flex-1 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                <div className="h-full bg-amber-500 rounded-full" style={{ width: `${Math.round(s.score * 100)}%` }} />
              </div>
              <span className="w-28 text-right text-zinc-500">{s.posts} posts</span>
            </div>
          ))}
          <p className="text-[10px] text-zinc-500">The bar is how a post at that time ranked against the same day&apos;s other posts (full bar = best of the day). With only a few posts per time, small differences are noise.</p>
        </div>
      )}

      {data.recent.some((d) => d.items.length) && (
        <details className="text-[11px]">
          <summary className="cursor-pointer font-semibold text-zinc-500">Earlier days</summary>
          <div className="mt-2 space-y-1.5">
            {data.recent
              .filter((d) => d.items.length)
              .map((d) => (
                <div key={d.date} className="text-zinc-600 dark:text-zinc-300">
                  <span className="font-medium">{d.date}</span>:{' '}
                  {d.items.map((i) => `${i.slot} ${i.status === 'published' || i.status === 'processing' ? `${compact(i.views ?? 0)} views` : STATUS[i.status].label.toLowerCase()}`).join(' · ')}
                </div>
              ))}
          </div>
        </details>
      )}
    </div>
  )
}

function ScheduleRow({ it, busy, onNow, onMove, onCancel }: { it: AutoPublishItem; busy: string | null; onNow: () => void; onMove: () => void; onCancel: () => void }) {
  const st = STATUS[it.status]
  const pending = it.status === 'queued'
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800">
      <div className="w-28 shrink-0">
        <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">{nyTime(it.runAt)} NY</p>
        <p className="text-[10px] text-zinc-500">{localTime(it.runAt)} your time{it.moved ? ' · moved' : ''}</p>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">{it.title}</p>
        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
          <span className={cn('px-1.5 py-0.5 rounded-md text-[10px] font-semibold', st.cls)}>{st.label}</span>
          {it.track === 'explore' && (
            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-sky-500/10 text-sky-700 dark:text-sky-400 flex items-center gap-1">
              <Compass className="w-3 h-3" /> Explore
            </span>
          )}
          {it.score !== null && <span className="text-[10px] text-zinc-500">score {Math.round(it.score)}</span>}
          {it.views !== null && it.views > 0 && <span className="text-[10px] text-zinc-500">{compact(it.views)} views</span>}
          {it.error && <span className="text-[10px] text-red-500 truncate">{it.error}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {pending && (
          <>
            <button onClick={onNow} disabled={!!busy} className="px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[11px] font-semibold flex items-center gap-1 disabled:opacity-50">
              <CheckCircle2 className="w-3 h-3" /> Publish now
            </button>
            <button onClick={onMove} disabled={!!busy} className="px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-[11px] font-semibold disabled:opacity-50">
              Move
            </button>
            <button onClick={onCancel} disabled={!!busy} className="px-2 py-1 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 text-[11px] font-semibold flex items-center gap-1 disabled:opacity-50">
              <XCircle className="w-3 h-3" /> Cancel
            </button>
          </>
        )}
        {it.url && (
          <a href={it.url} target="_blank" rel="noreferrer" className="px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-[11px] font-semibold flex items-center gap-1">
            <ExternalLink className="w-3 h-3" /> Open
          </a>
        )}
      </div>
    </div>
  )
}
