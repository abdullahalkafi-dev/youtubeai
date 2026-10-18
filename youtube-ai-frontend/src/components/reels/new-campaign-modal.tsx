'use client'

import { useState } from 'react'
import { Clapperboard, Lightbulb, Loader2, UploadCloud, X } from 'lucide-react'
import { toast } from 'sonner'
import { reelsApi, errorMessage } from '@/lib/reels-api'
import type { CampaignSummary } from '@/types/reel'
import { UploadVideo } from './upload-video'

const EXAMPLES = [
  'Viral reels about Diddy in federal custody — what really happens to him inside',
  'First night inside: intake stories that warn the youth',
  "Lil Durk's federal case — loyalty, snitching and what the feds are doing",
  'Prison survival codes every young man should hear',
]

export function NewCampaignModal({
  channelId,
  onClose,
  onCreated,
}: {
  channelId: string
  onClose: () => void
  onCreated: (c: CampaignSummary) => void
}) {
  const [mode, setMode] = useState<'choose' | 'topic' | 'video'>('choose')
  const [brief, setBrief] = useState('')
  const [targetReels, setTargetReels] = useState(5)
  const [minSec, setMinSec] = useState(30)
  const [maxSec, setMaxSec] = useState(60)
  const [allowCrossVideo, setAllowCrossVideo] = useState(true)
  const [seeds, setSeeds] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parseSeeds = () =>
    seeds
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => /(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{11})/.exec(s)?.[1] ?? s)
      .filter((s) => /^[A-Za-z0-9_-]{11}$/.test(s))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (brief.trim().length < 8) return setError('Describe what the reels should be about.')
    if (maxSec < minSec + 10) return setError('Max length must be at least 10 seconds more than min length.')
    setBusy(true)
    try {
      const c = await reelsApi.createCampaign(channelId, {
        brief: brief.trim(),
        targetReels,
        minSec,
        maxSec,
        allowCrossVideo,
        seedVideoIds: parseSeeds(),
      })
      toast.success('Campaign started — research is running')
      onCreated(c)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (mode !== 'topic') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clapperboard className="w-5 h-5 text-amber-500" />
              <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{mode === 'video' ? 'Reels from my new video' : 'New reel campaign'}</h2>
            </div>
            <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <X className="w-5 h-5" />
            </button>
          </div>
          {mode === 'video' ? (
            <UploadVideo channelId={channelId} onCreated={onCreated} onBack={() => setMode('choose')} />
          ) : (
            <div className="p-6 grid sm:grid-cols-2 gap-4">
              <button type="button" onClick={() => setMode('topic')} className="text-left p-5 rounded-2xl border-2 border-zinc-200 dark:border-zinc-700 hover:border-amber-500 transition space-y-2">
                <Lightbulb className="w-7 h-7 text-amber-500" />
                <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">From a topic</p>
                <p className="text-xs text-zinc-500">Type a person, case or theme. We find the best moments across all your YouTube videos.</p>
              </button>
              <button type="button" onClick={() => setMode('video')} className="text-left p-5 rounded-2xl border-2 border-zinc-200 dark:border-zinc-700 hover:border-amber-500 transition space-y-2">
                <UploadCloud className="w-7 h-7 text-amber-500" />
                <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">From my new video</p>
                <p className="text-xs text-zinc-500">Upload the raw file of a video you just made — even before it is on YouTube — and get reels from it.</p>
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <form
        onSubmit={submit}
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clapperboard className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">New reel campaign</h2>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1">What should the reels be about?</label>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={3}
              maxLength={600}
              placeholder="e.g. Viral reels about Diddy's first months in federal custody"
              className="w-full px-4 py-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-sm focus:outline-none focus:border-amber-500 dark:text-zinc-100 resize-none"
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setBrief(ex)}
                  className="px-2.5 py-1 rounded-lg text-[11px] bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-amber-500"
                >
                  {ex.length > 52 ? ex.slice(0, 50) + '…' : ex}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-zinc-400 mt-2">
              The system researches what is working online, finds your best videos on it, and builds hook → story → payoff reels. Topics you already covered are not repeated.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <NumberField label="Reels" value={targetReels} min={1} max={10} onChange={setTargetReels} />
            <NumberField label="Min length (s)" value={minSec} min={15} max={90} onChange={setMinSec} />
            <NumberField label="Max length (s)" value={maxSec} min={25} max={120} onChange={setMaxSec} />
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={allowCrossVideo} onChange={(e) => setAllowCrossVideo(e.target.checked)} className="mt-1 accent-amber-500" />
            <span>
              <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Allow combining two videos in one reel</span>
              <span className="block text-[11px] text-zinc-500">Only used when a hook or verdict from another episode makes the reel clearly stronger.</span>
            </span>
          </label>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1">Must-use videos (optional)</label>
            <input
              value={seeds}
              onChange={(e) => setSeeds(e.target.value)}
              placeholder="Paste YouTube links or IDs of your videos, separated by spaces"
              className="w-full px-4 py-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-sm focus:outline-none focus:border-amber-500 dark:text-zinc-100"
            />
          </div>

          {error && <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-500">{error}</div>}
        </div>

        <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
          <p className="text-[11px] text-zinc-400">Usually 20–40 minutes. Reels land in To-do — nothing is posted automatically.</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
              Cancel
            </button>
            <button type="submit" disabled={busy} className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold text-sm flex items-center gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Start campaign
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
        className="w-full px-3 py-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-sm focus:outline-none focus:border-amber-500 dark:text-zinc-100"
      />
    </div>
  )
}
