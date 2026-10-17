'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, Copy, Download, Eraser, Filter, Loader2, Pause, Play, RefreshCw, Search, WrapText, X } from 'lucide-react'
import { toast } from 'sonner'
import { opsApi, type OpsContainer, type OpsLogLine } from '@/lib/ops-api'
import { cn } from '@/lib/utils'
import { detectLevel, LEVEL_STYLE, LevelBadge, LogMessage, type Level } from './log-format'

const MAX_LINES = 5000
const LEVELS: Array<{ id: Level | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'error', label: 'Errors' },
  { id: 'warn', label: 'Warnings' },
  { id: 'success', label: 'Success' },
  { id: 'info', label: 'Info' },
]

interface Line extends OpsLogLine {
  n: number
  level: Level
}

let seq = 0
const toLines = (raw: OpsLogLine[]): Line[] => raw.map((l) => ({ ...l, n: seq++, level: detectLevel(l.text, l.stream) }))

const fmtTs = (ts: string | null) => {
  if (!ts) return ''
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0')
}

const LogRow = memo(function LogRow({ line, search, wrap }: { line: Line; search: RegExp | null; wrap: boolean }) {
  const s = LEVEL_STYLE[line.level]
  return (
    <div className={cn('flex gap-2 px-3 py-[3px] border-l-2 hover:bg-white/[0.04] font-mono text-[12px] leading-5', s.row)}>
      <span className="shrink-0 text-zinc-500 tabular-nums select-none w-[92px]" title={line.ts ?? ''}>
        {fmtTs(line.ts)}
      </span>
      <span className="shrink-0 select-none">
        <LevelBadge level={line.level} />
      </span>
      <span className={cn('min-w-0 flex-1', s.text, wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre overflow-x-auto')}>
        <LogMessage text={line.text} search={search} />
      </span>
    </div>
  )
})

/** Container log viewer: pick a container, search, filter by level, follow live. */
export function LogViewer({ containers, title }: { containers: OpsContainer[]; title: string }) {
  const [active, setActive] = useState<string>(containers[0]?.name ?? '')
  const [lines, setLines] = useState<Line[]>([])
  const [loading, setLoading] = useState(false)
  const [tail, setTail] = useState(500)
  const [live, setLive] = useState(true)
  const [query, setQuery] = useState('')
  const [onlyMatches, setOnlyMatches] = useState(true)
  const [level, setLevel] = useState<Level | 'all'>('all')
  const [wrap, setWrap] = useState(true)
  const [stick, setStick] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  const current = active && containers.some((c) => c.name === active) ? active : containers[0]?.name ?? ''

  // Initial page of history.
  useEffect(() => {
    if (!current) return
    let alive = true
    const t = setTimeout(() => alive && setLoading(true), 0)
    opsApi
      .logs(current, tail)
      .then((r) => alive && setLines(toLines(r.lines)))
      .catch((err) => alive && toast.error(`Could not load logs: ${(err as Error).message}`))
      .finally(() => {
        clearTimeout(t)
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [current, tail, reloadKey])

  // Live follow.
  useEffect(() => {
    if (!current || !live) return
    const stop = opsApi.follow(
      current,
      (raw) => setLines((prev) => {
        const next = prev.concat(toLines(raw))
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next
      }),
      (err) => err && toast.error(err),
    )
    return stop
  }, [current, live, reloadKey])

  const search = useMemo(() => {
    const q = query.trim()
    if (!q) return null
    try {
      return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    } catch {
      return null
    }
  }, [query])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: lines.length }
    for (const l of lines) c[l.level] = (c[l.level] ?? 0) + 1
    return c
  }, [lines])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return lines.filter((l) => (level === 'all' || l.level === level) && (!q || !onlyMatches || l.text.toLowerCase().includes(q)))
  }, [lines, level, query, onlyMatches])
  const matchCount = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? lines.filter((l) => l.text.toLowerCase().includes(q)).length : 0
  }, [lines, query])

  // Keep the view pinned to the newest line unless the reader scrolled up.
  useEffect(() => {
    if (stick && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight
  }, [visible, stick])
  const onScroll = useCallback(() => {
    const el = boxRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setStick(atBottom)
  }, [])

  const asText = () => visible.map((l) => `${l.ts ?? ''} [${l.level}] ${l.text}`).join('\n')
  const copy = async () => {
    await navigator.clipboard.writeText(asText())
    toast.success(`Copied ${visible.length} lines`)
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([asText()], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${current}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!containers.length) return <p className="text-sm text-zinc-500 p-6">No containers found for {title}.</p>

  return (
    <div className="flex flex-col h-[calc(100vh-190px)] min-h-[480px] rounded-2xl border border-zinc-800 bg-zinc-950 overflow-hidden">
      {/* container picker */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-zinc-800 bg-zinc-900/60">
        {containers.map((c) => (
          <button
            key={c.name}
            onClick={() => setActive(c.name)}
            className={cn(
              'px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition',
              current === c.name ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-800/70 text-zinc-300 hover:bg-zinc-800',
            )}
          >
            <span className={cn('w-1.5 h-1.5 rounded-full', c.state === 'running' ? 'bg-emerald-400' : 'bg-red-500')} />
            {c.service || c.name}
          </button>
        ))}
      </div>

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-zinc-800">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search logs…"
            className="w-full pl-8 pr-16 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500"
          />
          {query && (
            <span className="absolute right-7 top-1/2 -translate-y-1/2 text-[10px] text-zinc-500 tabular-nums">{matchCount}</span>
          )}
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <button
          onClick={() => setOnlyMatches((v) => !v)}
          title={onlyMatches ? 'Showing only matching lines' : 'Highlighting matches in all lines'}
          className={cn('px-2 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1', onlyMatches ? 'bg-amber-500/15 text-amber-300' : 'bg-zinc-900 text-zinc-400')}
        >
          <Filter className="w-3 h-3" /> {onlyMatches ? 'Only matches' : 'Highlight'}
        </button>

        <div className="flex rounded-lg bg-zinc-900 p-0.5">
          {LEVELS.map((l) => (
            <button
              key={l.id}
              onClick={() => setLevel(l.id)}
              className={cn(
                'px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1',
                level === l.id ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200',
                l.id === 'error' && (counts.error ?? 0) > 0 && level !== l.id && 'text-red-400',
                l.id === 'warn' && (counts.warn ?? 0) > 0 && level !== l.id && 'text-amber-400',
              )}
            >
              {l.label}
              <span className="text-[10px] opacity-70 tabular-nums">{counts[l.id] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <select value={tail} onChange={(e) => setTail(Number(e.target.value))} className="px-2 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-300">
            {[200, 500, 1000, 2000, 5000].map((n) => (
              <option key={n} value={n}>
                last {n}
              </option>
            ))}
          </select>
          <button
            onClick={() => setLive((v) => !v)}
            className={cn('px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1.5', live ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-900 text-zinc-400')}
            title={live ? 'Pause live updates' : 'Resume live updates'}
          >
            {live ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                </span>
                Live <Pause className="w-3 h-3" />
              </>
            ) : (
              <>
                Paused <Play className="w-3 h-3" />
              </>
            )}
          </button>
          <IconBtn title="Reload" onClick={() => setReloadKey((k) => k + 1)}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </IconBtn>
          <IconBtn title={wrap ? 'Do not wrap long lines' : 'Wrap long lines'} onClick={() => setWrap((v) => !v)} active={wrap}>
            <WrapText className="w-3.5 h-3.5" />
          </IconBtn>
          <IconBtn title="Copy visible lines" onClick={copy}>
            <Copy className="w-3.5 h-3.5" />
          </IconBtn>
          <IconBtn title="Download visible lines" onClick={download}>
            <Download className="w-3.5 h-3.5" />
          </IconBtn>
          <IconBtn title="Clear the view" onClick={() => setLines([])}>
            <Eraser className="w-3.5 h-3.5" />
          </IconBtn>
        </div>
      </div>

      {/* lines */}
      <div className="relative flex-1 min-h-0">
        <div ref={boxRef} onScroll={onScroll} className="absolute inset-0 overflow-y-auto py-1">
          {visible.length === 0 ? (
            <p className="text-xs text-zinc-500 p-6 text-center">{loading ? 'Loading…' : query || level !== 'all' ? 'No lines match.' : 'No log lines yet.'}</p>
          ) : (
            visible.map((l) => <LogRow key={l.n} line={l} search={search} wrap={wrap} />)
          )}
        </div>
        {!stick && (
          <button
            onClick={() => setStick(true)}
            className="absolute bottom-3 right-5 px-3 py-1.5 rounded-full bg-amber-500 text-black text-[11px] font-bold shadow-lg flex items-center gap-1"
          >
            <ArrowDownToLine className="w-3.5 h-3.5" /> Jump to latest
          </button>
        )}
      </div>
      <div className="px-3 py-1 border-t border-zinc-800 text-[10px] text-zinc-500 flex justify-between">
        <span>
          {visible.length} of {lines.length} lines · {current}
        </span>
        <span>Secrets such as tokens and passwords are masked</span>
      </div>
    </div>
  )
}

function IconBtn({ children, title, onClick, active }: { children: React.ReactNode; title: string; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} title={title} className={cn('p-1.5 rounded-lg', active ? 'bg-zinc-700 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-100')}>
      {children}
    </button>
  )
}
