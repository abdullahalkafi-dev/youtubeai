'use client'

import { Fragment, useState } from 'react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type Level = 'error' | 'warn' | 'success' | 'info' | 'debug'

const RE_ERROR = /(\bERROR\b|\bFATAL\b|\bCRITICAL\b|\b\w*Exception\b|\b\w*Error:|\bUnhandled|\bE(CONNREFUSED|CONNRESET|TIMEDOUT|NOTFOUND)\b|\bpanic\b|\bstatus(?:Code)?["']?\s*[:=]\s*5\d\d\b|"level":"error")/
const RE_WARN = /(\bWARN(ING)?\b|\bfail(ed|ure|s)?\b|\bdeprecat\w*|\bretry(ing)?\b|\btimeout\b|"level":"warn")/i
const RE_DEBUG = /\b(DEBUG|VERBOSE|TRACE)\b/
const RE_OK = /(\bsuccess(ful(ly)?)?\b|\bcompleted?\b|\bdone\b|\bready\b|\bstarted\b|\blistening\b|\bconnected\b|\bhealthy\b|\bRendered\b|\bpublished\b|\bPASS\b|\bOK\b|✓|\b20[01]\b)/i

export function detectLevel(text: string, stream: string): Level {
  if (RE_ERROR.test(text)) return 'error'
  if (RE_WARN.test(text)) return 'warn'
  if (RE_DEBUG.test(text)) return 'debug'
  if (RE_OK.test(text)) return 'success'
  if (stream === 'stderr') return 'warn'
  return 'info'
}

export const LEVEL_STYLE: Record<Level, { label: string; badge: string; row: string; text: string }> = {
  error: { label: 'ERR', badge: 'bg-red-500/20 text-red-300', row: 'bg-red-500/[0.07] border-l-red-500', text: 'text-red-200' },
  warn: { label: 'WRN', badge: 'bg-amber-500/20 text-amber-300', row: 'bg-amber-500/[0.05] border-l-amber-500', text: 'text-amber-100' },
  success: { label: 'OK', badge: 'bg-emerald-500/20 text-emerald-300', row: 'border-l-emerald-600/60', text: 'text-emerald-100/90' },
  info: { label: 'INF', badge: 'bg-sky-500/15 text-sky-300', row: 'border-l-transparent', text: 'text-zinc-200' },
  debug: { label: 'DBG', badge: 'bg-zinc-600/30 text-zinc-400', row: 'border-l-transparent', text: 'text-zinc-400' },
}

/* ------------------------------------------------------------------ inline tokens */

const TOKEN =
  /(\d{4}-\d\d-\d\dT[\d:.]+Z?|\d{1,2}\/\d{1,2}\/\d{4},? \d{1,2}:\d\d:\d\d(?: [AP]M)?)|(\[[A-Za-z][\w.:-]*\])|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b|(https?:\/\/[^\s"')]+|\/api\/[^\s"')]*)|\b(ERROR|FATAL|WARN(?:ING)?|LOG|INFO|DEBUG|VERBOSE)\b|\b(true|false|null|undefined)\b|(\b\d+(?:\.\d+)?(?:ms|s|MB|GB|KB|%)?\b)/g

const TOKEN_CLS = [
  'text-zinc-500', // timestamp
  'text-sky-400', // [Context]
  'text-emerald-300', // string
  'text-violet-300 font-semibold', // http method
  'text-cyan-300 underline decoration-cyan-700/50', // url / path
  '', // level keyword (set per value)
  'text-violet-300', // literal
  'text-amber-300', // number
]

const LEVEL_WORD: Record<string, string> = {
  ERROR: 'text-red-400 font-bold',
  FATAL: 'text-red-400 font-bold',
  WARN: 'text-amber-400 font-bold',
  WARNING: 'text-amber-400 font-bold',
  LOG: 'text-emerald-400 font-semibold',
  INFO: 'text-emerald-400 font-semibold',
  DEBUG: 'text-zinc-500',
  VERBOSE: 'text-zinc-500',
}

function mark(text: string, search: RegExp | null, key: string): ReactNode {
  if (!search || !text) return text
  const out: ReactNode[] = []
  let last = 0
  search.lastIndex = 0
  for (let m = search.exec(text); m; m = search.exec(text)) {
    if (!m[0]) {
      search.lastIndex++
      continue
    }
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(
      <mark key={`${key}-${m.index}`} className="bg-yellow-400/80 text-black rounded-sm px-px">
        {m[0]}
      </mark>,
    )
    last = m.index + m[0].length
  }
  if (!out.length) return text
  if (last < text.length) out.push(text.slice(last))
  return out
}

function highlightText(text: string, search: RegExp | null, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  TOKEN.lastIndex = 0
  for (let m = TOKEN.exec(text); m; m = TOKEN.exec(text)) {
    if (m.index > last) out.push(<Fragment key={`${keyBase}p${i++}`}>{mark(text.slice(last, m.index), search, `${keyBase}p${i}`)}</Fragment>)
    const group = m.slice(1).findIndex((g) => g !== undefined)
    const cls = group === 5 ? LEVEL_WORD[m[0]] ?? '' : TOKEN_CLS[group]
    out.push(
      <span key={`${keyBase}t${i++}`} className={cls}>
        {mark(m[0], search, `${keyBase}t${i}`)}
      </span>,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(<Fragment key={`${keyBase}e`}>{mark(text.slice(last), search, `${keyBase}e`)}</Fragment>)
  return out
}

/* ------------------------------------------------------------------ JSON */

/** Finds the first balanced {...} or [...] in a line that is valid JSON. */
function findJson(text: string): { start: number; end: number; value: unknown } | null {
  for (let start = 0; start < text.length; start++) {
    const open = text[start]
    if (open !== '{' && open !== '[') continue
    const close = open === '{' ? '}' : ']'
    let depth = 0
    let inStr = false
    for (let j = start; j < text.length; j++) {
      const ch = text[j]
      if (inStr) {
        if (ch === '\\') j++
        else if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') inStr = true
      else if (ch === open) depth++
      else if (ch === close && --depth === 0) {
        const chunk = text.slice(start, j + 1)
        if (chunk.length < 3) break
        try {
          return { start, end: j + 1, value: JSON.parse(chunk) }
        } catch {
          break
        }
      }
    }
  }
  return null
}

function JsonValue({ v, indent, pretty }: { v: unknown; indent: number; pretty: boolean }): ReactNode {
  const pad = pretty ? '\n' + '  '.repeat(indent + 1) : ' '
  const padEnd = pretty ? '\n' + '  '.repeat(indent) : ' '
  if (v === null) return <span className="text-violet-300">null</span>
  if (typeof v === 'string') return <span className="text-emerald-300">{JSON.stringify(v)}</span>
  if (typeof v === 'number') return <span className="text-amber-300">{v}</span>
  if (typeof v === 'boolean') return <span className="text-violet-300">{String(v)}</span>
  if (Array.isArray(v)) {
    if (!v.length) return <span className="text-zinc-500">[]</span>
    return (
      <>
        <span className="text-zinc-500">[</span>
        {v.map((x, i) => (
          <Fragment key={i}>
            {pad}
            <JsonValue v={x} indent={indent + 1} pretty={pretty} />
            {i < v.length - 1 && <span className="text-zinc-500">,</span>}
          </Fragment>
        ))}
        {padEnd}
        <span className="text-zinc-500">]</span>
      </>
    )
  }
  const entries = Object.entries(v as Record<string, unknown>)
  if (!entries.length) return <span className="text-zinc-500">{'{}'}</span>
  return (
    <>
      <span className="text-zinc-500">{'{'}</span>
      {entries.map(([k, x], i) => (
        <Fragment key={k}>
          {pad}
          <span className="text-sky-300">{JSON.stringify(k)}</span>
          <span className="text-zinc-500">: </span>
          <JsonValue v={x} indent={indent + 1} pretty={pretty} />
          {i < entries.length - 1 && <span className="text-zinc-500">,</span>}
        </Fragment>
      ))}
      {padEnd}
      <span className="text-zinc-500">{'}'}</span>
    </>
  )
}

/** One log message: coloured tokens, inline JSON (click to expand), search matches marked. */
export function LogMessage({ text, search }: { text: string; search: RegExp | null }) {
  const [open, setOpen] = useState(false)
  const json = text.length < 20000 ? findJson(text) : null
  if (!json) return <>{highlightText(text, search, 'm')}</>
  return (
    <>
      {highlightText(text.slice(0, json.start), search, 'a')}
      <button type="button" onClick={() => setOpen((o) => !o)} className="text-left hover:bg-white/5 rounded" title={open ? 'Collapse' : 'Expand JSON'}>
        {open ? (
          <span className="block whitespace-pre font-mono">
            <JsonValue v={json.value} indent={0} pretty />
          </span>
        ) : (
          <JsonValue v={json.value} indent={0} pretty={false} />
        )}
      </button>
      {highlightText(text.slice(json.end), search, 'b')}
    </>
  )
}

export function LevelBadge({ level }: { level: Level }) {
  const s = LEVEL_STYLE[level]
  return <span className={cn('inline-block w-9 text-center rounded text-[10px] font-bold leading-5', s.badge)}>{s.label}</span>
}
