'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Clapperboard, Gauge, Loader2, LockKeyhole, Server, Terminal } from 'lucide-react'
import { opsApi, type OpsContainer, type OpsSystem } from '@/lib/ops-api'
import { reelsApi } from '@/lib/reels-api'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { ReelServiceStatus } from '@/types/reel'
import { LogViewer } from '@/components/developer/log-viewer'
import { SystemOverview, type Sample } from '@/components/developer/system-overview'

type Tab = 'overview' | 'main' | 'reels'
const HISTORY = 120 // samples (× 3 s = 6 min)

export default function DeveloperPage() {
  const [access, setAccess] = useState<'checking' | 'ok' | 'login' | 'denied'>('checking')
  const [email, setEmail] = useState('')
  const [tab, setTab] = useState<Tab>('overview')
  const [sys, setSys] = useState<OpsSystem | null>(null)
  const [history, setHistory] = useState<Sample[]>([])
  const [reels, setReels] = useState<ReelServiceStatus | null>(null)
  const [stale, setStale] = useState(false)
  const [focus, setFocus] = useState<{ tab: Tab; name: string } | null>(null)

  useEffect(() => {
    opsApi
      .me()
      .then((r) => {
        setEmail(r.email)
        setAccess('ok')
      })
      .catch((err) => setAccess(err instanceof ApiError && err.statusCode === 403 ? 'denied' : 'login'))
  }, [])

  // Live system numbers every 3 s (paused while the tab is hidden).
  useEffect(() => {
    if (access !== 'ok') return
    let alive = true
    const tick = async () => {
      if (document.hidden) return
      try {
        const s = await opsApi.system()
        if (!alive) return
        setSys(s)
        setStale(false)
        setHistory((h) => {
          const next = [...h, { t: new Date(s.at).toLocaleTimeString(), cpu: s.cpu ?? 0, mem: (s.memory.used / s.memory.total) * 100 }]
          return next.length > HISTORY ? next.slice(next.length - HISTORY) : next
        })
      } catch {
        if (alive) setStale(true)
      }
      reelsApi
        .status()
        .then((r) => alive && setReels(r))
        .catch(() => alive && setReels(null))
    }
    tick()
    const t = setInterval(tick, 3000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [access])

  const { main, reel } = useMemo(() => {
    const list = sys?.containers ?? []
    return {
      main: list.filter((c) => c.project !== 'youtubeai-reels'),
      reel: list.filter((c) => c.project === 'youtubeai-reels'),
    }
  }, [sys])

  const openLogs = (c: OpsContainer) => {
    const t: Tab = c.project === 'youtubeai-reels' ? 'reels' : 'main'
    setFocus({ tab: t, name: c.name })
    setTab(t)
  }
  // Put the focused container first so the viewer opens on it.
  const order = (list: OpsContainer[], t: Tab) => {
    if (focus?.tab !== t) return list
    const hit = list.find((c) => c.name === focus.name)
    return hit ? [hit, ...list.filter((c) => c !== hit)] : list
  }

  if (access !== 'ok') {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
        <div className="max-w-sm text-center space-y-3">
          {access === 'checking' ? (
            <Loader2 className="w-6 h-6 animate-spin text-amber-500 mx-auto" />
          ) : (
            <>
              <LockKeyhole className="w-8 h-8 text-zinc-500 mx-auto" />
              <p className="text-white font-bold">{access === 'denied' ? 'Developers only' : 'Please sign in'}</p>
              <p className="text-sm text-zinc-400">
                {access === 'denied' ? 'This console is limited to developer accounts.' : 'Sign in with a developer account to view server health and logs.'}
              </p>
              <Link href={access === 'denied' ? '/dashboard' : '/login'} className="inline-block px-4 py-2 rounded-xl bg-amber-500 text-black font-bold text-sm">
                {access === 'denied' ? 'Back to the app' : 'Sign in'}
              </Link>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="max-w-[1600px] mx-auto px-5 py-3 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2.5">
            <span className="p-1.5 rounded-lg bg-amber-500/15 text-amber-400">
              <Terminal className="w-5 h-5" />
            </span>
            <div>
              <h1 className="text-sm font-bold">Developer Console</h1>
              <p className="text-[11px] text-zinc-500">meccaaudio.com · {email}</p>
            </div>
          </div>
          <nav className="flex gap-1">
            {(
              [
                ['overview', 'Server', Gauge],
                ['main', 'Main app logs', Server],
                ['reels', 'Reel logs', Clapperboard],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5', tab === id ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-400 hover:text-white hover:bg-zinc-900')}
              >
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-[11px]">
            <span className={cn('flex items-center gap-1.5', stale ? 'text-red-400' : 'text-emerald-400')}>
              <span className={cn('w-2 h-2 rounded-full', stale ? 'bg-red-500' : 'bg-emerald-400 animate-pulse')} />
              {stale ? 'Connection lost — retrying' : 'Live'}
            </span>
            <Link href="/dev/logs" className="text-zinc-400 hover:text-white">
              HTTP request log
            </Link>
            <Link href="/dashboard" className="text-zinc-400 hover:text-white flex items-center gap-1">
              <ArrowLeft className="w-3.5 h-3.5" /> App
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-5 py-5">
        {!sys ? (
          <div className="flex justify-center py-24">
            <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
          </div>
        ) : tab === 'overview' ? (
          <SystemOverview sys={sys} history={history} reels={reels} onOpenLogs={openLogs} />
        ) : tab === 'main' ? (
          <LogViewer key={`main-${focus?.tab === 'main' ? focus.name : ''}`} containers={order(main, 'main')} title="the main app" />
        ) : (
          <LogViewer key={`reels-${focus?.tab === 'reels' ? focus.name : ''}`} containers={order(reel, 'reels')} title="the reel service" />
        )}
      </main>
    </div>
  )
}
