'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Hand, Lock } from 'lucide-react'
import api from '@/lib/api'
import { errorMessage, reelsApi } from '@/lib/reels-api'
import { cn } from '@/lib/utils'
import type { AccountsResponse } from '@/types/publishing'
import { PLATFORM_LABEL } from './reel-ui'

/** Where reels can be published from this workspace. YouTube is live; the rest are shown as "coming soon". */
export function AccountsBar({ channelId, refreshKey = 0 }: { channelId: string; refreshKey?: number }) {
  const [state, setState] = useState<{ key: string; data?: AccountsResponse; error?: string } | null>(null)
  const key = `${channelId}:${refreshKey}`

  useEffect(() => {
    if (!channelId) return
    let alive = true
    reelsApi
      .accounts(channelId)
      .then((data) => alive && setState({ key, data }))
      .catch((err) => alive && setState({ key, error: errorMessage(err) }))
    return () => {
      alive = false
    }
  }, [channelId, key])

  if (!state || state.key !== key) return null
  if (state.error || !state.data) {
    return <div className="p-3 rounded-xl bg-zinc-500/10 text-xs text-zinc-500">Publishing accounts are unavailable right now ({state.error}).</div>
  }
  const { accounts, planned } = state.data

  return (
    <div className="flex flex-wrap items-center gap-2">
      {accounts.map((a) => {
        const ok = a.state === 'ok'
        return (
          <div
            key={a.platform}
            className={cn(
              'flex items-center gap-2 pl-2.5 pr-3 py-1.5 rounded-xl border text-xs',
              ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/10',
            )}
          >
            {ok ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <AlertTriangle className="w-4 h-4 text-amber-500" />}
            <span className="font-semibold text-zinc-800 dark:text-zinc-200">{PLATFORM_LABEL[a.platform]}</span>
            {a.displayName && <span className="text-zinc-500">{a.displayName}</span>}
            {a.quota && (
              <span className="text-[11px] text-zinc-400" title="Uploads today (resets at midnight Pacific time)">
                {a.quota.usedToday}/{a.quota.dailyCap} today
              </span>
            )}
            {!ok && (
              <button
                onClick={() => (window.location.href = api.getGoogleAuthUrl())}
                title={a.message}
                className="ml-1 px-2 py-0.5 rounded-md bg-amber-500 text-black font-bold text-[11px] hover:bg-amber-400"
              >
                Reconnect Google
              </button>
            )}
          </div>
        )
      })}
      {planned.map((p) => (
        <div key={p} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 text-xs text-zinc-400">
          <Lock className="w-3 h-3" /> {PLATFORM_LABEL[p]} <span className="text-[10px]">soon</span>
        </div>
      ))}
      <span className="ml-auto flex items-center gap-1 text-[11px] text-zinc-400">
        <Hand className="w-3.5 h-3.5" /> Manual publishing — nothing is posted unless you press Publish
      </span>
    </div>
  )
}
