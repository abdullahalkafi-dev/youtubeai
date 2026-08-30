'use client'

import React, { useState, useEffect } from 'react'
import {
  X,
  Check,
  Save,
  Loader2,
  Sparkles,
  Plus,
  Trash2,
  AlertTriangle,
  RotateCcw,
  Clock,
  Eye,
  Edit2,
} from 'lucide-react'
import { toast } from 'sonner'
import api from '@/lib/api'
import { calculateTeleprompterStats, parseScriptSections } from '@/lib/teleprompter-parser'
import type { ScriptItem } from '@/types/script'

interface TeleprompterEditorModalProps {
  isOpen: boolean
  onClose: () => void
  channelId: string
  script: ScriptItem
  onSaved: (updated: ScriptItem) => void
}

export function TeleprompterEditorModal({
  isOpen,
  onClose,
  channelId,
  script,
  onSaved,
}: TeleprompterEditorModalProps) {
  const scriptId = script.id || script._id || ''
  const [title, setTitle] = useState(script.title)
  const [content, setContent] = useState(script.content)
  const [changeDescription, setChangeDescription] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [draftAlert, setDraftAlert] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'editor' | 'preview'>('editor')

  // Check localStorage draft on load
  useEffect(() => {
    if (!isOpen || !scriptId) return

    setTitle(script.title)
    setContent(script.content)
    setHasUnsavedChanges(false)
    setDraftAlert(null)

    const draftKey = `script_draft_${scriptId}`
    const savedDraftStr = localStorage.getItem(draftKey)
    if (savedDraftStr) {
      try {
        const draft = JSON.parse(savedDraftStr)
        const isFresh = Date.now() - draft.updatedAt < 24 * 60 * 60 * 1000 // 24h TTL
        if (isFresh && draft.content && draft.content !== script.content) {
          if (draft.baseVersion === script.currentVersion) {
            setDraftAlert('Found unsaved local draft from earlier. Click Restore Draft to use it.')
          } else {
            setDraftAlert(
              `The server version has changed (v${script.currentVersion}) since your local draft (v${draft.baseVersion}).`
            )
          }
        }
      } catch { /* ignore */ }
    }
  }, [isOpen, scriptId, script.currentVersion, script.title, script.content])

  // Save to localStorage on change
  const handleContentChange = (val: string) => {
    setContent(val)
    setHasUnsavedChanges(true)

    const draftKey = `script_draft_${scriptId}`
    localStorage.setItem(
      draftKey,
      JSON.stringify({
        title,
        content: val,
        baseVersion: script.currentVersion,
        updatedAt: Date.now(),
      })
    )
  }

  const handleRestoreDraft = () => {
    const draftKey = `script_draft_${scriptId}`
    const savedDraftStr = localStorage.getItem(draftKey)
    if (savedDraftStr) {
      try {
        const draft = JSON.parse(savedDraftStr)
        if (draft.content) setContent(draft.content)
        if (draft.title) setTitle(draft.title)
        setHasUnsavedChanges(true)
        setDraftAlert(null)
      } catch { /* ignore */ }
    }
  }

  const handleDiscardDraft = () => {
    const draftKey = `script_draft_${scriptId}`
    localStorage.removeItem(draftKey)
    setContent(script.content)
    setTitle(script.title)
    setHasUnsavedChanges(false)
    setDraftAlert(null)
  }

  // Quick insertion helpers
  const insertText = (template: string) => {
    setContent((prev) => `${prev}\n\n${template}`)
    setHasUnsavedChanges(true)
  }

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) return

    setIsSaving(true)
    const stats = calculateTeleprompterStats(content)

    try {
      let updated: ScriptItem
      if (scriptId) {
        updated = await api.saveScript(channelId, scriptId, {
          expectedVersion: script.currentVersion || 1,
          title: title.trim(),
          content: content.trim(),
          changeDescription: changeDescription.trim() || `Edited in Visual Studio`,
        })
      } else {
        updated = await api.createScript(channelId, {
          title: title.trim(),
          content: content.trim(),
          wordCount: stats.wordCount,
          estimatedDurationMinutes: stats.estimatedDurationMinutes,
          source: 'ai_chat',
          formatType: 'teleprompter_beat',
        })
      }

      // Clean draft
      if (scriptId) {
        localStorage.removeItem(`script_draft_${scriptId}`)
      }
      setHasUnsavedChanges(false)
      toast.success('Script saved successfully!')
      onSaved(updated)
      onClose()
    } catch (err: any) {
      if (err.message?.includes('modified by another session') || err.status === 409) {
        toast.error(
          'Conflict detected: The script was updated in another window. Please close and reload the latest version to prevent overwriting.'
        )
      } else {
        toast.error(`Save failed: ${err.message}`)
      }
    } finally {
      setIsSaving(false)
    }
  }

  if (!isOpen) return null

  const stats = calculateTeleprompterStats(content)
  const sections = parseScriptSections(content)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Top Header */}
        <div className="px-6 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/80 dark:bg-zinc-900/80">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-500">
              <Edit2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  Script Studio Editor
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold">
                  v{script.currentVersion}
                </span>
                {hasUnsavedChanges && (
                  <span className="text-[11px] text-amber-500 font-medium flex items-center space-x-1">
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                    <span>Unsaved Changes</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-500">
                {stats.estimatedDurationMinutes} min read · {stats.wordCount} words
              </p>
            </div>
          </div>

          {/* Mode Switch & Close */}
          <div className="flex items-center space-x-3">
            <div className="flex items-center bg-zinc-200 dark:bg-zinc-800 p-1 rounded-xl text-xs font-semibold">
              <button
                onClick={() => setActiveTab('editor')}
                className={`px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition ${
                  activeTab === 'editor'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <Edit2 className="w-3.5 h-3.5" />
                <span>Editor</span>
              </button>
              <button
                onClick={() => setActiveTab('preview')}
                className={`px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition ${
                  activeTab === 'preview'
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-600 dark:text-zinc-400'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Rhythm Preview</span>
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Draft Alert Banner */}
        {draftAlert && (
          <div className="bg-amber-500/10 border-b border-amber-500/20 px-6 py-2.5 flex items-center justify-between text-xs text-amber-600 dark:text-amber-400">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span>{draftAlert}</span>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={handleRestoreDraft}
                className="px-2.5 py-1 rounded-lg bg-amber-500 text-black font-bold hover:bg-amber-400 transition text-[11px]"
              >
                Restore Draft
              </button>
              <button
                onClick={handleDiscardDraft}
                className="px-2.5 py-1 rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition text-[11px]"
              >
                Discard
              </button>
            </div>
          </div>
        )}

        {/* Quick Insert Blocks Toolbar (in Editor Mode) */}
        {activeTab === 'editor' && (
          <div className="px-6 py-2 border-b border-zinc-100 dark:border-zinc-800 flex items-center space-x-2 overflow-x-auto bg-zinc-50/50 dark:bg-zinc-950/40 text-xs">
            <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider mr-1">
              Insert:
            </span>
            <button
              type="button"
              onClick={() => insertText('## SECTION TITLE')}
              className="px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-semibold flex items-center space-x-1"
            >
              <Plus className="w-3 h-3" />
              <span>Section Heading</span>
            </button>
            <button
              type="button"
              onClick={() => insertText('**• Lead thought sentence here.**')}
              className="px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-semibold flex items-center space-x-1"
            >
              <Plus className="w-3 h-3" />
              <span>• Lead Thought</span>
            </button>
            <button
              type="button"
              onClick={() => insertText('> Single-breath phrase.\n>\n> Next punchy breath.')}
              className="px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-semibold flex items-center space-x-1"
            >
              <Plus className="w-3 h-3" />
              <span>Spoken Breath Lines</span>
            </button>
            <button
              type="button"
              onClick={() => insertText('[BEAT]')}
              className="px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 font-mono font-bold flex items-center space-x-1"
            >
              <Plus className="w-3 h-3" />
              <span>[BEAT]</span>
            </button>
            <button
              type="button"
              onClick={() => insertText('[PAUSE]')}
              className="px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 font-mono font-bold flex items-center space-x-1"
            >
              <Plus className="w-3 h-3" />
              <span>[PAUSE]</span>
            </button>
            <button
              type="button"
              onClick={() => insertText('### 💎 JEWEL\n**Moral lesson sentence.**\n>\n> Spoken takeaway.')}
              className="px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 font-bold flex items-center space-x-1"
            >
              <span>💎 Jewel Card</span>
            </button>
          </div>
        )}

        {/* Main Work Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Title Input */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1">
              Episode Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                setHasUnsavedChanges(true)
              }}
              className="w-full px-4 py-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-sm font-bold focus:outline-none focus:border-amber-500 dark:text-zinc-100"
            />
          </div>

          {activeTab === 'editor' ? (
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1">
                Teleprompter Markdown Content
              </label>
              <textarea
                value={content}
                onChange={(e) => handleContentChange(e.target.value)}
                rows={16}
                className="w-full p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-xs font-mono focus:outline-none focus:border-amber-500 leading-relaxed text-zinc-800 dark:text-zinc-200 resize-y"
              />
            </div>
          ) : (
            <div className="space-y-6 max-w-3xl mx-auto p-6 bg-zinc-50 dark:bg-zinc-950 rounded-2xl border border-zinc-200 dark:border-zinc-800">
              {sections.map((section, idx) => (
                <div key={idx} className="space-y-4">
                  {section.header && (
                    <h3 className="text-sm font-black text-amber-500 uppercase tracking-wider pb-1 border-b border-zinc-200 dark:border-zinc-800">
                      {section.header}
                    </h3>
                  )}

                  {section.isJewel ? (
                    <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-600 dark:text-amber-300 font-medium text-xs space-y-2">
                      <span className="font-bold text-amber-500 uppercase">💎 JEWEL LESSON</span>
                      <p>{section.body.replace(/^>\s*/gm, '').replace(/\*\*/g, '')}</p>
                    </div>
                  ) : (
                    <div className="space-y-2 text-xs leading-relaxed">
                      {section.body.split('\n').map((line, lIdx) => {
                        const trimmed = line.trim()
                        if (!trimmed) return null

                        if (trimmed.startsWith('[BEAT]') || trimmed.startsWith('[PAUSE]')) {
                          return (
                            <span
                              key={lIdx}
                              className="inline-block my-1 px-3 py-1 rounded-full text-[10px] font-mono font-bold bg-zinc-200 dark:bg-zinc-800 text-amber-500"
                            >
                              {trimmed}
                            </span>
                          )
                        }

                        if (trimmed.startsWith('•') || trimmed.startsWith('**•') || trimmed.startsWith('**➤')) {
                          return (
                            <div key={lIdx} className="font-bold text-zinc-900 dark:text-zinc-100 pt-2">
                              {trimmed.replace(/\*\*/g, '')}
                            </div>
                          )
                        }

                        return (
                          <div key={lIdx} className="pl-3 border-l-2 border-amber-500/40 text-zinc-700 dark:text-zinc-300">
                            {trimmed.replace(/^>\s*/, '').replace(/\*\*/g, '')}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Change description note for version audit */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1">
              Version Change Note (Optional)
            </label>
            <input
              type="text"
              value={changeDescription}
              onChange={(e) => setChangeDescription(e.target.value)}
              placeholder="e.g. Polished Cold Open hook & added 2 Beats"
              className="w-full px-4 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-xs focus:outline-none focus:border-amber-500 dark:text-zinc-100"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3.5 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50 dark:bg-zinc-900/80">
          <div className="text-xs text-zinc-400">
            Will increment to <span className="font-bold text-amber-500">v{script.currentVersion + 1}</span> upon saving.
          </div>

          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || !title.trim() || !content.trim()}
              className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm flex items-center space-x-2 transition active:scale-95 disabled:opacity-50 shadow-md"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              <span>Save Changes (v{script.currentVersion + 1})</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
