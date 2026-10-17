'use client'

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Cpu, HardDrive, MemoryStick, ScrollText, Timer } from 'lucide-react'
import { fmtBytes, fmtUptime, type OpsContainer, type OpsSystem } from '@/lib/ops-api'
import { cn } from '@/lib/utils'
import type { ReelServiceStatus } from '@/types/reel'

export interface Sample {
  t: string
  cpu: number
  mem: number
}

const tone = (pct: number) => (pct >= 90 ? 'text-red-400' : pct >= 70 ? 'text-amber-400' : 'text-emerald-400')
const bar = (pct: number) => (pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500')

function Gauge({ icon, label, pct, main, sub }: { icon: React.ReactNode; label: string; pct: number | null; main: string; sub: string }) {
  const p = pct ?? 0
  return (
    <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800">
      <div className="flex items-center justify-between text-zinc-400 text-[11px] font-semibold uppercase tracking-wider">
        <span className="flex items-center gap-1.5">
          {icon} {label}
        </span>
        {pct !== null && <span className={cn('tabular-nums', tone(p))}>{p.toFixed(0)}%</span>}
      </div>
      <p className="text-2xl font-bold text-white tabular-nums mt-1">{main}</p>
      <p className="text-[11px] text-zinc-500">{sub}</p>
      {pct !== null && (
        <div className="h-1.5 rounded-full bg-zinc-800 mt-3 overflow-hidden">
          <div className={cn('h-full rounded-full transition-all', bar(p))} style={{ width: `${Math.min(100, p)}%` }} />
        </div>
      )}
    </div>
  )
}

function History({ data, k, label, color }: { data: Sample[]; k: 'cpu' | 'mem'; label: string; color: string }) {
  return (
    <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-2">{label} — last {Math.round((data.length * 3) / 60) || 1} min</p>
      <div className="h-28">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
            <defs>
              <linearGradient id={`g-${k}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.45} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="t" hide />
            <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: '#71717a' }} tickCount={3} />
            <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 11 }} formatter={(v) => [`${Number(v).toFixed(1)}%`, label]} />
            <Area type="monotone" dataKey={k} stroke={color} strokeWidth={2} fill={`url(#g-${k})`} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export function SystemOverview({
  sys,
  history,
  reels,
  onOpenLogs,
}: {
  sys: OpsSystem
  history: Sample[]
  reels: ReelServiceStatus | null
  onOpenLogs: (c: OpsContainer) => void
}) {
  const memPct = (sys.memory.used / sys.memory.total) * 100
  const diskPct = (sys.disk.used / sys.disk.total) * 100
  const groups = new Map<string, OpsContainer[]>()
  for (const c of sys.containers) groups.set(c.project || 'other', [...(groups.get(c.project || 'other') ?? []), c])
  const projectLabel = (p: string) => (p === 'youtubeai' ? 'Main app' : p === 'youtubeai-reels' ? 'Reel service' : p === 'youtubeai-ops' ? 'Developer tools' : p)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Gauge icon={<Cpu className="w-3.5 h-3.5" />} label="CPU" pct={sys.cpu} main={sys.cpu === null ? '…' : `${sys.cpu.toFixed(1)}%`} sub={`${sys.host.cores} cores · load ${sys.host.load.map((l) => l.toFixed(2)).join(' / ')}`} />
        <Gauge icon={<MemoryStick className="w-3.5 h-3.5" />} label="Memory" pct={memPct} main={fmtBytes(sys.memory.used)} sub={`of ${fmtBytes(sys.memory.total)} · ${fmtBytes(sys.memory.available)} free`} />
        <Gauge icon={<HardDrive className="w-3.5 h-3.5" />} label="Disk" pct={diskPct} main={fmtBytes(sys.disk.used)} sub={`of ${fmtBytes(sys.disk.total)} · ${fmtBytes(sys.disk.free)} free`} />
        <Gauge icon={<Timer className="w-3.5 h-3.5" />} label="Uptime" pct={null} main={fmtUptime(sys.host.uptimeSec)} sub={`${sys.containers.filter((c) => c.state === 'running').length}/${sys.containers.length} containers running`} />
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <History data={history} k="cpu" label="CPU" color="#f59e0b" />
        <History data={history} k="mem" label="Memory" color="#38bdf8" />
      </div>

      <div className="rounded-2xl bg-zinc-900 border border-zinc-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800 text-xs font-bold text-white">Containers</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="text-left px-4 py-2">Container</th>
                <th className="text-left px-3">State</th>
                <th className="text-left px-3 w-[22%]">CPU</th>
                <th className="text-left px-3 w-[26%]">Memory</th>
                <th className="text-right px-4">Logs</th>
              </tr>
            </thead>
            <tbody>
              {[...groups.entries()].map(([project, list]) => (
                <GroupRows key={project} label={projectLabel(project)} list={list} cores={sys.host.cores} onOpenLogs={onOpenLogs} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800">
          <p className="text-xs font-bold text-white mb-3">Reel queues</p>
          {!reels ? (
            <p className="text-xs text-zinc-500">Reel service not reachable.</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {Object.entries(reels.queues).map(([name, q]) => (
                <div key={name} className="p-2 rounded-lg bg-zinc-950 border border-zinc-800 text-center">
                  <p className="text-[10px] uppercase text-zinc-500">{name}</p>
                  <p className="text-sm font-bold tabular-nums">
                    <span className={q.active ? 'text-emerald-400' : 'text-zinc-300'}>{q.active}</span>
                    <span className="text-zinc-600"> / </span>
                    <span className={q.waiting ? 'text-amber-400' : 'text-zinc-500'}>{q.waiting}</span>
                  </p>
                  {!!q.failed && <p className="text-[10px] text-red-400">{q.failed} failed</p>}
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-zinc-500 mt-2">active / waiting jobs</p>
        </div>
        <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800">
          <p className="text-xs font-bold text-white mb-3">Storage by Docker volume</p>
          {!sys.docker ? (
            <p className="text-xs text-zinc-500">Calculating…</p>
          ) : (
            <div className="space-y-1.5">
              {sys.docker.volumes.slice(0, 8).map((v) => (
                <div key={v.name} className="flex items-center gap-2 text-xs">
                  <span className="flex-1 truncate text-zinc-300 font-mono text-[11px]">{v.name}</span>
                  <span className="tabular-nums text-zinc-400">{fmtBytes(v.size)}</span>
                </div>
              ))}
              <div className="flex justify-between text-[11px] text-zinc-500 pt-1 border-t border-zinc-800">
                <span>Images {fmtBytes(sys.docker.images)}</span>
                <span>Build cache {fmtBytes(sys.docker.buildCache)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function GroupRows({ label, list, cores, onOpenLogs }: { label: string; list: OpsContainer[]; cores: number; onOpenLogs: (c: OpsContainer) => void }) {
  return (
    <>
      <tr>
        <td colSpan={5} className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-amber-400/80">
          {label}
        </td>
      </tr>
      {list.map((c) => {
        const cpuPct = c.cpu === null ? null : Math.min(100, c.cpu / Math.max(1, cores))
        const memPct = c.mem && c.memLimit ? (c.mem / c.memLimit) * 100 : null
        const running = c.state === 'running'
        return (
          <tr key={c.id} className="border-t border-zinc-800/60 hover:bg-white/[0.03]">
            <td className="px-4 py-2">
              <p className="font-semibold text-zinc-100">{c.service || c.name}</p>
              <p className="text-[10px] text-zinc-500 font-mono">{c.name}</p>
            </td>
            <td className="px-3">
              <span className={cn('px-2 py-0.5 rounded-md text-[10px] font-bold', running ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300')}>{c.state}</span>
              <p className="text-[10px] text-zinc-500 mt-0.5">{c.status}</p>
            </td>
            <td className="px-3">
              {cpuPct === null ? (
                <span className="text-zinc-600">—</span>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                    <div className={cn('h-full', bar(cpuPct))} style={{ width: `${Math.max(1, cpuPct)}%` }} />
                  </div>
                  <span className="w-12 text-right tabular-nums text-zinc-300">{c.cpu!.toFixed(1)}%</span>
                </div>
              )}
            </td>
            <td className="px-3">
              {c.mem === null ? (
                <span className="text-zinc-600">—</span>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                    <div className={cn('h-full', bar(memPct ?? 0))} style={{ width: `${Math.max(1, memPct ?? 0)}%` }} />
                  </div>
                  <span className="w-28 text-right tabular-nums text-zinc-300">
                    {fmtBytes(c.mem)}
                    <span className="text-zinc-600"> / {fmtBytes(c.memLimit)}</span>
                  </span>
                </div>
              )}
            </td>
            <td className="px-4 text-right">
              <button onClick={() => onOpenLogs(c)} className="px-2 py-1 rounded-md bg-zinc-800 text-zinc-300 hover:text-white text-[11px] font-semibold inline-flex items-center gap-1">
                <ScrollText className="w-3 h-3" /> Logs
              </button>
            </td>
          </tr>
        )
      })}
    </>
  )
}
