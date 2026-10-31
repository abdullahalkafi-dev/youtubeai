'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, Copy, Loader2, Mic, Plus, Save, Sparkles, Square, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import api from '@/lib/api'
import { calculateTeleprompterStats } from '@/lib/teleprompter-parser'
import type { ScriptItem } from '@/types/script'

const MAX_RECORD_SECONDS = 300
const DRAFT_KEY = (channelId: string) => `uma-dictation-bullets:${channelId}`

/** The card text without its HTML comment markers, as the library stores it. */
function plainScript(text: string): string {
  return text
    .split('\n')
    .filter((l) => !/^\s*<!--.*-->\s*$/.test(l))
    .join('\n')
    .trim()
}

function readDraft(channelId: string): string[] {
  try {
    const raw = localStorage.getItem(DRAFT_KEY(channelId))
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((b) => typeof b === 'string') : []
  } catch {
    return []
  }
}

function writeDraft(channelId: string, bullets: string[]) {
  try {
    localStorage.setItem(DRAFT_KEY(channelId), JSON.stringify(bullets))
  } catch {
    /* private window or blocked storage: the list still works for this visit */
  }
}

interface DictateBulletsModalProps {
  isOpen: boolean
  onClose: () => void
  channelId: string
  /**
   * 'chat': Generate puts his bullet card and the full script into the chat (the chat then goes on with
   * videos to show, SEO and thumbnails). 'library': Generate shows both here, to save in the Library.
   */
  mode: 'chat' | 'library'
  /** Chat mode: puts the bullets into the chat (creating one when needed). */
  onGenerateToChat?: (bullets: string[]) => Promise<void>
  /** Library mode: a script was saved. */
  onScriptCreated?: (script: ScriptItem) => void
}

type Recording = 'idle' | 'recording' | 'transcribing'

export function DictateBulletsModal({ isOpen, onClose, channelId, mode, onGenerateToChat, onScriptCreated }: DictateBulletsModalProps) {
  const [bullets, setBullets] = useState<string[]>([])
  const [recording, setRecording] = useState<Recording>('idle')
  const [seconds, setSeconds] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [bulletCard, setBulletCard] = useState<{ title: string; text: string } | null>(null)
  const [fullScript, setFullScript] = useState<{ title: string; text: string } | null>(null)
  const [scriptPending, setScriptPending] = useState(false)
  const [scriptError, setScriptError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopStream = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  // Opening brings back the bullets he already dictated (nothing is lost if he left).
  useEffect(() => {
    if (!isOpen) return
    setBullets(readDraft(channelId))
    setBulletCard(null)
    setFullScript(null)
    setScriptError(null)
    setSaved({})
  }, [isOpen, channelId])

  // The list is stored as he goes.
  useEffect(() => {
    if (isOpen) writeDraft(channelId, bullets)
  }, [bullets, isOpen, channelId])

  useEffect(() => () => {
    recorderRef.current?.state === 'recording' && recorderRef.current.stop()
    stopStream()
  }, [stopStream])

  const startRecording = async () => {
    if (recording !== 'idle') return
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      toast.error('This browser cannot record. Please use Chrome, Edge or Safari, or type the bullet.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t))
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = async () => {
        stopStream()
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        if (blob.size < 1500) {
          setRecording('idle')
          toast.error('I did not hear anything. Try again a little closer to the mic.')
          return
        }
        setRecording('transcribing')
        try {
          const { text } = await api.transcribeBullet(channelId, blob)
          if (text.trim()) setBullets((prev) => [...prev, text.trim()])
          else toast.error('I could not make out any words. Please record that bullet again.')
        } catch (err: any) {
          toast.error(err?.message || 'Could not turn the recording into text. Please try again.')
        } finally {
          setRecording('idle')
        }
      }
      recorderRef.current = recorder
      recorder.start()
      setSeconds(0)
      setRecording('recording')
      timerRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_RECORD_SECONDS) recorderRef.current?.state === 'recording' && recorderRef.current.stop()
          return s + 1
        })
      }, 1000)
    } catch (err: any) {
      stopStream()
      toast.error(
        err?.name === 'NotAllowedError'
          ? 'The microphone is blocked. Allow the microphone for this site in your browser, then try again.'
          : 'Could not start the microphone.',
      )
    }
  }

  const stopRecording = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }

  const setBullet = (i: number, value: string) => setBullets((prev) => prev.map((b, k) => (k === i ? value : b)))
  const removeBullet = (i: number) => setBullets((prev) => prev.filter((_, k) => k !== i))
  const move = (i: number, dir: -1 | 1) =>
    setBullets((prev) => {
      const j = i + dir
      if (j < 0 || j >= prev.length) return prev
      const next = prev.slice()
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const ready = bullets.map((b) => b.trim()).filter(Boolean)

  const handleGenerate = async () => {
    if (!ready.length || generating) return
    setGenerating(true)
    setBulletCard(null)
    setFullScript(null)
    setScriptError(null)
    setSaved({})
    try {
      if (mode === 'chat') {
        await onGenerateToChat?.(ready)
        writeDraft(channelId, [])
        setBullets([])
        onClose()
        return
      }
      // Library: his bullet card is quick and shows first; the full script follows.
      setScriptPending(true)
      api
        .dictationFullScript(channelId, { bullets: ready })
        .then((r) => setFullScript({ title: r.title, text: plainScript(r.fullScript) }))
        .catch((err: any) => setScriptError(err?.message || 'The full script could not be written. Press Generate again.'))
        .finally(() => setScriptPending(false))
      const card = await api.dictationBulletCard(channelId, { bullets: ready })
      setBulletCard({ title: card.title, text: plainScript(card.bulletCard) })
    } catch (err: any) {
      toast.error(err?.message || 'Could not generate this time. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  const save = async (key: 'bullets' | 'script', title: string, text: string) => {
    try {
      const stats = calculateTeleprompterStats(text)
      const script = await api.createScript(channelId, {
        title,
        content: text,
        wordCount: stats.wordCount,
        estimatedDurationMinutes: stats.estimatedDurationMinutes,
        source: 'manual_import',
        formatType: 'teleprompter_beat',
        ...(key === 'bullets' ? { variant: 'bullet' as const } : {}),
      })
      setSaved((s) => ({ ...s, [key]: true }))
      onScriptCreated?.(script)
      toast.success('Saved to your Library.')
    } catch (err: any) {
      toast.error(`Could not save: ${err?.message || 'try again'}`)
    }
  }

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      toast.error('Could not copy.')
    }
  }

  const startOver = () => {
    setBullets([])
    setBulletCard(null)
    setFullScript(null)
    setScriptError(null)
    setSaved({})
  }

  if (!isOpen) return null

  const busy = recording !== 'idle' || generating
  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

  const resultCard = (key: 'bullets' | 'script', label: string, data: { title: string; text: string }) => (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 dark:bg-zinc-800/60 border-b border-zinc-200 dark:border-zinc-700">
        <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-100 flex-1 truncate">{label}: {data.title}</span>
        <button
          onClick={() => copy(key, data.text)}
          className="text-[11px] px-2 py-1 rounded-md border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center gap-1"
        >
          {copied === key ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} Copy
        </button>
        <button
          onClick={() => save(key, key === 'bullets' ? `${data.title} (my bullets)` : data.title, data.text)}
          disabled={saved[key]}
          className="text-[11px] px-2 py-1 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1 disabled:opacity-60"
        >
          {saved[key] ? <Check className="w-3 h-3" /> : <Save className="w-3 h-3" />} {saved[key] ? 'Saved' : 'Save to Library'}
        </button>
      </div>
      <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap p-3 text-[12px] leading-relaxed text-zinc-800 dark:text-zinc-200 font-sans">{data.text}</pre>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-white flex items-center gap-2">
              <Mic className="w-4 h-4 text-indigo-500" /> Dictate my bullets
            </h2>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Talk one bullet at a time. Each one is written down and kept. When you are done, press Generate.
            </p>
          </div>
          <button onClick={onClose} disabled={recording === 'recording'} className="p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-lg disabled:opacity-40" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Record */}
          <div className="flex items-center gap-3">
            {recording === 'recording' ? (
              <button onClick={stopRecording} className="px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold text-sm flex items-center gap-2 shadow">
                <Square className="w-4 h-4" /> Stop bullet {bullets.length + 1}
                <span className="font-mono text-xs opacity-90">{mmss}</span>
              </button>
            ) : (
              <button
                onClick={startRecording}
                disabled={busy}
                className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm flex items-center gap-2 shadow disabled:opacity-50"
              >
                {recording === 'transcribing' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
                {recording === 'transcribing' ? 'Writing it down...' : `Record bullet ${bullets.length + 1}`}
              </button>
            )}
            <button
              onClick={() => setBullets((prev) => [...prev, ''])}
              disabled={busy}
              className="px-3 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 text-xs font-medium flex items-center gap-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" /> Type one instead
            </button>
            {recording === 'recording' && (
              <span className="flex items-center gap-1.5 text-xs text-red-500">
                <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" /></span>
                Listening
              </span>
            )}
          </div>

          {/* Bullets */}
          {bullets.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400 border border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl p-4">
              No bullets yet. Press the blue button and say your first bullet. You can fix any word afterwards.
            </p>
          ) : (
            <ol className="space-y-2">
              {bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-2 w-6 h-6 shrink-0 rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 text-xs font-bold flex items-center justify-center">{i + 1}</span>
                  <textarea
                    value={b}
                    onChange={(e) => setBullet(i, e.target.value)}
                    rows={Math.min(6, Math.max(2, Math.ceil(b.length / 70)))}
                    disabled={generating}
                    placeholder="Type your bullet here"
                    className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />
                  <div className="flex flex-col gap-0.5 mt-1">
                    <button onClick={() => move(i, -1)} disabled={i === 0 || generating} className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-30" title="Move up"><ArrowUp className="w-3.5 h-3.5" /></button>
                    <button onClick={() => move(i, 1)} disabled={i === bullets.length - 1 || generating} className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-30" title="Move down"><ArrowDown className="w-3.5 h-3.5" /></button>
                  </div>
                  <button onClick={() => removeBullet(i)} disabled={generating} className="mt-2 p-1 text-zinc-400 hover:text-red-500 disabled:opacity-30" title="Delete this bullet"><Trash2 className="w-4 h-4" /></button>
                </li>
              ))}
            </ol>
          )}

          {/* Results (library mode) */}
          {mode === 'library' && (generating || bulletCard || scriptPending || fullScript || scriptError) && (
            <div className="space-y-3 pt-1">
              {bulletCard ? resultCard('bullets', 'My bullets', bulletCard) : generating ? (
                <p className="text-xs text-zinc-500 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Laying out your bullets...</p>
              ) : null}
              {fullScript ? resultCard('script', 'Full script', fullScript) : scriptPending ? (
                <p className="text-xs text-zinc-500 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Writing the full script from your bullets (about a minute)...</p>
              ) : null}
              {scriptError && <p className="text-xs text-red-500">{scriptError}</p>}
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-zinc-200 dark:border-zinc-800 flex items-center gap-3">
          <button onClick={startOver} disabled={busy || bullets.length === 0} className="text-xs text-zinc-500 hover:text-red-500 disabled:opacity-40">
            Start over
          </button>
          <span className="text-[11px] text-zinc-400 flex-1">
            {mode === 'chat'
              ? 'Generate puts your bullets and the full script into the chat.'
              : 'Your bullets stay exactly yours. The full script is built on them.'}
          </span>
          <button
            onClick={handleGenerate}
            disabled={busy || ready.length === 0}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-semibold text-sm flex items-center gap-2 shadow disabled:opacity-50"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {generating ? (mode === 'chat' ? 'Writing (about a minute)...' : 'Working...') : 'Generate'}
          </button>
        </div>
      </div>
    </div>
  )
}
