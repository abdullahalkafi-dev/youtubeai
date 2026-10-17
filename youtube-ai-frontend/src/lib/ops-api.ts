import { ApiError, getApiBaseUrl } from '@/lib/api'

/** Developer portal: read-only server health and container logs (served by the ops agent under /api/ops). */

export interface OpsContainer {
  id: string
  name: string
  image: string
  state: string
  status: string
  project: string
  service: string
  cpu: number | null
  mem: number | null
  memLimit: number | null
  net?: { rx: number; tx: number }
}

export interface OpsSystem {
  at: string
  cpu: number | null
  memory: { total: number; available: number; used: number; swapTotal: number; swapUsed: number }
  disk: { total: number; free: number; used: number }
  host: { load: number[]; uptimeSec: number; cores: number }
  containers: OpsContainer[]
  docker: { volumes: Array<{ name: string; size: number }>; images: number; buildCache: number } | null
}

export interface OpsLogLine {
  ts: string | null
  stream: 'stdout' | 'stderr'
  text: string
}

const token = () => (typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null)
const headers = (): Record<string, string> => {
  const t = token()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}/api/ops${path}`, { headers: headers(), signal: AbortSignal.timeout(60000) })
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }))
    throw new ApiError(data.error || `Error ${res.status}`, res.status, data)
  }
  return res.json()
}

export const opsApi = {
  me: () => get<{ email: string; allowed: boolean }>('/me'),
  system: () => get<OpsSystem>('/system'),
  logs: (container: string, tail: number) => get<{ container: string; lines: OpsLogLine[] }>(`/logs/${container}?tail=${tail}`),

  /** Follows a container's log live. Returns a function that stops it. */
  follow(container: string, onLines: (lines: OpsLogLine[]) => void, onEnd: (err?: string) => void): () => void {
    const ctrl = new AbortController()
    ;(async () => {
      try {
        const res = await fetch(`${getApiBaseUrl()}/api/ops/logs/${container}/stream`, { headers: headers(), signal: ctrl.signal })
        if (!res.ok || !res.body) return onEnd(`Live view failed (${res.status})`)
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          const parts = buf.split('\n')
          buf = parts.pop() ?? ''
          const lines: OpsLogLine[] = []
          for (const p of parts) {
            if (!p) continue
            try {
              const obj = JSON.parse(p)
              if (!obj.heartbeat) lines.push(obj)
            } catch {
              /* ignore partial line */
            }
          }
          if (lines.length) onLines(lines)
        }
        onEnd()
      } catch (err) {
        if (!ctrl.signal.aborted) onEnd((err as Error).message)
      }
    })()
    return () => ctrl.abort()
  },
}

export const fmtBytes = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${u[i]}`
}

export const fmtUptime = (sec: number) => {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
}
