'use client'

import { useState } from 'react'
import { ImageOff, Loader2, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { errorMessage, reelMediaUrl, reelsApi } from '@/lib/reels-api'
import type { Reel } from '@/types/reel'

/** The AI images shown during this reel, with Replace / Remove (each triggers a quick re-render). */
export function ReelImages({ channelId, reel, onChanged }: { channelId: string; reel: Reel; onChanged: (r: Reel) => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const list = reel.visuals ?? []
  if (!list.length) return null
  const rendering = reel.status === 'queued' || reel.status === 'rendering'

  const act = async (id: string, action: 'replace' | 'remove') => {
    setBusy(id + action)
    try {
      await reelsApi.changeVisual(channelId, reel.id, id, action)
      toast.success(action === 'replace' ? 'Making a new image — the reel updates in about a minute' : 'Image removed — the reel updates in about a minute')
      onChanged({ ...reel, status: 'queued', media: null })
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section>
      <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2 flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5 text-amber-500" /> AI images in this reel
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {list.map((v) => (
          <div key={v.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-zinc-50 dark:bg-zinc-800/40">
            <div className="aspect-[1080/760] bg-zinc-900 flex items-center justify-center">
              {v.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={reelMediaUrl(v.url)} alt={v.purpose} className="w-full h-full object-cover" loading="lazy" />
              ) : v.status === 'failed' ? (
                <ImageOff className="w-5 h-5 text-zinc-500" />
              ) : (
                <Loader2 className="w-5 h-5 animate-spin text-amber-500" />
              )}
            </div>
            <div className="p-2 space-y-1">
              <p className="text-[10px] text-zinc-500">
                at {v.at.toFixed(1)}s · {v.duration.toFixed(1)}s{v.realPerson ? ' · real person' : ''}
              </p>
              <p className="text-[11px] text-zinc-700 dark:text-zinc-300 line-clamp-2" title={v.purpose}>
                {v.status === 'failed' ? 'Could not create this image' : v.purpose}
              </p>
              <div className="flex gap-1">
                <button
                  onClick={() => act(v.id, 'replace')}
                  disabled={rendering || !!busy}
                  className="flex-1 px-1.5 py-1 rounded-md bg-zinc-200/70 dark:bg-zinc-700/60 text-[10px] font-semibold text-zinc-700 dark:text-zinc-200 hover:text-amber-600 disabled:opacity-40 flex items-center justify-center gap-1"
                >
                  {busy === v.id + 'replace' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} {v.status === 'failed' ? 'Try again' : 'Replace'}
                </button>
                <button
                  onClick={() => act(v.id, 'remove')}
                  disabled={rendering || !!busy}
                  title="Remove this image"
                  className="px-1.5 py-1 rounded-md bg-zinc-200/70 dark:bg-zinc-700/60 text-zinc-500 hover:text-red-500 disabled:opacity-40"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {list.some((v) => v.realPerson) && <p className="text-[10px] text-zinc-400 mt-1.5">Reels with realistic images of real people are marked as AI-altered when published, as YouTube requires.</p>}
    </section>
  )
}
