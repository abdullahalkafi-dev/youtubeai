'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  FileText,
  Clock,
  Star,
  Play,
  Edit3,
  MessageSquare,
  Sparkles,
  Download,
  Copy,
  Trash2,
  History,
  MoreVertical,
  RotateCcw,
  Check,
  AlertCircle,
  FileDown,
} from 'lucide-react'
import { toast } from 'sonner'
import api from '@/lib/api'
import { extractCleanTeleprompterText } from '@/lib/teleprompter-parser'
import { downloadTeleprompterPdf } from './export/teleprompter-pdf'
import type { ScriptItem } from '@/types/script'

interface ScriptCardProps {
  script: ScriptItem
  channelId: string
  onDelete: (id: string) => void
  onToggleFavorite: (id: string) => void
  onOpenTeleprompter: (script: ScriptItem) => void
  onOpenEditor: (script: ScriptItem) => void
  onOpenHistory: (script: ScriptItem) => void
}

export function ScriptCard({
  script,
  channelId,
  onDelete,
  onToggleFavorite,
  onOpenTeleprompter,
  onOpenEditor,
  onOpenHistory,
}: ScriptCardProps) {
  const router = useRouter()
  const [copied, setCopied] = useState(false)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [showMenu, setShowMenu] = useState(false)

  const scriptId = script.id || script._id || ''

  const handleCopy = () => {
    const text = extractCleanTeleprompterText(script.content) || script.content
    navigator.clipboard.writeText(text)
    setCopied(true)
    toast.success('Clean teleprompter script copied!')
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownloadMd = () => {
    const blob = new Blob([script.content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${script.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleDownloadTxt = () => {
    const text = extractCleanTeleprompterText(script.content) || script.content
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${script.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true)
    try {
      await downloadTeleprompterPdf(
        script.title,
        script.content,
        script.wordCount,
        script.estimatedDurationMinutes,
      )
    } catch (err: any) {
      toast.error(`PDF download failed: ${err.message}`)
    } finally {
      setDownloadingPdf(false)
    }
  }

  const handleOpenOldChat = () => {
    if (script.threadId) {
      router.push(`/chat?threadId=${script.threadId}&scriptId=${scriptId}`)
    } else {
      handleOpenNewChat()
    }
  }

  const handleOpenNewChat = () => {
    router.push(`/chat?newScriptId=${scriptId}`)
  }

  const handleRetrySync = async () => {
    try {
      await api.retryScriptSync(channelId, scriptId)
      toast.success('Vector indexing re-enqueued!')
    } catch (err: any) {
      toast.error(`Sync retry failed: ${err.message}`)
    }
  }

  return (
    <div className="group relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-amber-500/50 dark:hover:border-amber-500/50 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all duration-200 flex flex-col justify-between">
      {/* Top Meta & Actions */}
      <div>
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
              {script.source?.replace('_', ' ') || 'AI Script'}
            </span>
            <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
              v{script.currentVersion || 1}
            </span>
            {script.vectorSyncStatus === 'failed' && (
              <button
                onClick={handleRetrySync}
                title="Click to retry vector indexing"
                className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 hover:bg-red-500/20 flex items-center space-x-1"
              >
                <AlertCircle className="w-3 h-3" />
                <span>Sync Failed (Retry)</span>
              </button>
            )}
          </div>

          {/* Favorite Toggle */}
          <button
            onClick={() => onToggleFavorite(scriptId)}
            className={`p-1.5 rounded-lg transition ${
              script.isFavorite
                ? 'text-amber-500 hover:text-amber-600'
                : 'text-zinc-300 dark:text-zinc-600 hover:text-amber-500'
            }`}
          >
            <Star className={`w-4 h-4 ${script.isFavorite ? 'fill-current' : ''}`} />
          </button>
        </div>

        {/* Title */}
        <h3
          onClick={() => onOpenEditor(script)}
          className="text-base font-bold text-zinc-900 dark:text-zinc-100 group-hover:text-amber-500 transition-colors line-clamp-2 cursor-pointer mb-2"
        >
          {script.title}
        </h3>

        {/* Word count & duration */}
        <div className="flex items-center space-x-3 text-xs text-zinc-500 dark:text-zinc-400 mb-4">
          <span className="flex items-center space-x-1">
            <Clock className="w-3.5 h-3.5" />
            <span>{script.estimatedDurationMinutes || 1} min read</span>
          </span>
          <span>•</span>
          <span>{script.wordCount?.toLocaleString() || 0} words</span>
          <span>•</span>
          <span>{new Date(script.updatedAt || script.createdAt).toLocaleDateString()}</span>
        </div>

        {/* Tags */}
        {script.tags && script.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {script.tags.slice(0, 3).map((tag, idx) => (
              <span
                key={idx}
                className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-zinc-50 dark:bg-zinc-800/80 text-zinc-500 border border-zinc-200/50 dark:border-zinc-700/50"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Action Footer */}
      <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between">
        {/* Left Primary Actions */}
        <div className="flex items-center space-x-2">
          {/* Teleprompter Button */}
          <button
            onClick={() => onOpenTeleprompter(script)}
            className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs flex items-center space-x-1.5 transition active:scale-95 shadow-sm"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Studio</span>
          </button>

          {/* Edit Button */}
          <button
            onClick={() => onOpenEditor(script)}
            className="px-3 py-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-semibold text-xs flex items-center space-x-1.5 transition"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>Edit</span>
          </button>
        </div>

        {/* Right Secondary Actions Dropdown / Buttons */}
        <div className="flex items-center space-x-1">
          {/* History */}
          <button
            onClick={() => onOpenHistory(script)}
            title="Version History"
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
          >
            <History className="w-4 h-4" />
          </button>

          {/* Copy Clean */}
          <button
            onClick={handleCopy}
            title="Copy Clean Spoken Text"
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
          </button>

          {/* Download Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowMenu((prev) => !prev)}
              title="More Actions & Downloads"
              className="p-2 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {showMenu && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setShowMenu(false)}
                />
                <div className="absolute right-0 bottom-full mb-2 w-48 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl z-40 p-1.5 space-y-1 text-xs">
                  <button
                    onClick={() => {
                      setShowMenu(false)
                      handleOpenNewChat()
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg flex items-center space-x-2 text-zinc-700 dark:text-zinc-300 hover:bg-amber-500/10 hover:text-amber-500 transition text-left"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                    <span>Open in New Chat</span>
                  </button>

                  {script.threadId && (
                    <button
                      onClick={() => {
                        setShowMenu(false)
                        handleOpenOldChat()
                      }}
                      className="w-full px-2.5 py-1.5 rounded-lg flex items-center space-x-2 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition text-left"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>Open in Source Chat</span>
                    </button>
                  )}

                  <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />

                  <button
                    onClick={() => {
                      setShowMenu(false)
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
                      setShowMenu(false)
                      handleDownloadMd()
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg flex items-center space-x-2 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition text-left"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Markdown (.md)</span>
                  </button>

                  <button
                    onClick={() => {
                      setShowMenu(false)
                      handleDownloadTxt()
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg flex items-center space-x-2 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition text-left"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Download Plain Text (.txt)</span>
                  </button>

                  <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />

                  <button
                    onClick={() => {
                      setShowMenu(false)
                      onDelete(scriptId)
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg flex items-center space-x-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition text-left"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Script</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
