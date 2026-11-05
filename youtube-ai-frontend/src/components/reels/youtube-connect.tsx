'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Loader2, PlugZap, RefreshCw, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { reelsApi, errorMessage } from '@/lib/reels-api'
import type { ReelServiceStatus } from '@/types/reel'

type Yt = ReelServiceStatus['youtube']

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')
const daysSince = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null)

/** Most of last week's downloads below 720p: the login still passes, but YouTube only serves low quality to it. */
const lowQuality = (yt: Yt) => !!yt.recentDownloads && yt.recentDownloads.count >= 2 && yt.recentDownloads.hd * 2 < yt.recentDownloads.count

function badgeFor(yt: Yt): { label: string; variant: 'green' | 'yellow' } {
  if (yt.status === 'missing') return { label: 'Not connected', variant: 'yellow' }
  if (yt.status === 'needs_login') return { label: 'Needs new cookies', variant: 'yellow' }
  if (lowQuality(yt)) return { label: 'Low quality', variant: 'yellow' }
  return { label: 'Connected', variant: 'green' }
}

/**
 * Settings card for the reel downloader's YouTube session (the burner account's cookies).
 * The only place cookies are replaced: no server command needed, and nothing on the Reels pages warns the client.
 */
export function YouTubeDownloaderCard() {
  const [yt, setYt] = useState<Yt | null>(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const [testing, setTesting] = useState(false)

  const load = useCallback(() => {
    reelsApi
      .status()
      .then((s) => {
        setYt(s.youtube)
        setFailed(false)
      })
      .catch(() => setFailed(true))
  }, [])
  useEffect(load, [load])

  const test = async () => {
    setTesting(true)
    try {
      const r = await reelsApi.checkSession()
      if (r.status === 'ok') toast.success('YouTube accepted the downloader login')
      else toast.message('YouTube did not accept the login', { description: 'Replace the cookies to fix it.' })
      load()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setTesting(false)
    }
  }

  const badge = yt ? badgeFor(yt) : null
  const age = yt ? daysSince(yt.updatedAt) : null
  const dl = yt?.recentDownloads

  return (
    <Card>
      <CardContent className="p-5 lg:p-6">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm lg:text-base font-semibold text-gray-900 dark:text-white font-heading">Reel downloader</h3>
          {badge && (
            <Badge variant={badge.variant} className="flex items-center gap-1">
              {badge.variant === 'green' && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
              {badge.label}
            </Badge>
          )}
        </div>
        <p className="text-xs text-gray-400 mb-4">The YouTube login (cookies) used to download your videos for reels.</p>

        {failed ? (
          <p className="text-xs text-gray-400">Could not load the downloader status.</p>
        ) : !yt ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-2/3" />
            <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-1/2" />
          </div>
        ) : (
          <div className="space-y-2 text-xs">
            <Row label="Cookies updated" value={yt.updatedAt ? `${fmtDate(yt.updatedAt)}${age !== null ? ` · ${age === 0 ? 'today' : `${age} day${age === 1 ? '' : 's'} ago`}` : ''}` : 'Never'} />
            <Row label="Last check" value={yt.lastCheckAt ? `${fmtDate(yt.lastCheckAt)} · ${yt.status === 'ok' ? 'passed' : 'not accepted'}` : '—'} />
            <Row
              label={`Downloads, last ${dl?.days ?? 7} days`}
              value={!dl ? '—' : dl.count === 0 ? 'None yet' : `${dl.hd} of ${dl.count} in HD (720p+)${dl.lastHeight ? ` · latest ${dl.lastHeight}p` : ''}`}
            />
            <p className="text-[11px] text-gray-400 pt-1">A login usually lasts 2–3 weeks. Replace the cookies when downloads stop coming in HD.</p>
          </div>
        )}

        <div className="flex gap-2 pt-4">
          <button
            onClick={() => setOpen(true)}
            className="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 shadow-sm transition"
          >
            <Upload className="w-3.5 h-3.5" />
            {yt?.status === 'missing' ? 'Add cookies' : 'Replace cookies'}
          </button>
          <button
            onClick={test}
            disabled={testing || !yt || yt.status === 'missing'}
            className="py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition disabled:opacity-50"
          >
            {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Test now
          </button>
        </div>
      </CardContent>
      {open && (
        <YouTubeConnectWizard
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false)
            load()
          }}
        />
      )}
    </Card>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 bg-gray-50 dark:bg-gray-800 rounded-lg px-2.5 py-2">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="font-medium text-gray-700 dark:text-gray-300 text-right">{value}</span>
    </div>
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
