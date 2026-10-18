'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, FileVideo, Loader2, Pause, Play, UploadCloud, X } from 'lucide-react'
import { toast } from 'sonner'
import { errorMessage, reelsApi, type UploadInfo } from '@/lib/reels-api'
import { cn } from '@/lib/utils'
import type { CampaignSummary } from '@/types/reel'

const PARALLEL = 3
const MAX_TRIES = 6

const fmtBytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`)
const fmtTime = (s: number) => (!Number.isFinite(s) || s <= 0 ? '' : s < 60 ? `${Math.ceil(s)}s` : s < 3600 ? `${Math.ceil(s / 60)} min` : `${(s / 3600).toFixed(1)} h`)

type Phase = 'pick' | 'uploading' | 'paused' | 'finishing' | 'done'

/** "From my new video": pick the raw file, it uploads in resumable parts, then a campaign starts on it. */
export function UploadVideo({ channelId, onCreated, onBack }: { channelId: string; onCreated: (c: CampaignSummary) => void; onBack: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [brief, setBrief] = useState('')
  const [targetReels, setTargetReels] = useState(6)
  const [phase, setPhase] = useState<Phase>('pick')
  const [sent, setSent] = useState(0)
  const [speed, setSpeed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const ctrl = useRef<AbortController | null>(null)
  const info = useRef<UploadInfo | null>(null)

  // Leaving the page while uploading loses progress for this tab (it can resume with the same file later).
  useEffect(() => {
    if (phase !== 'uploading' && phase !== 'finishing') return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [phase])
  useEffect(() => () => ctrl.current?.abort(), [])

  const pick = (f: File | null) => {
    if (!f) return
    if (!f.type.startsWith('video/') && !/\.(mp4|mov|m4v|mkv|webm|avi|mxf|mts|m2ts)$/i.test(f.name)) return setError('Please choose a video file.')
    setError(null)
    setFile(f)
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '))
  }

  const run = async () => {
    if (!file) return
    setError(null)
    setPhase('uploading')
    const abort = new AbortController()
    ctrl.current = abort
    try {
      const up = info.current ?? (await reelsApi.startUpload(channelId, { fileName: file.name, size: file.size, title: title.trim() || undefined }))
      info.current = up
      const done = new Set(up.received)
      let bytes = [...done].reduce((n, i) => n + Math.min(up.partSize, up.size - i * up.partSize), 0)
      setSent(bytes)
      if (done.size) toast.success(`Resuming — ${Math.round((bytes / up.size) * 100)}% was already uploaded`)
      const todo = Array.from({ length: up.parts }, (_, i) => i).filter((i) => !done.has(i))
      const started = Date.now()
      const startBytes = bytes
      const worker = async () => {
        while (todo.length) {
          if (abort.signal.aborted) return
          const n = todo.shift()!
          const blob = file.slice(n * up.partSize, Math.min(up.size, (n + 1) * up.partSize))
          for (let attempt = 1; ; attempt++) {
            try {
              await reelsApi.uploadPart(channelId, up.id, n, blob, abort.signal)
              break
            } catch (err) {
              if (abort.signal.aborted) return
              if (attempt >= MAX_TRIES) throw err
              await new Promise((r) => setTimeout(r, Math.min(30000, 1500 * 2 ** attempt)))
            }
          }
          bytes += blob.size
          setSent(bytes)
          const secs = (Date.now() - started) / 1000
          if (secs > 1) setSpeed((bytes - startBytes) / secs)
        }
      }
      await Promise.all(Array.from({ length: PARALLEL }, worker))
      if (abort.signal.aborted) return
      setPhase('finishing')
      const campaign = await reelsApi.finishUpload(channelId, up.id, { brief: brief.trim() || undefined, targetReels })
      setPhase('done')
      toast.success('Upload complete — your reels are being made')
      onCreated(campaign)
    } catch (err) {
      if (abort.signal.aborted) return
      setError(`${errorMessage(err)} — press Resume to continue where it stopped.`)
      setPhase('paused')
    }
  }

  const pause = () => {
    ctrl.current?.abort()
    setPhase('paused')
  }
  const cancel = async () => {
    ctrl.current?.abort()
    if (info.current) await reelsApi.cancelUpload(channelId, info.current.id).catch(() => undefined)
    info.current = null
    setFile(null)
    setSent(0)
    setPhase('pick')
  }

  const pct = file ? Math.min(100, (sent / file.size) * 100) : 0
  const eta = file && speed > 0 ? (file.size - sent) / speed : 0
  const busy = phase === 'uploading' || phase === 'finishing'

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-5">
      {phase === 'pick' && !file ? (
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            pick(e.dataTransfer.files?.[0] ?? null)
          }}
          className="flex flex-col items-center justify-center gap-3 p-10 rounded-2xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-amber-500 cursor-pointer text-center transition"
        >
          <UploadCloud className="w-10 h-10 text-amber-500" />
          <div>
            <p className="text-sm font-bold text-zinc-800 dark:text-zinc-100">Drop your video here or click to choose</p>
            <p className="text-xs text-zinc-500 mt-1">The raw file straight from your camera or editor is fine (MP4, MOV, MKV… up to 40 GB).</p>
          </div>
          <input type="file" accept="video/*,.mkv,.mxf,.mts" className="hidden" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        </label>
      ) : (
        file && (
          <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 space-y-3">
            <div className="flex items-center gap-3">
              <FileVideo className="w-8 h-8 text-amber-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate">{file.name}</p>
                <p className="text-[11px] text-zinc-500">{fmtBytes(file.size)}</p>
              </div>
              {phase === 'pick' && (
                <button type="button" onClick={() => setFile(null)} className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500">
                  <X className="w-4 h-4" />
                </button>
              )}
              {phase === 'done' && <CheckCircle2 className="w-6 h-6 text-emerald-500" />}
            </div>
            {phase !== 'pick' && (
              <div className="space-y-1">
                <div className="h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                  <div className={cn('h-full transition-all', phase === 'paused' ? 'bg-zinc-400' : 'bg-amber-500')} style={{ width: `${pct}%` }} />
                </div>
                <div className="flex justify-between text-[11px] text-zinc-500 tabular-nums">
                  <span>
                    {fmtBytes(sent)} of {fmtBytes(file.size)} · {pct.toFixed(0)}%
                  </span>
                  <span>
                    {phase === 'uploading' && speed > 0 ? `${fmtBytes(speed)}/s · ${fmtTime(eta)} left` : phase === 'finishing' ? 'Starting your campaign…' : phase === 'paused' ? 'Paused' : ''}
                  </span>
                </div>
              </div>
            )}
          </div>
        )
      )}

      {(phase === 'pick' || phase === 'paused') && file && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1">Video title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={phase === 'paused'}
              className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-sm dark:text-zinc-100 focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1">What should the reels focus on? (optional)</label>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={2}
              placeholder="e.g. the moment he talks about his first day in the feds"
              className="w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-sm dark:text-zinc-100 resize-none focus:outline-none focus:border-amber-500"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">Reels</label>
            <input
              type="number"
              min={1}
              max={10}
              value={targetReels}
              onChange={(e) => setTargetReels(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
              className="w-20 px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-sm dark:text-zinc-100"
            />
          </div>
        </div>
      )}

      {busy && <p className="text-xs text-amber-600 dark:text-amber-400">Keep this tab open until the upload finishes. If it stops, choose the same file again and it continues where it left off.</p>}
      {error && <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-500">{error}</div>}

      <div className="flex justify-between gap-2 pt-1">
        <button type="button" onClick={phase === 'pick' ? onBack : cancel} disabled={phase === 'finishing' || phase === 'done'} className="px-4 py-2 rounded-xl text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40">
          {phase === 'pick' ? 'Back' : 'Cancel upload'}
        </button>
        {phase === 'pick' && (
          <button type="button" onClick={run} disabled={!file} className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-bold text-sm flex items-center gap-2">
            <UploadCloud className="w-4 h-4" /> Upload and make reels
          </button>
        )}
        {phase === 'uploading' && (
          <button type="button" onClick={pause} className="px-4 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-sm font-semibold flex items-center gap-2 dark:text-zinc-200">
            <Pause className="w-4 h-4" /> Pause
          </button>
        )}
        {phase === 'paused' && (
          <button type="button" onClick={run} className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm flex items-center gap-2">
            <Play className="w-4 h-4" /> Resume
          </button>
        )}
        {phase === 'finishing' && <Loader2 className="w-5 h-5 animate-spin text-amber-500" />}
      </div>
    </div>
  )
}
