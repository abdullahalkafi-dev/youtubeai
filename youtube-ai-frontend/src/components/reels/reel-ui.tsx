'use client'

import { cn } from '@/lib/utils'
import type { CampaignStatus, ClipRole, ReelShape, ReelStatus } from '@/types/reel'

const CAMPAIGN_STATUS: Record<CampaignStatus, { label: string; cls: string }> = {
  queued: { label: 'Queued', cls: 'bg-zinc-500/10 text-zinc-500' },
  researching: { label: 'Researching', cls: 'bg-sky-500/10 text-sky-500' },
  sourcing: { label: 'Finding videos', cls: 'bg-sky-500/10 text-sky-500' },
  preparing: { label: 'Analyzing videos', cls: 'bg-indigo-500/10 text-indigo-500' },
  composing: { label: 'Editing reels', cls: 'bg-violet-500/10 text-violet-500' },
  rendering: { label: 'Rendering', cls: 'bg-amber-500/10 text-amber-500' },
  completed: { label: 'Completed', cls: 'bg-emerald-500/10 text-emerald-500' },
  partial: { label: 'Partly done', cls: 'bg-lime-500/10 text-lime-600' },
  failed: { label: 'Failed', cls: 'bg-red-500/10 text-red-500' },
  cancelled: { label: 'Cancelled', cls: 'bg-zinc-500/10 text-zinc-400' },
}

const REEL_STATUS: Record<ReelStatus, { label: string; cls: string }> = {
  queued: { label: 'Queued', cls: 'bg-zinc-500/10 text-zinc-500' },
  rendering: { label: 'Rendering', cls: 'bg-amber-500/10 text-amber-500' },
  todo: { label: 'To-do', cls: 'bg-indigo-500/10 text-indigo-500' },
  posted: { label: 'Posted', cls: 'bg-emerald-500/10 text-emerald-500' },
  rejected: { label: 'Rejected', cls: 'bg-zinc-500/10 text-zinc-400' },
  failed: { label: 'Failed', cls: 'bg-red-500/10 text-red-500' },
}

export const SHAPE_LABEL: Record<ReelShape, string> = {
  single_take: 'Single take',
  cold_open: 'Cold open',
  condensed: 'Condensed',
  cross_video: '2 videos',
}

export const ROLE_COLOR: Record<ClipRole, string> = {
  hook: 'bg-rose-500',
  setup: 'bg-sky-500',
  build: 'bg-indigo-500',
  payoff: 'bg-amber-500',
  close: 'bg-emerald-500',
}

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const s = CAMPAIGN_STATUS[status] ?? CAMPAIGN_STATUS.queued
  return <span className={cn('px-2 py-0.5 rounded-md text-[11px] font-semibold whitespace-nowrap', s.cls)}>{s.label}</span>
}

export function ReelStatusBadge({ status }: { status: ReelStatus }) {
  const s = REEL_STATUS[status] ?? REEL_STATUS.queued
  return <span className={cn('px-2 py-0.5 rounded-md text-[11px] font-semibold whitespace-nowrap', s.cls)}>{s.label}</span>
}

export function ScorePill({ value }: { value?: number }) {
  if (value === undefined || value === null) return null
  const cls = value >= 85 ? 'bg-emerald-500/15 text-emerald-500' : value >= 72 ? 'bg-amber-500/15 text-amber-500' : 'bg-zinc-500/15 text-zinc-400'
  return <span className={cn('px-1.5 py-0.5 rounded-md text-[11px] font-bold tabular-nums', cls)}>{value}</span>
}

export function fmtSec(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
