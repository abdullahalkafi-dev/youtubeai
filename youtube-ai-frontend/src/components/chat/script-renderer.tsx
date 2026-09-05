'use client'

import { useState, useEffect } from 'react'
import {
  Copy,
  Check,
  FileText,
  Diamond,
  Play,
  Edit3,
  Download,
  Bookmark,
  BookmarkCheck,
  History,
  FileDown,
  MoreHorizontal,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { updateMessageScriptId } from '@/store/slices/chat-slice'
import api from '@/lib/api'
import {
  calculateTeleprompterStats,
  parseScriptSections,
  extractCleanTeleprompterText,
  extractScriptTitle,
} from '@/lib/teleprompter-parser'
import { downloadTeleprompterPdf } from '@/components/scripts/export/teleprompter-pdf'
import { FullscreenTeleprompter } from '@/components/scripts/teleprompter/fullscreen-teleprompter'
import { TeleprompterEditorModal } from '@/components/scripts/editor/teleprompter-editor-modal'
import { VersionHistoryModal } from '@/components/scripts/version-history-modal'
import type { ScriptItem } from '@/types/script'

interface ScriptRendererProps {
  content: string
  threadId?: string
  messageId?: string
  initialScriptId?: string
  threadTitle?: string
  videoTitle?: string
}

export function ScriptRenderer({
  content,
  threadId,
  messageId,
  initialScriptId,
  threadTitle,
  videoTitle,
}: ScriptRendererProps) {
  const dispatch = useAppDispatch()
  const channelId = useAppSelector((state) => state.auth.activeChannelId) || ''

  const [copied, setCopied] = useState(false)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [showDownloadMenu, setShowDownloadMenu] = useState(false)
  const [savedScript, setSavedScript] = useState<ScriptItem | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // Modals state
  const [showTeleprompter, setShowTeleprompter] = useState(false)
  const [showEditor, setShowEditor] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [scriptNotFound, setScriptNotFound] = useState(false)

  // If this message already has an associated script in the Library, hydrate the latest version on mount
  useEffect(() => {
    if (initialScriptId && channelId && !savedScript && !scriptNotFound) {
      api
        .getScript(channelId, initialScriptId)
        .then((script) => {
          if (script) setSavedScript(script)
          else setScriptNotFound(true)
        })
        .catch(() => {
          setScriptNotFound(true)
        })
    }
  }, [initialScriptId, channelId, savedScript, scriptNotFound])

  const effectiveContent = savedScript?.content || content
  const stats = calculateTeleprompterStats(effectiveContent)
  const sections = parseScriptSections(effectiveContent)

  // Extract a clean topic title from the content, explicit AI contract line, or video/thread title
  const baseTitle = videoTitle || threadTitle?.replace(/^Script:\s*/i, '') || ''
  const derivedTitle = extractScriptTitle(effectiveContent, baseTitle, videoTitle)
  const scriptTitle = savedScript?.title || derivedTitle
  const isAlreadySaved = Boolean(savedScript || (initialScriptId && !scriptNotFound))
  const currentSavedVersion = savedScript?.currentVersion || 1

  const handleSaveToLibrary = async () => {
    if (!channelId) {
      toast.error('Channel context not found')
      return
    }

    if (isAlreadySaved) {
      toast.info('This script is already saved in your Library.')
      return
    }

    setIsSaving(true)
    try {
      const script = await api.createScript(channelId, {
        title: scriptTitle,
        content: effectiveContent,
        threadId,
        messageId,
        wordCount: stats.wordCount,
        estimatedDurationMinutes: stats.estimatedDurationMinutes,
        source: 'ai_chat',
        formatType: 'teleprompter_beat',
      })
      setSavedScript(script)
      if (messageId) {
        dispatch(updateMessageScriptId({ messageId, scriptId: script.id || (script as any)._id }))
      }
      toast.success('Script saved to your Library!')
    } catch (err: any) {
      toast.error(`Failed to save script: ${err.message}`)
    } finally {
      setIsSaving(false)
    }
  }

  const handleCopyScript = async () => {
    try {
      const text = extractCleanTeleprompterText(effectiveContent) || effectiveContent
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success('Teleprompter script copied!')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Failed to copy')
    }
  }

  const handleDownloadMd = () => {
    const blob = new Blob([effectiveContent], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${scriptTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleDownloadTxt = () => {
    const text = extractCleanTeleprompterText(effectiveContent) || effectiveContent
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${scriptTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true)
    try {
      await downloadTeleprompterPdf(
        scriptTitle,
        effectiveContent,
        stats.wordCount,
        stats.estimatedDurationMinutes,
      )
    } catch (err: any) {
      toast.error(`PDF generation failed: ${err.message}`)
    } finally {
      setDownloadingPdf(false)
    }
  }

  const activeScript: ScriptItem = savedScript || {
    id: initialScriptId,
    _id: initialScriptId,
    channelId,
    title: scriptTitle,
    content: effectiveContent,
    wordCount: stats.wordCount,
    estimatedDurationMinutes: stats.estimatedDurationMinutes,
    source: 'ai_chat',
    formatType: 'teleprompter_beat',
    isFavorite: false,
    vectorSyncStatus: 'synced',
    currentVersion: currentSavedVersion,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm overflow-hidden my-3">
      {/* Top Action Toolbar */}
      <div className="px-4 py-3 bg-zinc-50/80 dark:bg-zinc-800/60 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500">
            <FileText className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate max-w-xs sm:max-w-md">
              {scriptTitle}
            </h4>
            <p className="text-[10px] text-zinc-500">
              {stats.estimatedDurationMinutes} min read · {stats.wordCount} words
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-1.5 flex-wrap">
          {/* Save to Library / Saved Button */}
          {isAlreadySaved ? (
            <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold text-xs flex items-center space-x-1">
              <BookmarkCheck className="w-3.5 h-3.5" />
              <span>In Library (v{currentSavedVersion})</span>
            </span>
          ) : (
            <button
              onClick={handleSaveToLibrary}
              disabled={isSaving}
              className="px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold text-xs flex items-center space-x-1 transition active:scale-95 disabled:opacity-50"
            >
              {isSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Bookmark className="w-3.5 h-3.5" />
              )}
              <span>Save to Library</span>
            </button>
          )}

          {/* Fullscreen Teleprompter */}
          <button
            onClick={() => setShowTeleprompter(true)}
            className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs flex items-center space-x-1 transition active:scale-95 shadow-sm"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Studio</span>
          </button>

          {/* Edit Button */}
          <button
            onClick={() => setShowEditor(true)}
            className="px-2.5 py-1 rounded-lg bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-800 dark:text-zinc-200 font-semibold text-xs flex items-center space-x-1 transition"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>Edit</span>
          </button>

          {/* Version History (if saved) */}
          {isAlreadySaved && (
            <button
              onClick={() => setShowHistory(true)}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition"
              title="Version History"
            >
              <History className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Copy Clean Spoken Script */}
          <button
            onClick={handleCopyScript}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition"
            title="Copy Clean Spoken Text"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          {/* Download Menu */}
          <div className="relative">
            <button
              onClick={() => setShowDownloadMenu((prev) => !prev)}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition"
              title="Download Options"
            >
              <Download className="w-3.5 h-3.5" />
            </button>

            {showDownloadMenu && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setShowDownloadMenu(false)}
                />
                <div className="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl z-40 p-1 space-y-1 text-xs">
                  <button
                    onClick={() => {
                      setShowDownloadMenu(false)
                      handleDownloadPdf()
                    }}
                    disabled={downloadingPdf}
                    className="w-full px-2.5 py-1.5 rounded-lg flex items-center space-x-2 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition text-left"
                  >
                    <FileDown className="w-3.5 h-3.5 text-red-500" />
                    <span>Download PDF (.pdf)</span>
                  </button>
                  <button
                    onClick={() => {
                      setShowDownloadMenu(false)
                      handleDownloadMd()
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg flex items-center space-x-2 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition text-left"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Download Markdown (.md)</span>
                  </button>
                  <button
                    onClick={() => {
                      setShowDownloadMenu(false)
                      handleDownloadTxt()
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg flex items-center space-x-2 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition text-left"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Download Plain (.txt)</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Script Sections Card Body */}
      <div className="p-5 space-y-5 max-h-[600px] overflow-y-auto">
        {sections.map((section, idx) => (
          <div key={idx} className="space-y-3">
            {section.header && (
              <h4 className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider pb-1 border-b border-zinc-100 dark:border-zinc-800">
                {section.header}
              </h4>
            )}

            {section.isJewel ? (
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-700 dark:text-amber-300 font-medium space-y-1">
                <div className="flex items-center space-x-1.5 text-amber-500 font-bold uppercase text-[10px]">
                  <Diamond className="w-3.5 h-3.5" />
                  <span>💎 JEWEL LESSON</span>
                </div>
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
                        className="inline-block my-0.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-zinc-100 dark:bg-zinc-800 text-amber-500"
                      >
                        {trimmed}
                      </span>
                    )
                  }

                  if (trimmed.startsWith('•') || trimmed.startsWith('**•') || trimmed.startsWith('**➤')) {
                    return (
                      <div key={lIdx} className="font-bold text-zinc-900 dark:text-zinc-100 pt-1">
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

      {/* Fullscreen Teleprompter Overlay */}
      {showTeleprompter && (
        <FullscreenTeleprompter
          isOpen={showTeleprompter}
          onClose={() => setShowTeleprompter(false)}
          title={scriptTitle}
          content={effectiveContent}
          wordCount={stats.wordCount}
          estimatedDurationMinutes={stats.estimatedDurationMinutes}
        />
      )}

      {/* Visual Editor Modal */}
      {showEditor && (
        <TeleprompterEditorModal
          isOpen={showEditor}
          onClose={() => setShowEditor(false)}
          channelId={channelId}
          script={activeScript}
          onSaved={(updated) => {
            setSavedScript(updated)
            setShowEditor(false)
          }}
        />
      )}

      {/* Version History Modal */}
      {showHistory && isAlreadySaved && (
        <VersionHistoryModal
          isOpen={showHistory}
          onClose={() => setShowHistory(false)}
          channelId={channelId}
          scriptId={savedScript?.id || savedScript?._id || initialScriptId || ''}
          currentVersion={currentSavedVersion}
          onRestored={(restored) => {
            if (restored) {
              setSavedScript(restored)
            }
            setShowHistory(false)
          }}
        />
      )}
    </div>
  )
}
