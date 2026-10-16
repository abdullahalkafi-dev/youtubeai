'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, RefreshCw, Pencil, Download, Square, History } from 'lucide-react'
import api, { formatAssetUrl } from '@/lib/api'
import type { StudioRun, StudioArtifact } from '@/types/studio'
import { MarkdownRenderer } from './markdown-renderer'
import { SourcesSection } from './sources-section'
import { ScriptRenderer } from './script-renderer'
import { toast } from 'sonner'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { selectThread, refreshThreadSilent } from '@/store/slices/chat-slice'

const terminal = ['completed', 'completed_with_issues', 'failed', 'cancelled', 'waiting_for_input']
const stageLabels: Record<string, string> = { planning: 'Understanding your episode', researching: 'Researching the story and your channel', planning_story: 'Planning the story', packaging: 'Developing the title and thumbnails', writing: 'Writing your script', reviewing: 'Reviewing your outputs', ready: 'Ready' }
function scriptMarkdown(artifact: StudioArtifact) {
  return '# SCRIPT TITLE: ' + artifact.data.title + '\n\n' + (artifact.data.sections || []).map((section, i) =>
    '## **' + (i + 1) + '. ' + section.title + '**\n\n' + section.blocks.map(block => block.lines.map(line => '> ' + line).join('\n') + (block.cue ? '\n\n[' + block.cue + ']' : '')).join('\n\n') +
    (section.jewel?.length ? '\n\n### **JEWEL**\n\n' + section.jewel.map(line => '> ' + line).join('\n') + '\n\n[PAUSE]' : '')
  ).join('\n\n')
}
function ArtifactVersions({ threadId, artifactId }: { threadId: string; artifactId: string }) {
  const [versions, setVersions] = useState<StudioArtifact[]>([])
  const [selected, setSelected] = useState<string>('')
  const [error, setError] = useState('')
  useEffect(() => {
    let disposed = false
    api.get<StudioArtifact[]>('/api/threads/' + threadId + '/artifacts/' + artifactId + '/versions')
      .then(items => { if (!disposed) { setVersions(items); setSelected(artifactId) } })
      .catch(e => { if (!disposed) setError(e instanceof Error ? e.message : 'Could not load versions') })
    return () => { disposed = true }
  }, [threadId, artifactId])
  const artifact = versions.find(version => version._id === selected)
  return <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 space-y-3" aria-label="Artifact version history">
    <p className="text-xs font-semibold">Version history</p>
    {error && <p role="alert" className="text-xs text-amber-600">{error}</p>}
    {!versions.length && !error && <p role="status" className="text-xs">Loading versions...</p>}
    <div className="flex gap-2 flex-wrap">{versions.map(version => <button key={version._id} onClick={() => setSelected(version._id)} aria-pressed={selected === version._id} className="rounded border px-2 py-1 text-xs aria-pressed:bg-indigo-100 dark:aria-pressed:bg-indigo-950">Version {version.version}{version.outdated ? ' (previous)' : ''}</button>)}</div>
    {artifact && <div className="space-y-2">
      <p className="text-xs text-gray-500">{artifact.status.replaceAll('_', ' ')}</p>
      {artifact.data.url && <a href={formatAssetUrl(artifact.data.url)} target="_blank" rel="noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={formatAssetUrl(artifact.data.url)} alt={'Version ' + artifact.version} className="w-full rounded" />
      </a>}
      {artifact.kind === 'script' ? <ScriptRenderer content={scriptMarkdown(artifact)} threadId={threadId} videoTitle={artifact.data.title} /> : <MarkdownRenderer content={[
        artifact.data.title ? '## ' + artifact.data.title : '', artifact.data.content, artifact.data.description,
        artifact.data.tags?.join(', '), artifact.data.concept?.text,
      ].filter(Boolean).join('\n\n')} />}
      {artifact.history?.filter(version => version.url).map((version, i) => <a key={i} href={formatAssetUrl(version.url!)} target="_blank" rel="noreferrer" className="block text-xs underline">Image attempt {i + 1}: {version.review.status.replaceAll('_', ' ')}</a>)}
      {artifact.review?.issues.map((issue, i) => <p key={i} className="text-xs text-amber-600">{issue}</p>)}
    </div>}
  </div>
}
export function StudioRunCard({ threadId, runId }: { threadId: string; runId: string }) {
  const dispatch = useAppDispatch()
  const threadRevision = useAppSelector(state => state.chat.activeThread?.updatedAt)
  const notifiedStatus = useRef('')
  const [run, setRun] = useState<StudioRun | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [historyId, setHistoryId] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const next = await api.get<StudioRun>('/api/threads/' + threadId + '/runs/' + runId)
        if (disposed) return
        setRun(next); setError('')
        if (!terminal.includes(next.status)) timer = setTimeout(poll, 2000)
        else if (notifiedStatus.current !== next.status) { notifiedStatus.current = next.status; void dispatch(refreshThreadSilent(threadId)) }
      } catch (e) {
        if (!disposed) { setError(e instanceof Error ? e.message : 'Could not load progress'); timer = setTimeout(poll, 5000) }
      }
    }
    void poll()
    return () => { disposed = true; if (timer) clearTimeout(timer) }
  }, [threadId, runId, refresh, dispatch, threadRevision])
  const revise = async (artifact: StudioArtifact, retry = false) => {
    setBusy(true)
    try {
      await api.post('/api/threads/' + threadId + '/artifacts/' + artifact._id + (retry ? '/retry' : '/revisions'), { clientRequestId: crypto.randomUUID(), content: instruction })
      setEditing(null); setInstruction('')
      await dispatch(selectThread(threadId)).unwrap()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Revision failed') }
    finally { setBusy(false) }
  }
  const cancel = async () => {
    setBusy(true)
    try { await api.post('/api/threads/' + threadId + '/runs/' + runId + '/cancel'); setRefresh(n => n + 1) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not cancel') }
    finally { setBusy(false) }
  }
  if (!run) return <div role="status" className="text-sm text-gray-500">{error || 'Loading episode progress…'}</div>
  const running = !terminal.includes(run.status)
  const currentArtifacts = run.artifacts.filter(a => !a.outdated)
  const packaging = currentArtifacts.find(a => a.kind === 'packaging')
  const images = currentArtifacts.filter(a => ['thumbnail','scene'].includes(a.kind)).sort((a, b) => (a.data.variantIndex ?? 0) - (b.data.variantIndex ?? 0))
  return <div className="space-y-5">
    <div className="flex items-center justify-between gap-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/30 p-3">
      <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm">
        {running && <Loader2 className="h-4 w-4 animate-spin" />}
        {running ? stageLabels[run.stage] || 'Working on your episode' : run.status === 'completed' ? 'Your episode is ready' : run.status === 'completed_with_issues' ? 'Ready with items to review' : run.status.replaceAll('_', ' ')}
      </div>
      {running && <button disabled={busy} onClick={cancel} className="flex items-center gap-1 text-xs"><Square className="h-3 w-3" /> Stop</button>}
    </div>
    {!!run.notes?.length && <div className="space-y-1 text-sm text-gray-600 dark:text-gray-300">{run.notes.map((note, i) => <p key={i}>{note}</p>)}</div>}
    {error && <p role="alert" className="text-sm text-amber-600">{error}</p>}
    {run.error && <p role="alert" className="text-sm text-amber-600">{run.error}</p>}
    {packaging && <div className="space-y-2">
      <p className="text-xs uppercase text-gray-500">Recommended title</p>
      <p className="text-xl font-bold break-words">{packaging.data.title}</p>
      {packaging.data.rationale && <MarkdownRenderer content={packaging.data.rationale} />}
    </div>}
    {(images.length > 0 || packaging?.data.thumbnails?.length) && <div className="grid gap-4 lg:grid-cols-2">
      {(images.length ? images : []).map((artifact, i) => <div key={artifact._id} className="rounded-xl border border-gray-200 dark:border-gray-800 p-3 space-y-3">
        <div className="flex justify-between items-center"><span className="text-sm font-semibold">{artifact.kind === 'scene' ? 'Scene image' : 'Thumbnail ' + ((artifact.data.variantIndex ?? i) + 1)}</span><span className="text-xs text-gray-500">{artifact.outdated ? 'outdated: ' : ''}{artifact.status.replaceAll('_', ' ')}</span></div>
        {artifact.data.url ? <a href={formatAssetUrl(artifact.data.url)} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={formatAssetUrl(artifact.data.url)} alt={artifact.data.concept?.text || 'Generated thumbnail'} className="w-full rounded-lg" />
        </a> : <div className="aspect-video rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-sm text-gray-500">{['pending','running'].includes(artifact.status) ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Generating automatically</> : 'Image unavailable'}</div>}
        <p className="text-sm font-bold whitespace-pre-line">{artifact.data.concept?.text}</p>
        {artifact.error && <p className="text-xs text-amber-600">{artifact.error}</p>}
        {artifact.review?.issues.map((issue, n) => <p key={n} className="text-xs text-amber-600">{issue}</p>)}
        <div className="flex gap-3 flex-wrap text-xs">
          {artifact.data.url && <a href={formatAssetUrl(artifact.data.url)} download className="flex items-center gap-1"><Download className="h-3 w-3" /> Download</a>}
          {!running && <button onClick={() => { setEditing(artifact._id); setInstruction('') }} className="flex items-center gap-1"><Pencil className="h-3 w-3" /> Edit</button>}
          {['failed','unknown','needs_attention'].includes(artifact.status) && <button disabled={busy} onClick={() => revise(artifact, true)} className="flex items-center gap-1"><RefreshCw className="h-3 w-3" /> Retry this image</button>}
          {<button onClick={() => setHistoryId(historyId === artifact._id ? null : artifact._id)} className="flex items-center gap-1"><History className="h-3 w-3" /> Versions</button>}
        </div>
        {historyId === artifact._id && <ArtifactVersions threadId={threadId} artifactId={artifact._id} />}
        {editing === artifact._id && <form onSubmit={e => { e.preventDefault(); void revise(artifact) }} className="space-y-2">
          <label htmlFor={'revision-' + artifact._id} className="text-xs">What should change?</label>
          <textarea id={'revision-' + artifact._id} value={instruction} onChange={e => setInstruction(e.target.value)} className="w-full rounded border bg-transparent p-2 text-sm" required maxLength={50000} />
          <button disabled={busy || !instruction.trim()} className="rounded bg-indigo-600 px-3 py-1.5 text-xs text-white">Create revision</button>
        </form>}
      </div>)}
    </div>}
    {!!run.research?.web?.sources?.length && <SourcesSection sources={run.research.web.sources} />}
    {!!run.research?.facts?.length && <details className="text-sm space-y-2"><summary className="cursor-pointer">Research findings</summary>
      {run.research.facts.map((fact, i) => <div key={i} className="mt-2"><p><span className="text-xs uppercase text-gray-500">{fact.status}</span> {fact.claim}</p>
        {fact.evidence.map((evidence, j) => <a key={j} href={evidence.url} target="_blank" rel="noreferrer" className="mr-3 text-xs underline">Source {j + 1}</a>)}
      </div>)}
    </details>}
    {run.research?.limitations?.map((limitation, i) => <p key={'research-' + i} className="text-xs text-amber-600">{limitation}</p>)}
    {!!run.artifacts.filter(a => a.outdated).length && <details className="text-sm"><summary className="cursor-pointer text-amber-600">Previous or outdated outputs</summary>
      {run.artifacts.filter(a => a.outdated).map(artifact => <div key={artifact._id} className="mt-2"><p className="text-xs">{artifact.kind} version {artifact.version}: superseded or affected by a later change</p><ArtifactVersions threadId={threadId} artifactId={artifact._id} /></div>)}
    </details>}
    {run.research?.web?.limitations?.map((limitation, i) => <p key={i} className="text-xs text-amber-600">{limitation}</p>)}
    {currentArtifacts.filter(a => !['thumbnail','scene'].includes(a.kind)).map(artifact => <div key={artifact._id} className="space-y-2">
      {artifact.kind === 'script' ? <>
        {artifact.data.timing && <p className="text-xs text-gray-500">Estimated {Math.floor(artifact.data.timing.seconds / 60)}:{String(artifact.data.timing.seconds % 60).padStart(2,'0')} · {artifact.data.timing.words} spoken words</p>}
        <ScriptRenderer content={scriptMarkdown(artifact)} threadId={threadId} videoTitle={artifact.data.title} />
      </> : artifact.kind === 'packaging' ? <>
        {artifact.data.description && <MarkdownRenderer content={'## Description\n' + artifact.data.description} />}
        {!!artifact.data.tags?.length && <p className="text-sm break-words">{artifact.data.tags.join(', ')}</p>}
      </> : <MarkdownRenderer content={artifact.data.content || ''} />}
      {artifact.review?.issues.map((issue, i) => <p key={i} className="text-xs text-amber-600">{issue}</p>)}
      <button onClick={() => setHistoryId(historyId === artifact._id ? null : artifact._id)} className="flex items-center gap-1 text-xs"><History className="h-3 w-3" /> Versions</button>
      {historyId === artifact._id && <ArtifactVersions threadId={threadId} artifactId={artifact._id} />}
      {!running && <div className="space-y-2">
        <button onClick={() => { setEditing(editing === artifact._id ? null : artifact._id); setInstruction('') }} className="text-xs text-indigo-600">Revise {artifact.kind}</button>
        {editing === artifact._id && <form onSubmit={e => { e.preventDefault(); void revise(artifact) }} className="space-y-2">
          <textarea aria-label={'Revision instructions for ' + artifact.kind} value={instruction} onChange={e => setInstruction(e.target.value)} required maxLength={50000} className="w-full rounded border bg-transparent p-2 text-sm" />
          <button disabled={busy || !instruction.trim()} className="rounded bg-indigo-600 px-3 py-1.5 text-xs text-white">Create revision</button>
        </form>}
      </div>}
    </div>)}
  </div>
}
