'use client'

import { useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, PlugZap, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { reelsApi, errorMessage } from '@/lib/reels-api'
import type { ReelServiceStatus } from '@/types/reel'

/** Banner shown on the Reels pages when downloads need a fresh YouTube login. */
export function YouTubeConnectBanner({ status, onFixed }: { status: ReelServiceStatus | null; onFixed: () => void }) {
  const [open, setOpen] = useState(false)
  if (!status) return null
  const yt = status.youtube
  if (yt.status === 'ok') return null

  const missing = yt.status === 'missing'
  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-2xl border border-amber-500/30 bg-amber-500/10">
        <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
            {missing ? 'Connect the YouTube downloader to start making reels' : 'YouTube downloader needs to be reconnected'}
          </p>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
            {missing
              ? 'Reels are cut from your own videos. The system needs a logged-in YouTube session to download them.'
              : 'YouTube ended the download session. Video downloads are paused — campaigns will continue automatically once you reconnect.'}
            {yt.lastError ? <span className="block mt-1 text-[11px] text-zinc-500">Last error: {yt.lastError}</span> : null}
          </p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm flex items-center gap-2 transition active:scale-95"
        >
          <PlugZap className="w-4 h-4" />
          {missing ? 'Connect YouTube' : 'Reconnect YouTube'}
        </button>
      </div>
      {open && (
        <YouTubeConnectWizard
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false)
            onFixed()
          }}
        />
      )}
    </>
  )
}

const STEPS = [
  {
    title: 'Use the dedicated downloader account',
    body: 'Use the separate Google account created for downloads — never your main channel account. Open a PRIVATE / INCOGNITO window in Chrome (Ctrl+Shift+N).',
  },
  {
    title: 'Install the cookie exporter (one time)',
    body: 'Install the Chrome extension "Get cookies.txt LOCALLY". In the extension settings, turn on "Allow in Incognito".',
  },
  {
    title: 'Log in and export',
    body: 'In the incognito window, go to youtube.com and log in with the downloader account. Play any video for a few seconds. Click the extension and press "Copy" (Netscape format) — or "Export" to save a cookies.txt file.',
  },
  {
    title: 'Close the incognito window',
    body: 'Close the whole incognito window right after copying. This keeps the session valid for weeks — if you keep browsing in it, YouTube rotates the session and the copy stops working.',
  },
  {
    title: 'Paste it here',
    body: 'Paste the copied cookies below (or switch to file upload). The system tests them against YouTube before saving, then resumes downloads automatically.',
  },
]

export function YouTubeConnectWizard({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'paste' | 'file'>('paste')
  const inputRef = useRef<HTMLInputElement>(null)
  const pastedLines = text.split('\n').filter((l) => l.trim() && !l.startsWith('#')).length

  const onFile = async (f?: File) => {
    if (!f) return
    setError(null)
    if (f.size > 200_000) return setError('That file is too large to be a cookies.txt export.')
    setFileName(f.name)
    setText(await f.text())
  }

  const submit = async () => {
    if (!text.trim()) return setError(mode === 'paste' ? 'Paste the copied cookies first.' : 'Choose the exported cookies.txt file first.')
    setBusy(true)
    setError(null)
    try {
      const res = await reelsApi.uploadCookies(text)
      if (!res.ok) {
        setError(res.reason || 'YouTube rejected this session.')
        return
      }
      toast.success('YouTube connected — downloads resumed')
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PlugZap className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Connect the YouTube downloader</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <ol className="space-y-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-amber-500/15 text-amber-500 text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                <div>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{s.title}</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="flex rounded-lg bg-zinc-100 dark:bg-zinc-800 p-0.5 w-fit">
            {(
              [
                ['paste', 'Paste text'],
                ['file', 'Upload file'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setMode(id)
                  setText('')
                  setFileName(null)
                  setError(null)
                }}
                className={`px-3 py-1 rounded-md text-xs font-semibold ${mode === id ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm' : 'text-zinc-500'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'paste' ? (
            <div>
              <textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value)
                  setError(null)
                }}
                rows={7}
                spellCheck={false}
                placeholder={'# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t...'}
                className="w-full px-3 py-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-[11px] font-mono focus:outline-none focus:border-amber-500 dark:text-zinc-100 resize-none"
              />
              <p className="text-[11px] text-zinc-400 mt-1">
                {pastedLines ? `${pastedLines} cookie lines pasted · ` : ''}
                Encrypted at rest and only used to download your own videos.
              </p>
            </div>
          ) : (
            <div
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                onFile(e.dataTransfer.files?.[0])
              }}
              className="cursor-pointer rounded-2xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-amber-500 p-6 text-center transition"
            >
              <input ref={inputRef} type="file" accept=".txt,text/plain" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
              {fileName ? (
                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 flex items-center justify-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" /> {fileName}
                </p>
              ) : (
                <p className="text-sm text-zinc-500 flex items-center justify-center gap-2">
                  <Upload className="w-4 h-4" /> Drop cookies.txt here or click to choose
                </p>
              )}
              <p className="text-[11px] text-zinc-400 mt-1">Encrypted at rest and only used to download your own videos.</p>
            </div>
          )}

          {error && <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-500">{error}</div>}
        </div>

        <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || !text}
            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold text-sm flex items-center gap-2"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {busy ? 'Testing with YouTube…' : 'Test & connect'}
          </button>
        </div>
      </div>
    </div>
  )
}
