'use client'
import { useState } from 'react'
import { Settings2, Loader2, X } from 'lucide-react'
import api, { formatAssetUrl } from '@/lib/api'
import type { CreativePreferences } from '@/types/studio'
import { toast } from 'sonner'

export function CreativePreferencesButton({ channelId }: { channelId: string }) {
  const [open, setOpen] = useState(false)
  const [preferences, setPreferences] = useState<CreativePreferences | null>(null)
  const [busy, setBusy] = useState(false)
  const load = async () => {
    setOpen(true); setBusy(true)
    try { setPreferences(await api.get<CreativePreferences>('/api/channels/' + channelId + '/creative-preferences')) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not load preferences') }
    finally { setBusy(false) }
  }
  const [refFile, setRefFile] = useState<File | null>(null)
  const [refRole, setRefRole] = useState<'style' | 'counterexample' | 'identity'>('style')
  const [refText, setRefText] = useState('')
  const uploadReference = async () => {
    if (!refFile) return
    if (refRole === 'identity' && !refText.trim()) { toast.error('Enter the subject name for a face photo'); return }
    setBusy(true)
    try {
      const updated = await api.uploadCreativeReference(channelId, refFile, refRole, refText.trim()) as CreativePreferences
      // Keep unsaved edits in the form; only take the new revision and reference lists.
      setPreferences(prev => prev ? { ...prev, revision: updated.revision, visualReferenceAssets: updated.visualReferenceAssets, identityReferences: updated.identityReferences } : updated)
      setRefFile(null); setRefText('')
      toast.success('Reference saved')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not upload reference') }
    finally { setBusy(false) }
  }
  const save = async () => {
    if (!preferences) return
    setBusy(true)
    try {
      setPreferences(await api.patch<CreativePreferences>('/api/channels/' + channelId + '/creative-preferences', preferences))
      toast.success('Creative preferences saved'); setOpen(false)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save preferences') }
    finally { setBusy(false) }
  }
  return <>
    <button onClick={load} title="Creative preferences" aria-label="Creative preferences" className="p-2 text-gray-500 hover:text-indigo-600"><Settings2 className="h-4 w-4" /></button>
    {open && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="creative-preferences-title" className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-800 p-5 space-y-4">
        <div className="flex justify-between"><h2 id="creative-preferences-title" className="font-semibold text-lg">Creative preferences</h2><button onClick={() => setOpen(false)} aria-label="Close preferences"><X className="h-4 w-4" /></button></div>
        <p className="text-sm text-gray-500">Explicit instructions apply to future episodes. Remove a line to forget that preference.</p>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {preferences && <form onSubmit={e => { e.preventDefault(); void save() }} className="space-y-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={preferences.enabled} onChange={e => setPreferences({ ...preferences, enabled: e.target.checked })} /> Agent workflow for new requests</label>
          <div className="grid grid-cols-3 gap-3">
            <label className="text-sm">Minimum minutes<input type="number" min={1} max={180} value={preferences.duration.min} onChange={e => setPreferences({ ...preferences, duration: { ...preferences.duration, min: +e.target.value } })} className="mt-1 w-full rounded border bg-transparent p-2" /></label>
            <label className="text-sm">Maximum minutes<input type="number" min={preferences.duration.min} max={180} value={preferences.duration.max} onChange={e => setPreferences({ ...preferences, duration: { ...preferences.duration, max: +e.target.value } })} className="mt-1 w-full rounded border bg-transparent p-2" /></label>
            <label className="text-sm">Words per minute<input type="number" min={60} max={240} value={preferences.wordsPerMinute} onChange={e => setPreferences({ ...preferences, wordsPerMinute: +e.target.value })} className="mt-1 w-full rounded border bg-transparent p-2" /></label>
          </div>
          <label className="block text-sm">Standing instructions<textarea value={preferences.instructions.join('\n')} onChange={e => setPreferences({ ...preferences, instructions: e.target.value.split('\n') })} className="mt-1 min-h-36 w-full rounded border bg-transparent p-2" placeholder="One preference per line" /></label>
          <label className="block text-sm">Approved script examples<textarea value={preferences.approvedExamples.join('\n\n---\n\n')} onChange={e => setPreferences({ ...preferences, approvedExamples: e.target.value.split('\n\n---\n\n').filter(Boolean) })} className="mt-1 min-h-28 w-full rounded border bg-transparent p-2" /></label>
          <label className="block text-sm">Visual reference notes<textarea value={preferences.visualReferences.join('\n')} onChange={e => setPreferences({ ...preferences, visualReferences: e.target.value.split('\n').filter(Boolean) })} className="mt-1 min-h-24 w-full rounded border bg-transparent p-2" placeholder="Describe approved layouts, expressions and colors" /></label>
          <fieldset className="space-y-3 rounded-lg border border-gray-200 dark:border-gray-800 p-3">
            <legend className="px-1 text-sm font-medium">Reference images</legend>
            <p className="text-xs text-gray-500">Style references show the look to follow. Counterexamples show what to avoid. Face photos are used for that subject before any web search.</p>
            <ul className="space-y-2">
              {(preferences.visualReferenceAssets || []).map((asset, i) => <li key={asset.url} className="flex items-center gap-3 text-xs">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={formatAssetUrl(asset.url)} alt={asset.role} className="h-10 w-16 rounded object-cover" />
                <span className="rounded bg-gray-100 dark:bg-gray-800 px-2 py-0.5">{asset.role === 'style' ? 'Follow this look' : 'Avoid this'}</span>
                <span className="flex-1 truncate">{asset.note}</span>
                <button type="button" aria-label={'Remove reference ' + (i + 1)} onClick={() => setPreferences({ ...preferences, visualReferenceAssets: preferences.visualReferenceAssets.filter(a => a.url !== asset.url) })}><X className="h-3 w-3" /></button>
              </li>)}
              {(preferences.identityReferences || []).map(face => <li key={face.url} className="flex items-center gap-3 text-xs">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={formatAssetUrl(face.url)} alt={'Face photo of ' + face.name} className="h-10 w-10 rounded object-cover" />
                <span className="rounded bg-gray-100 dark:bg-gray-800 px-2 py-0.5">Face</span>
                <span className="flex-1 truncate">{face.name}</span>
                <button type="button" aria-label={'Remove face photo of ' + face.name} onClick={() => setPreferences({ ...preferences, identityReferences: preferences.identityReferences.filter(a => a.url !== face.url) })}><X className="h-3 w-3" /></button>
              </li>)}
            </ul>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Reference image file" onChange={e => setRefFile(e.target.files?.[0] || null)} className="text-xs" />
              <select aria-label="Reference type" value={refRole} onChange={e => setRefRole(e.target.value as typeof refRole)} className="rounded border bg-transparent p-1 text-xs">
                <option value="style">Follow this look</option>
                <option value="counterexample">Avoid this</option>
                <option value="identity">Face photo of a subject</option>
              </select>
              <input value={refText} onChange={e => setRefText(e.target.value)} placeholder={refRole === 'identity' ? 'Subject name, e.g. Keefe D' : 'Why (optional), e.g. strong tears, full wording'} aria-label="Reference note" className="rounded border bg-transparent p-1 text-xs" />
              <button type="button" disabled={busy || !refFile} onClick={() => void uploadReference()} className="rounded border px-3 py-1 text-xs">Add reference</button>
            </div>
          </fieldset>
          <div className="flex gap-5 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={preferences.excludeHost} onChange={e => setPreferences({ ...preferences, excludeHost: e.target.checked })} /> Omit host portrait by default</label><label className="flex items-center gap-2"><input type="checkbox" checked={preferences.excludeLogo} onChange={e => setPreferences({ ...preferences, excludeLogo: e.target.checked })} /> Omit logo by default</label></div>
          <button disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white">Save preferences</button>
        </form>}
      </div>
    </div>}
  </>
}
