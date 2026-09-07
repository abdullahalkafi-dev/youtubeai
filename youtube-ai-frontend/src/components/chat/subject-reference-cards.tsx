'use client'

import { useState, useEffect, useRef } from 'react'
import {
  Sparkles,
  Search,
  Upload,
  X,
  Plus,
  Loader2,
  User,
  Check,
  RefreshCw,
  ExternalLink,
  Camera,
} from 'lucide-react'
import type { StorySubject } from '@/types/chat'
import api, { formatAssetUrl } from '@/lib/api'
import { toast } from 'sonner'

interface SubjectReferenceCardsProps {
  threadId: string
  videoTitle?: string
  visualConcept?: string
  subjects: StorySubject[]
  onChangeSubjects: (subjects: StorySubject[]) => void
}

export function SubjectReferenceCards({
  threadId,
  videoTitle,
  visualConcept,
  subjects,
  onChangeSubjects,
}: SubjectReferenceCardsProps) {
  const [isDetecting, setIsDetecting] = useState(false)
  const [hasAutoDetected, setHasAutoDetected] = useState(false)
  const [searchPopoverSubjectId, setSearchPopoverSubjectId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [uploadingSubjectId, setUploadingSubjectId] = useState<string | null>(null)
  const [showAddSubject, setShowAddSubject] = useState(false)
  const [newSubjectName, setNewSubjectName] = useState('')
  const [newSubjectRole, setNewSubjectRole] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const activeUploadSubjId = useRef<string | null>(null)

  // Auto-detect on mount if no subjects exist yet
  useEffect(() => {
    if (!hasAutoDetected && subjects.length === 0 && (videoTitle || visualConcept) && threadId) {
      setHasAutoDetected(true)
      handleDetectSubjects()
    }
  }, [hasAutoDetected, subjects.length, videoTitle, visualConcept, threadId])

  const handleDetectSubjects = async () => {
    if (!threadId) return
    setIsDetecting(true)
    try {
      const detected = await api.suggestSubjects(threadId, {
        videoTitle,
        visualConcept,
      })

      if (detected && detected.length > 0) {
        const formatted: StorySubject[] = detected.map((s, idx) => ({
          id: s.id || `subj_${Date.now()}_${idx + 1}`,
          name: s.name,
          role: s.role || 'Key Subject',
          searchQuery: s.searchQuery || s.name,
          imageUrl: s.imageUrl,
          source: (s.source?.toLowerCase().includes('wikipedia')
            ? 'wikipedia'
            : s.imageUrl
            ? 'web'
            : undefined) as any,
          selected: true,
        }))
        onChangeSubjects(formatted)
        toast.success(`Identified ${formatted.length} real subject(s) with reference photos!`)
      } else {
        toast.info('No specific real individuals detected in this concept.')
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to detect subjects')
    } finally {
      setIsDetecting(false)
    }
  }

  const handleToggleSelect = (id: string) => {
    const updated = subjects.map((s) => (s.id === id ? { ...s, selected: !s.selected } : s))
    onChangeSubjects(updated)
  }

  const handleRemoveSubject = (id: string) => {
    const updated = subjects.filter((s) => s.id !== id)
    onChangeSubjects(updated)
  }

  const handleOpenSearch = (subject: StorySubject) => {
    setSearchPopoverSubjectId(subject.id)
    setSearchQuery(subject.searchQuery || subject.name)
  }

  const handleExecuteSearch = async (subjectId: string) => {
    if (!searchQuery.trim() || !threadId) return
    setIsSearching(true)
    try {
      const res = await api.searchSubjectImage(threadId, searchQuery.trim())
      if (res?.imageUrl) {
        const updated = subjects.map((s) =>
          s.id === subjectId
            ? {
                ...s,
                imageUrl: res.imageUrl,
                searchQuery: searchQuery.trim(),
                source: 'web' as const,
                selected: true,
              }
            : s,
        )
        onChangeSubjects(updated)
        toast.success('Updated subject photo from web search!')
        setSearchPopoverSubjectId(null)
      } else {
        toast.warning('No clear portrait photo found for this search query.')
      }
    } catch (err: any) {
      toast.error(err.message || 'Search failed')
    } finally {
      setIsSearching(false)
    }
  }

  const handleTriggerUpload = (subjectId: string) => {
    activeUploadSubjId.current = subjectId
    fileInputRef.current?.click()
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const subjId = activeUploadSubjId.current
    if (!file || !subjId || !threadId) return

    setUploadingSubjectId(subjId)
    try {
      const res = await api.uploadReferenceAsset(threadId, file)
      if (res?.url) {
        const updated = subjects.map((s) =>
          s.id === subjId
            ? {
                ...s,
                imageUrl: res.url,
                source: 'upload' as const,
                selected: true,
              }
            : s,
        )
        onChangeSubjects(updated)
        toast.success('Uploaded custom photo for subject!')
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to upload photo')
    } finally {
      setUploadingSubjectId(null)
      activeUploadSubjId.current = null
      if (e.target) e.target.value = ''
    }
  }

  const handleAddManualSubject = async () => {
    if (!newSubjectName.trim()) return
    const newId = `subj_${Date.now()}`
    const name = newSubjectName.trim()
    const role = newSubjectRole.trim() || 'Key Subject'

    const newSubj: StorySubject = {
      id: newId,
      name,
      role,
      searchQuery: name,
      selected: true,
    }

    const updated = [...subjects, newSubj]
    onChangeSubjects(updated)
    setNewSubjectName('')
    setNewSubjectRole('')
    setShowAddSubject(false)

    // Automatically search a photo for this newly added person
    try {
      const res = await api.searchSubjectImage(threadId, name)
      if (res?.imageUrl) {
        onChangeSubjects(
          updated.map((s) =>
            s.id === newId ? { ...s, imageUrl: res.imageUrl, source: 'web' as const } : s,
          ),
        )
      }
    } catch {
      // Ignore background search fail
    }
  }

  return (
    <div className="space-y-3">
      {/* Hidden file input for custom subject photo uploads */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-violet-500" />
          <label className="text-xs font-semibold text-gray-800 dark:text-gray-200">
            Real Story Subjects (Reference Photos)
          </label>
          <span className="text-[10px] text-gray-400">
            ({subjects.filter((s) => s.selected !== false && s.imageUrl).length} active)
          </span>
        </div>

        <div className="flex items-center gap-2">
          {subjects.length < 3 && (
            <button
              type="button"
              onClick={() => setShowAddSubject(true)}
              className="flex items-center gap-1 text-[11px] text-violet-600 dark:text-violet-400 hover:text-violet-700 font-medium transition"
            >
              <Plus className="w-3 h-3" />
              Add Subject
            </button>
          )}

          <button
            type="button"
            onClick={handleDetectSubjects}
            disabled={isDetecting}
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800/60 text-violet-700 dark:text-violet-300 hover:bg-violet-100 text-[11px] font-medium transition disabled:opacity-50"
            title="Re-scan title & visual concept for real individuals"
          >
            {isDetecting ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Scanning...</span>
              </>
            ) : (
              <>
                <RefreshCw className="w-3 h-3" />
                <span>Auto-Detect</span>
              </>
            )}
          </button>
        </div>
      </div>

      <p className="text-[11px] text-gray-500 dark:text-gray-400">
        Authentic public portraits injected into AI image generation so real defendants, judges, or victims are depicted accurately.
      </p>

      {/* Subject Cards Grid */}
      {subjects.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
          {subjects.map((subject) => {
            const isSelected = subject.selected !== false
            const isSearchingThis = searchPopoverSubjectId === subject.id
            const isUploadingThis = uploadingSubjectId === subject.id

            return (
              <div
                key={subject.id}
                className={`relative flex flex-col justify-between p-2.5 rounded-xl border transition-all ${
                  isSelected
                    ? 'bg-white dark:bg-gray-800/90 border-violet-300 dark:border-violet-500/50 shadow-sm'
                    : 'bg-gray-50/70 dark:bg-gray-900/50 border-gray-200 dark:border-gray-800 opacity-60'
                }`}
              >
                {/* Top Row: Photo + Name/Role + Remove */}
                <div className="flex items-start gap-2.5">
                  {/* Photo Preview */}
                  <div className="relative w-14 h-16 rounded-xl bg-gray-100 dark:bg-gray-900 border border-violet-200/50 dark:border-gray-700/80 overflow-hidden shrink-0 flex items-center justify-center shadow-xs">
                    {subject.imageUrl ? (
                      <img
                        src={formatAssetUrl(subject.imageUrl)}
                        alt={subject.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User className="w-6 h-6 text-gray-400" />
                    )}

                    {isUploadingThis && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                        <Loader2 className="w-4 h-4 text-white animate-spin" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0 pr-4 space-y-1">
                    <p className="text-xs font-bold text-gray-900 dark:text-white line-clamp-2 leading-tight" title={subject.name}>
                      {subject.name}
                    </p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/30 line-clamp-1">
                        {subject.role || 'Key Subject'}
                      </span>

                      {/* Source tag */}
                      {subject.source === 'wikipedia' ? (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                          Wikipedia
                        </span>
                      ) : subject.source === 'upload' ? (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                          Custom Upload
                        </span>
                      ) : subject.imageUrl ? (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          Web Search
                        </span>
                      ) : (
                        <span className="text-[9px] text-amber-400 italic">No photo found</span>
                      )}
                    </div>
                  </div>

                  {/* Remove Button */}
                  <button
                    type="button"
                    onClick={() => handleRemoveSubject(subject.id)}
                    className="absolute top-2 right-2 text-gray-400 hover:text-red-400 p-0.5 rounded transition"
                    title="Remove subject"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Search Alternative Dropdown / Input */}
                {isSearchingThis && (
                  <div className="mt-2.5 p-2 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 space-y-1.5 animate-in fade-in zoom-in-95 duration-150">
                    <label className="text-[10px] font-medium text-gray-600 dark:text-gray-300">
                      Search Photo for &ldquo;{subject.name}&rdquo;
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="e.g. Duane Keefe D Davis courtroom"
                        className="flex-1 px-2 py-1 text-[11px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-gray-800 dark:text-gray-200"
                        onKeyDown={(e) => e.key === 'Enter' && handleExecuteSearch(subject.id)}
                      />
                      <button
                        type="button"
                        onClick={() => handleExecuteSearch(subject.id)}
                        disabled={isSearching}
                        className="px-2 py-1 bg-violet-600 hover:bg-violet-700 text-white rounded-md text-[11px] font-medium transition disabled:opacity-50 flex items-center justify-center shrink-0"
                      >
                        {isSearching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>
                )}

                {/* Bottom Action Row */}
                <div className="mt-3 pt-2 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between text-[10px]">
                  {/* Toggle Include */}
                  <button
                    type="button"
                    onClick={() => handleToggleSelect(subject.id)}
                    className={`flex items-center gap-1.5 font-medium transition ${
                      isSelected
                        ? 'text-violet-600 dark:text-violet-400 font-semibold'
                        : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-md flex items-center justify-center border transition ${
                        isSelected
                          ? 'bg-violet-600 border-violet-600 text-white shadow-xs'
                          : 'border-gray-300 dark:border-gray-600'
                      }`}
                    >
                      {isSelected && <Check className="w-3 h-3 stroke-[2.5]" />}
                    </div>
                    <span>{isSelected ? 'Included' : 'Excluded'}</span>
                  </button>

                  {/* Photo Actions: Search Alternative / Upload */}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        isSearchingThis
                          ? setSearchPopoverSubjectId(null)
                          : handleOpenSearch(subject)
                      }
                      className="px-2 py-1 text-gray-400 hover:text-violet-300 rounded-md bg-gray-800/40 hover:bg-violet-500/20 border border-gray-700/60 hover:border-violet-500/40 transition flex items-center gap-1"
                      title="Search web for another photo"
                    >
                      <Search className="w-3 h-3" />
                      <span>Search</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleTriggerUpload(subject.id)}
                      className="px-2 py-1 text-gray-400 hover:text-purple-300 rounded-md bg-gray-800/40 hover:bg-purple-500/20 border border-gray-700/60 hover:border-purple-500/40 transition flex items-center gap-1"
                      title="Upload custom portrait photo"
                    >
                      <Upload className="w-3 h-3" />
                      <span>Upload</span>
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-dashed border-gray-200 dark:border-gray-700 text-center space-y-1.5">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            No story subjects detected yet. Click &ldquo;Auto-Detect&rdquo; or add one manually.
          </p>
        </div>
      )}

      {/* Add Custom Subject Form */}
      {showAddSubject && (
        <div className="p-3 bg-violet-50/50 dark:bg-violet-950/20 rounded-xl border border-violet-200 dark:border-violet-800/60 space-y-2 animate-in fade-in duration-150">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-violet-900 dark:text-violet-200">
              Add Real Story Subject (Max 3)
            </span>
            <button
              type="button"
              onClick={() => setShowAddSubject(false)}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-gray-500">Person Full Name</label>
              <input
                type="text"
                value={newSubjectName}
                onChange={(e) => setNewSubjectName(e.target.value)}
                placeholder="e.g. Judge Carli Kierny"
                className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-800 dark:text-gray-200 mt-0.5"
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-500">Story / Trial Role</label>
              <input
                type="text"
                value={newSubjectRole}
                onChange={(e) => setNewSubjectRole(e.target.value)}
                placeholder="e.g. Presiding Judge, Defendant"
                className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-800 dark:text-gray-200 mt-0.5"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowAddSubject(false)}
              className="px-2.5 py-1 text-xs text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAddManualSubject}
              disabled={!newSubjectName.trim()}
              className="px-3 py-1 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-medium transition disabled:opacity-50"
            >
              Add & Find Photo
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
