'use client'

import { AlertTriangle, Clock, Film, Loader2 } from 'lucide-react'
import { reelMediaUrl } from '@/lib/reels-api'
import type { Reel } from '@/types/reel'
import { compact, fmtSec, PLATFORM_SHORT, ReelStatusBadge, ScorePill, SHAPE_LABEL } from './reel-ui'

export function ReelCard({ reel, onOpen }: { reel: Reel; onOpen: (r: Reel) => void }) {
  const busy = reel.status === 'queued' || reel.status === 'rendering'
  return (
    <button
      onClick={() => onOpen(reel)}
      className="group text-left bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-sm hover:border-amber-500/60 transition flex flex-col"
    >
      <div className="relative aspect-[9/16] bg-zinc-950">
        {reel.media?.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={reelMediaUrl(reel.media.cover)} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-zinc-500">
            {busy ? <Loader2 className="w-6 h-6 animate-spin text-amber-500" /> : reel.status === 'failed' ? <AlertTriangle className="w-6 h-6 text-red-500" /> : <Film className="w-6 h-6" />}
            <span className="text-[11px]">{busy ? 'Rendering…' : reel.status === 'failed' ? 'Render failed' : ''}</span>
          </div>
        )}
        <div className="absolute top-2 left-2 flex gap-1">
          <ReelStatusBadge status={reel.status} />
        </div>
        <div className="absolute top-2 right-2">
          <ScorePill value={reel.scores?.overall} />
        </div>
        <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between text-[11px] text-white/90">
          <span className="px-1.5 py-0.5 rounded bg-black/60 flex items-center gap-1">
            <Clock className="w-3 h-3" /> {fmtSec(reel.durationSec)}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-black/60">{SHAPE_LABEL[reel.shape] ?? reel.shape}</span>
        </div>
      </div>
      <div className="p-3 space-y-1">
        <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100 line-clamp-2">{reel.packaging?.title || reel.concept}</p>
        <p className="text-[11px] text-zinc-500 line-clamp-2">&ldquo;{reel.hookText}&rdquo;</p>
        {reel.posts && reel.posts.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {reel.posts.map((p, i) => (
              <span
                key={i}
                title={`${p.platform}: ${p.status}`}
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${p.status === 'published' || p.status === 'scheduled' ? 'bg-emerald-500/10 text-emerald-500' : p.status === 'failed' ? 'bg-red-500/10 text-red-500' : 'bg-zinc-500/10 text-zinc-500'}`}
              >
                {PLATFORM_SHORT[p.platform]}
                {p.views !== null ? ` · ${compact(p.views)}` : p.status === 'published' ? '' : ` · ${p.status}`}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  )
}
