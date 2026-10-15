'use client'

import { useState } from 'react'
import { Check, Copy, Download, ExternalLink, Loader2, RefreshCw, ThumbsDown, Undo2, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { reelMediaUrl, reelsApi, errorMessage } from '@/lib/reels-api'
import { cn } from '@/lib/utils'
import type { Reel } from '@/types/reel'
import { fmtSec, ReelStatusBadge, ROLE_COLOR, ScorePill, SHAPE_LABEL } from './reel-ui'

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
      className="px-2 py-1 rounded-lg text-[11px] font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:text-amber-500 flex items-center gap-1"
    >
      {done ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />} {label}
    </button>
  )
}

export function ReelDetailModal({
  channelId,
  reel,
  onClose,
  onChanged,
}: {
  channelId: string
  reel: Reel
  onClose: () => void
  onChanged: (r: Reel) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [postedUrl, setPostedUrl] = useState(reel.postedUrl ?? '')
  const [showPost, setShowPost] = useState(false)
  const [showReject, setShowReject] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [badMoment, setBadMoment] = useState(false)
  const p = reel.packaging
  const total = reel.clips.reduce((n, c) => n + (c.end - c.start), 0) || 1
  const descriptionFull = p ? `${p.description}\n\n${p.hashtags.join(' ')}` : ''

  const update = async (key: string, body: Parameters<typeof reelsApi.updateReel>[2], msg: string) => {
    setBusy(key)
    try {
      const r = await reelsApi.updateReel(channelId, reel.id, body)
      onChanged(r)
      toast.success(msg)
      setShowPost(false)
      setShowReject(false)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const rerender = async () => {
    setBusy('rerender')
    try {
      await reelsApi.rerender(channelId, reel.id)
      onChanged({ ...reel, status: 'queued', media: null })
      toast.success('Re-render queued')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <ReelStatusBadge status={reel.status} />
            <ScorePill value={reel.scores?.overall} />
            <span className="text-[11px] text-zinc-500">{SHAPE_LABEL[reel.shape]} · {fmtSec(reel.durationSec)}</span>
            <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">{p?.title || reel.concept}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="grid md:grid-cols-[320px_1fr] gap-5 p-5">
            {/* Player + actions */}
            <div className="space-y-3">
              <div className="aspect-[9/16] bg-black rounded-xl overflow-hidden">
                {reel.media?.video ? (
                  <video src={reelMediaUrl(reel.media.video)} poster={reelMediaUrl(reel.media.cover)} controls playsInline className="w-full h-full" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-zinc-500">
                    {reel.status === 'failed' ? reel.error || 'Render failed' : 'Rendering…'}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {reel.media?.download && (
                  <a href={reelMediaUrl(reel.media.download)} className="col-span-2 px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs flex items-center justify-center gap-1.5">
                    <Download className="w-4 h-4" /> Download MP4
                  </a>
                )}
                {reel.status === 'todo' && (
                  <>
                    <button onClick={() => setShowPost((v) => !v)} className="px-3 py-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold text-xs flex items-center justify-center gap-1.5">
                      <Upload className="w-3.5 h-3.5" /> Mark posted
                    </button>
                    <button onClick={() => setShowReject((v) => !v)} className="px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-semibold text-xs flex items-center justify-center gap-1.5">
                      <ThumbsDown className="w-3.5 h-3.5" /> Reject
                    </button>
                  </>
                )}
                {(reel.status === 'posted' || reel.status === 'rejected') && (
                  <button
                    onClick={() => update('undo', { status: 'todo' }, 'Moved back to To-do')}
                    disabled={!!busy}
                    className="px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-semibold text-xs flex items-center justify-center gap-1.5"
                  >
                    <Undo2 className="w-3.5 h-3.5" /> Back to To-do
                  </button>
                )}
                {['todo', 'failed', 'rejected'].includes(reel.status) && (
                  <button
                    onClick={rerender}
                    disabled={!!busy}
                    className="px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-semibold text-xs flex items-center justify-center gap-1.5"
                  >
                    {busy === 'rerender' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Re-render
                  </button>
                )}
              </div>

              {showPost && (
                <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-2">
                  <input
                    value={postedUrl}
                    onChange={(e) => setPostedUrl(e.target.value)}
                    placeholder="Shorts URL (optional)"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-xs dark:text-zinc-100"
                  />
                  <button
                    onClick={() => update('post', { status: 'posted', postedUrl: postedUrl.trim() || null }, 'Marked as posted')}
                    disabled={!!busy}
                    className="w-full px-3 py-2 rounded-lg bg-emerald-500 text-white font-bold text-xs"
                  >
                    {busy === 'post' ? 'Saving…' : 'Confirm posted'}
                  </button>
                </div>
              )}
              {showReject && (
                <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-2">
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    rows={2}
                    placeholder="Why? (helps the AI learn what you don't want)"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-xs dark:text-zinc-100 resize-none"
                  />
                  <label className="flex items-center gap-2 text-[11px] text-zinc-500">
                    <input type="checkbox" checked={badMoment} onChange={(e) => setBadMoment(e.target.checked)} className="accent-amber-500" />
                    The story itself is bad — never use this moment again
                  </label>
                  <button
                    onClick={() => update('reject', { status: 'rejected', rejectReason: rejectReason.trim(), rejectKind: badMoment ? 'bad_moment' : 'other' }, 'Reel rejected')}
                    disabled={!!busy}
                    className="w-full px-3 py-2 rounded-lg bg-red-500 text-white font-bold text-xs"
                  >
                    {busy === 'reject' ? 'Saving…' : 'Confirm reject'}
                  </button>
                </div>
              )}
              {reel.postedUrl && (
                <a href={reel.postedUrl} target="_blank" rel="noreferrer" className="text-[11px] text-emerald-500 flex items-center gap-1">
                  <ExternalLink className="w-3 h-3" /> {reel.postedUrl}
                </a>
              )}
            </div>

            {/* Story + packaging */}
            <div className="space-y-5 min-w-0">
              <section>
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">Structure</h3>
                <div className="flex h-2.5 rounded-full overflow-hidden">
                  {reel.clips.map((c, i) => (
                    <div key={i} className={cn(ROLE_COLOR[c.role], i > 0 && 'border-l-2 border-white dark:border-zinc-900')} style={{ width: `${((c.end - c.start) / total) * 100}%` }} title={c.role} />
                  ))}
                </div>
                <div className="mt-3 space-y-2">
                  {reel.clips.map((c, i) => (
                    <div key={i} className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-zinc-600 dark:text-zinc-300">
                          <span className={cn('w-2 h-2 rounded-full', ROLE_COLOR[c.role])} /> {c.role} · {fmtSec(c.end - c.start)}
                        </span>
                        <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="text-[11px] text-zinc-400 hover:text-amber-500 flex items-center gap-1 truncate max-w-[60%]">
                          {c.sourceTitle} @ {fmtSec(c.start)} <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      </div>
                      <p className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">{c.text}</p>
                    </div>
                  ))}
                </div>
                {reel.whyItWorks && <p className="text-[11px] text-zinc-500 mt-2"><b>Why it works:</b> {reel.whyItWorks}</p>}
              </section>

              {p && (
                <section className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">Ready-to-post copy</h3>
                  <Field label="On-screen headline" value={p.headline} />
                  <Field label="Title" value={p.title} extra={p.altTitles.length ? `Alternatives: ${p.altTitles.join('  ·  ')}` : undefined} />
                  <Field label="Description" value={descriptionFull} multiline />
                  <Field label="Tags" value={p.tags.join(', ')} />
                  <Field label="Pinned comment" value={p.pinnedComment} />
                </section>
              )}

              {reel.scores && (
                <section>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">Quality review</h3>
                  <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                    {(['hook', 'clarity', 'flow', 'payoff', 'ending', 'retention', 'safety'] as const).map((k) => (
                      <div key={k} className="p-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 text-center">
                        <p className="text-[10px] uppercase text-zinc-400">{k}</p>
                        <p className="text-sm font-bold text-zinc-800 dark:text-zinc-100">{reel.scores![k]}</p>
                      </div>
                    ))}
                  </div>
                  {reel.critique?.issues?.length ? (
                    <ul className="mt-2 text-[11px] text-zinc-500 list-disc pl-4 space-y-0.5">
                      {reel.critique.issues.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  ) : null}
                  {reel.qa?.warnings?.length ? <p className="mt-2 text-[11px] text-amber-500">Render notes: {reel.qa.warnings.join('; ')}</p> : null}
                </section>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, multiline, extra }: { label: string; value: string; multiline?: boolean; extra?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-semibold text-zinc-500">{label}</span>
        <CopyButton text={value} label="Copy" />
      </div>
      <div className={cn('px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-800 dark:text-zinc-200', multiline && 'whitespace-pre-wrap')}>
        {value || '—'}
      </div>
      {extra && <p className="text-[11px] text-zinc-400 mt-1">{extra}</p>}
    </div>
  )
}
