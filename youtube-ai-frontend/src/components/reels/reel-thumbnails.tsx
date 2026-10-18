'use client'

import { useState } from 'react'
import { Check, Download, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { errorMessage, reelMediaUrl, reelsApi } from '@/lib/reels-api'
import { cn } from '@/lib/utils'
import type { Reel } from '@/types/reel'

/** Pick the thumbnail that goes to YouTube with the reel, or make a new pair. */
export function ReelThumbnails({ channelId, reel, onChanged }: { channelId: string; reel: Reel; onChanged: (r: Reel) => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const list = reel.thumbnails ?? []
  const ready = reel.status === 'todo' || reel.status === 'posted' || reel.status === 'rejected'
  if (!ready) return null

  const choose = async (id: string) => {
    setBusy(id)
    try {
      onChanged(await reelsApi.chooseThumbnail(channelId, reel.id, id))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }
  const regenerate = async () => {
    setBusy('new')
    try {
      onChanged(await reelsApi.regenerateThumbnails(channelId, reel.id))
      toast.success('New thumbnails are ready')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">Thumbnail</h3>
        <button onClick={regenerate} disabled={!!busy} className="text-[11px] font-semibold text-zinc-500 hover:text-amber-500 disabled:opacity-50 flex items-center gap-1">
          {busy === 'new' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          {busy === 'new' ? 'Making new ones… (about 20 s)' : list.length ? 'Make new ones' : 'Make thumbnails'}
        </button>
      </div>
      {list.length === 0 ? (
        <p className="text-xs text-zinc-500">{busy === 'new' ? 'Working on it…' : 'No thumbnail yet.'}</p>
      ) : (
        <div className="flex gap-3">
          {list.map((t) => (
            <div key={t.id} className="w-32">
              <button
                onClick={() => !t.chosen && choose(t.id)}
                disabled={!!busy}
                className={cn('relative block w-full aspect-[9/16] rounded-xl overflow-hidden border-2 transition', t.chosen ? 'border-amber-500 shadow-lg' : 'border-transparent opacity-80 hover:opacity-100')}
                title={t.chosen ? 'This one goes to YouTube' : 'Use this one'}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={reelMediaUrl(t.url)} alt={t.headline} className="w-full h-full object-cover" loading="lazy" />
                {t.chosen && (
                  <span className="absolute top-1.5 right-1.5 p-1 rounded-full bg-amber-500 text-black">
                    <Check className="w-3 h-3" />
                  </span>
                )}
                {busy === t.id && (
                  <span className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <Loader2 className="w-5 h-5 animate-spin text-white" />
                  </span>
                )}
              </button>
              <a href={reelMediaUrl(t.url)} download className="mt-1 text-[10px] text-zinc-500 hover:text-amber-500 flex items-center gap-1">
                <Download className="w-3 h-3" /> Download
              </a>
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-zinc-400 mt-1.5">The highlighted one is added to YouTube when you publish.</p>
    </section>
  )
}
