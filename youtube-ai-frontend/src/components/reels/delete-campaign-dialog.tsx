'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, ExternalLink, Eye, Loader2, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { errorMessage, reelsApi, type DeletePreview } from '@/lib/reels-api'
import { cn } from '@/lib/utils'
import { compact, PLATFORM_LABEL } from './reel-ui'
import type { PlatformId } from '@/types/publishing'

/**
 * Deleting a campaign removes it from Reels Studio only. Videos already published stay on their platform:
 * this dialog says so and lists them, and the app never offers to delete anything from YouTube.
 */
export function DeleteCampaignDialog({
  channelId,
  campaignId,
  name,
  onClose,
  onDeleted,
}: {
  channelId: string
  campaignId: string
  name: string
  onClose: () => void
  onDeleted: () => void
}) {
  const [data, setData] = useState<DeletePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    reelsApi
      .deletePreview(channelId, campaignId)
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(errorMessage(err)))
    return () => {
      alive = false
    }
  }, [channelId, campaignId])

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await reelsApi.deleteCampaign(channelId, campaignId)
      toast.success('Campaign deleted')
      onDeleted()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  const blocked = !!data?.blockers.length

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={busy ? undefined : onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Trash2 className="w-5 h-5 text-red-500 shrink-0" />
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 truncate">Delete this campaign?</h2>
          </div>
          <button onClick={onClose} disabled={busy} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{name}</p>

          {!data && !error && (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-amber-500" />
            </div>
          )}

          {data && (
            <>
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                This removes the campaign and its {data.reels} reel{data.reels === 1 ? '' : 's'} from Reels Studio. This can&apos;t be undone.
              </p>

              {data.livePosts.length > 0 ? (
                <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/20 space-y-2">
                  <p className="text-xs font-semibold text-sky-700 dark:text-sky-300">
                    {data.livePosts.length} video{data.livePosts.length === 1 ? ' is' : 's are'} already on a platform and will stay there. Delete {data.livePosts.length === 1 ? 'it' : 'them'} in YouTube Studio if you want.
                  </p>
                  <ul className="space-y-1.5">
                    {data.livePosts.map((p, i) => (
                      <li key={i} className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                        <span className="font-bold shrink-0">{PLATFORM_LABEL[p.platform as PlatformId] ?? p.platform}</span>
                        <span className="truncate flex-1">{p.title}</span>
                        {p.status === 'scheduled' && <span className="text-[10px] text-violet-500 shrink-0">scheduled</span>}
                        {p.views !== null && (
                          <span className="flex items-center gap-1 text-zinc-500 shrink-0">
                            <Eye className="w-3 h-3" /> {compact(p.views)}
                          </span>
                        )}
                        {p.url && (
                          <a href={p.url} target="_blank" rel="noreferrer" className="text-emerald-500 shrink-0" title="Open post">
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                  {data.livePosts.some((p) => p.status === 'scheduled') && <p className="text-[11px] text-zinc-500">Scheduled videos will still go live at their time.</p>}
                  <p className="text-[11px] text-zinc-500">Their views keep showing in Performance.</p>
                </div>
              ) : (
                <p className="text-xs text-zinc-500">Nothing from this campaign has been published, so nothing is affected outside the app.</p>
              )}

              {blocked && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-400 flex gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{data.blockers[0]}</span>
                </div>
              )}
            </>
          )}

          {error && <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-500">{error}</div>}
        </div>

        <div className="px-5 py-3 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="px-4 py-2 rounded-xl text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40">
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={!data || blocked || busy}
            className={cn('px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 text-white', 'bg-red-500 hover:bg-red-400 disabled:opacity-40')}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete campaign
          </button>
        </div>
      </div>
    </div>
  )
}
