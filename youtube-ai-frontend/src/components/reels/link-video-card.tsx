'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Link2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { errorMessage, reelsApi } from '@/lib/reels-api'
import { cn } from '@/lib/utils'
import { timeAgo } from './reel-ui'

type Data = Awaited<ReturnType<typeof reelsApi.linkCandidates>>

/** For campaigns made from an uploaded video: once the full video is on YouTube, link it so reel descriptions point to it. */
export function LinkVideoCard({ channelId, campaignId }: { channelId: string; campaignId: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    reelsApi
      .linkCandidates(channelId, campaignId)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null))
    return () => {
      alive = false
    }
  }, [channelId, campaignId, tick])

  if (!data) return null
  const linked = data.linked ? data.candidates.find((c) => c.youtubeId === data.linked) : null

  const link = async (youtubeId: string) => {
    setBusy(youtubeId)
    try {
      const r = await reelsApi.linkVideo(channelId, campaignId, youtubeId)
      toast.success(`Linked — ${r.updated} reel description${r.updated === 1 ? '' : 's'} now point to the full video`)
      setTick((t) => t + 1)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
      <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
        <Link2 className="w-4 h-4 text-amber-500" /> Full video on YouTube
      </h2>
      {data.linked ? (
        <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2 flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4" /> Linked to {linked ? `"${linked.title}"` : data.linked}. Reel descriptions point to it.
        </p>
      ) : (
        <>
          <p className="text-xs text-zinc-500 mt-1">
            These reels come from a video you uploaded. When the full video is published on YouTube, pick it here so each reel&apos;s description links to it.
          </p>
          {data.candidates.length === 0 ? (
            <p className="text-xs text-zinc-400 mt-2">No new videos on the channel yet. Check back after you publish it.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {data.candidates.slice(0, 6).map((c) => (
                <li key={c.youtubeId} className={cn('flex items-center gap-3 p-2 rounded-xl', c.likely ? 'bg-amber-500/10' : 'bg-zinc-50 dark:bg-zinc-800/50')}>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate">{c.title}</p>
                    <p className="text-[10px] text-zinc-500">
                      {timeAgo(c.publishedAt)}
                      {c.likely ? ' · same length as your upload' : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => link(c.youtubeId)}
                    disabled={!!busy}
                    className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black text-[11px] font-bold flex items-center gap-1"
                  >
                    {busy === c.youtubeId && <Loader2 className="w-3 h-3 animate-spin" />} This is it
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
