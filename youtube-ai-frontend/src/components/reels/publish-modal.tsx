'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock, Info, Loader2, Send, ShieldAlert, X } from 'lucide-react'
import { toast } from 'sonner'
import { errorMessage, reelMediaUrl, reelsApi } from '@/lib/reels-api'
import { cn } from '@/lib/utils'
import type { Reel } from '@/types/reel'
import type { PostMetadata, PreflightResponse, Privacy, PublishIssue, ReelPost } from '@/types/publishing'

const CATEGORIES: Array<[string, string]> = [
  ['22', 'People & Blogs'],
  ['25', 'News & Politics'],
  ['27', 'Education'],
  ['24', 'Entertainment'],
  ['28', 'Science & Technology'],
  ['1', 'Film & Animation'],
  ['23', 'Comedy'],
  ['10', 'Music'],
  ['17', 'Sports'],
  ['26', 'Howto & Style'],
]

const PRIVACY: Array<{ id: Privacy; label: string; hint: string }> = [
  { id: 'private', label: 'Private', hint: 'Only you can see it' },
  { id: 'unlisted', label: 'Unlisted', hint: 'Anyone with the link' },
  { id: 'public', label: 'Public', hint: 'Live on the channel' },
]

const splitTags = (t: string) => t.split(',').map((x) => x.trim()).filter(Boolean)
const splitHash = (t: string) => t.split(/\s+/).map((x) => x.trim()).filter(Boolean)

function IssueList({ issues }: { issues: PublishIssue[] }) {
  if (!issues.length) return null
  return (
    <ul className="space-y-1.5">
      {issues.map((i, n) => (
        <li
          key={`${i.code}-${n}`}
          className={cn(
            'flex gap-2 p-2.5 rounded-lg text-[11px] leading-relaxed',
            i.level === 'error' ? 'bg-red-500/10 text-red-500' : i.level === 'warning' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
          )}
        >
          {i.level === 'error' ? <ShieldAlert className="w-4 h-4 shrink-0" /> : i.level === 'warning' ? <AlertTriangle className="w-4 h-4 shrink-0" /> : <Info className="w-4 h-4 shrink-0" />}
          <span>{i.message}</span>
        </li>
      ))}
    </ul>
  )
}

export function PublishModal({
  channelId,
  reel,
  onClose,
  onPublished,
}: {
  channelId: string
  reel: Reel
  onClose: () => void
  onPublished: (post: ReelPost) => void
}) {
  const [meta, setMeta] = useState<PostMetadata | null>(null)
  const [tagsText, setTagsText] = useState('')
  const [hashText, setHashText] = useState('')
  const [scheduleOn, setScheduleOn] = useState(false)
  const [localWhen, setLocalWhen] = useState('')
  const [pf, setPf] = useState<PreflightResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // What would be sent right now.
  const effective: PostMetadata | null = useMemo(() => {
    if (!meta) return null
    const when = scheduleOn && localWhen ? new Date(localWhen) : null
    return {
      ...meta,
      tags: splitTags(tagsText),
      hashtags: splitHash(hashText),
      scheduleAt: when && !Number.isNaN(when.getTime()) ? when.toISOString() : null,
    }
  }, [meta, tagsText, hashText, scheduleOn, localWhen])

  // Initial load: defaults come from the AI packaging.
  useEffect(() => {
    let alive = true
    reelsApi
      .preflight(channelId, reel.id, { platform: 'youtube' })
      .then((r) => {
        if (!alive) return
        setPf(r)
        setMeta(r.defaults)
        setTagsText(r.defaults.tags.join(', '))
        setHashText(r.defaults.hashtags.join(' '))
      })
      .catch((err) => alive && setLoadError(errorMessage(err)))
    return () => {
      alive = false
    }
  }, [channelId, reel.id])

  // Live checks as the person edits (debounced).
  const effectiveKey = effective ? JSON.stringify(effective) : ''
  useEffect(() => {
    if (!effective) return
    let alive = true
    const t = setTimeout(() => {
      reelsApi
        .preflight(channelId, reel.id, { platform: 'youtube', metadata: effective })
        .then((r) => alive && setPf(r))
        .catch(() => undefined)
    }, 500)
    return () => {
      alive = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveKey, channelId, reel.id])

  const set = <K extends keyof PostMetadata>(k: K, v: PostMetadata[K]) => setMeta((m) => (m ? { ...m, [k]: v } : m))
  const categories = useMemo(() => {
    const list = [...CATEGORIES]
    if (meta && !list.some(([id]) => id === meta.categoryId)) list.push([meta.categoryId, `Category ${meta.categoryId}`])
    return list
  }, [meta])

  const blocking = (pf?.issues ?? []).some((i) => i.level === 'error')
  const scheduleReady = !scheduleOn || !!effective?.scheduleAt
  const canSubmit = !!effective && !!pf && !blocking && confirmed && scheduleReady && !busy

  const submit = async () => {
    if (!effective) return
    setBusy(true)
    setSubmitError(null)
    try {
      const post = await reelsApi.publish(channelId, reel.id, { platform: 'youtube', metadata: effective, confirm: true })
      toast.success(scheduleOn ? 'Scheduled — uploading now, it goes live at the chosen time' : 'Upload started')
      onPublished(post)
    } catch (err) {
      setSubmitError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const titleLen = meta?.title.length ?? 0
  const whenLabel = effective?.scheduleAt ? new Date(effective.scheduleAt).toLocaleString() : ''

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Send className="w-5 h-5 text-amber-500" />
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">Publish to YouTube Shorts</h2>
            {pf?.account.displayName && <span className="text-xs text-zinc-500">· {pf.account.displayName}</span>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loadError ? (
          <div className="p-6 text-sm text-red-500">{loadError}</div>
        ) : !meta || !pf ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-5 grid md:grid-cols-[160px_1fr] gap-5">
              <div className="space-y-2">
                {reel.media?.cover && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={reelMediaUrl(reel.media.cover)} alt="" className="w-full rounded-xl aspect-[9/16] object-cover bg-black" />
                )}
                <p className="text-[11px] text-zinc-500">{Math.round(reel.durationSec)}s · 1080×1920</p>
              </div>

              <div className="space-y-4 min-w-0">
                <div>
                  <div className="flex justify-between">
                    <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1">Title</label>
                    <span className={cn('text-[11px]', titleLen > 100 ? 'text-red-500' : 'text-zinc-400')}>{titleLen}/100</span>
                  </div>
                  <input
                    value={meta.title}
                    onChange={(e) => set('title', e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-sm dark:text-zinc-100 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1">Description</label>
                  <textarea
                    value={meta.description}
                    onChange={(e) => set('description', e.target.value)}
                    rows={5}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-xs dark:text-zinc-100 focus:outline-none focus:border-amber-500 resize-y"
                  />
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1">Hashtags</label>
                    <input
                      value={hashText}
                      onChange={(e) => setHashText(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-xs dark:text-zinc-100"
                    />
                    <p className="text-[10px] text-zinc-400 mt-1">#shorts is always added.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1">Category</label>
                    <select
                      value={meta.categoryId}
                      onChange={(e) => set('categoryId', e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-xs dark:text-zinc-100"
                    >
                      {categories.map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1">Tags (comma separated)</label>
                  <input
                    value={tagsText}
                    onChange={(e) => setTagsText(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-xs dark:text-zinc-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1">Visibility</label>
                  <div className="grid grid-cols-3 gap-2">
                    {PRIVACY.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => set('privacy', p.id)}
                        className={cn(
                          'p-2.5 rounded-xl border text-left transition',
                          meta.privacy === p.id ? 'border-amber-500 bg-amber-500/10' : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-400',
                        )}
                      >
                        <p className="text-xs font-bold text-zinc-800 dark:text-zinc-100">{p.label}</p>
                        <p className="text-[10px] text-zinc-500">{p.hint}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-2">
                  <label className="flex items-center gap-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300 cursor-pointer">
                    <input type="checkbox" checked={scheduleOn} onChange={(e) => setScheduleOn(e.target.checked)} className="accent-amber-500" />
                    <CalendarClock className="w-4 h-4 text-violet-500" /> Schedule for later
                  </label>
                  {scheduleOn && (
                    <div className="space-y-1">
                      <input
                        type="datetime-local"
                        value={localWhen}
                        onChange={(e) => setLocalWhen(e.target.value)}
                        className="px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-xs dark:text-zinc-100"
                      />
                      <p className="text-[11px] text-zinc-500">
                        The video uploads now as private, and YouTube makes it public at {whenLabel || 'the time you choose'} (your local time).
                      </p>
                    </div>
                  )}
                  {meta.privacy === 'public' && !scheduleOn && (
                    <label className="flex items-center gap-2 text-[11px] text-zinc-500 cursor-pointer">
                      <input type="checkbox" checked={meta.notifySubscribers} onChange={(e) => set('notifySubscribers', e.target.checked)} className="accent-amber-500" />
                      Notify subscribers
                    </label>
                  )}
                </div>

                <IssueList issues={pf.issues} />
                {submitError && <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-500">{submitError}</div>}
              </div>
            </div>

            <div className="px-5 py-3 border-t border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400 cursor-pointer">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="accent-amber-500" />
                I checked this and want to publish it
              </label>
              <div className="flex gap-2">
                <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  Cancel
                </button>
                <button
                  onClick={submit}
                  disabled={!canSubmit}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-bold text-sm flex items-center gap-2"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {scheduleOn ? 'Schedule on YouTube' : `Publish now (${meta.privacy})`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
