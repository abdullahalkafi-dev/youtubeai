'use client'

import React, { useState, useEffect } from 'react'
import { X, Sparkles, Plus, Loader2, FileText, Check } from 'lucide-react'
import api from '@/lib/api'
import { calculateTeleprompterStats } from '@/lib/teleprompter-parser'
import type { ScriptItem } from '@/types/script'

interface AddScriptModalProps {
  isOpen: boolean
  onClose: () => void
  channelId: string
  onScriptCreated: (script: ScriptItem) => void
}

export function AddScriptModal({
  isOpen,
  onClose,
  channelId,
  onScriptCreated,
}: AddScriptModalProps) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [formatType, setFormatType] = useState<'teleprompter_beat' | 'standard_markdown' | 'raw_text'>('teleprompter_beat')
  const [isBeautifying, setIsBeautifying] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setTitle('')
      setContent('')
      setTagsInput('')
      setFormatType('teleprompter_beat')
      setError(null)
    }
  }, [isOpen])

  // Auto-detect format on paste/change
  const handleContentChange = (val: string) => {
    setContent(val)
    if (val.includes('## ') && val.includes('> ') && (val.includes('[BEAT]') || val.includes('💎 JEWEL'))) {
      setFormatType('teleprompter_beat')
    } else if (val.includes('# ') || val.includes('## ')) {
      setFormatType('standard_markdown')
    } else {
      setFormatType('raw_text')
    }
  }

  const handleBeautify = async () => {
    if (!content.trim()) {
      setError('Please paste or enter some script content first')
      return
    }

    setIsBeautifying(true)
    setError(null)
    try {
      const res = await api.beautifyScript(channelId, {
        rawText: content,
        title: title.trim() || undefined,
      })
      setContent(res.content)
      if (!title.trim() && res.title) {
        setTitle(res.title)
      }
      setFormatType('teleprompter_beat')
    } catch (err: any) {
      setError(err.message || 'Failed to beautify script with AI')
    } finally {
      setIsBeautifying(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      setError('Please enter a script title')
      return
    }
    if (!content.trim()) {
      setError('Please enter script content')
      return
    }

    setIsSubmitting(true)
    setError(null)

    const stats = calculateTeleprompterStats(content)
    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)

    try {
      const newScript = await api.createScript(channelId, {
        title: title.trim(),
        content: content.trim(),
        wordCount: stats.wordCount,
        estimatedDurationMinutes: stats.estimatedDurationMinutes,
        tags,
        source: 'manual_import',
        formatType,
      })
      onScriptCreated(newScript)
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to create script')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  const stats = calculateTeleprompterStats(content)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <FileText className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
              Add New Script
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-500">
              {error}
            </div>
          )}

          {/* Title */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1">
              Script Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. LIL DURK — THE SENTENCE THAT STARTED BEFORE THE VERDICT"
              className="w-full px-4 py-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-sm focus:outline-none focus:border-amber-500 dark:text-zinc-100"
              required
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1">
              Tags (comma separated)
            </label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="e.g. Durk, Federal Trial, Legal Breakdown"
              className="w-full px-4 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-sm focus:outline-none focus:border-amber-500 dark:text-zinc-100"
            />
          </div>

          {/* Content & AI Beautify Toolbar */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                Script Content
              </label>
              <div className="flex items-center space-x-3">
                <span className="text-xs text-zinc-400">
                  {stats.estimatedDurationMinutes}m read · {stats.wordCount} words
                </span>
                <button
                  type="button"
                  onClick={handleBeautify}
                  disabled={isBeautifying || !content.trim()}
                  className="px-3 py-1 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-bold text-xs flex items-center space-x-1.5 transition active:scale-95 disabled:opacity-50 shadow-sm"
                >
                  {isBeautifying ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>{isBeautifying ? 'Formatting...' : '✨ AI Beautify Rhythm'}</span>
                </button>
              </div>
            </div>

            <textarea
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              placeholder="Paste or write your script here... Use markdown or plain text. You can use '✨ AI Beautify Rhythm' to transform raw text into professional spoken teleprompter cadence."
              rows={12}
              className="w-full p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-xs font-mono focus:outline-none focus:border-amber-500 leading-relaxed text-zinc-800 dark:text-zinc-200 resize-y"
              required
            />
          </div>

          {/* Format Badge */}
          <div className="flex items-center justify-between text-xs text-zinc-400 pt-2 border-t border-zinc-100 dark:border-zinc-800">
            <div className="flex items-center space-x-2">
              <span>Detected Format:</span>
              <span className="font-semibold text-amber-500 capitalize">
                {formatType.replace('_', ' ')}
              </span>
            </div>
          </div>
        </form>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-end space-x-3 bg-zinc-50 dark:bg-zinc-900/80">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !title.trim() || !content.trim()}
            className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm flex items-center space-x-2 transition active:scale-95 disabled:opacity-50 shadow-md"
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            <span>Save Script to Library</span>
          </button>
        </div>
      </div>
    </div>
  )
}
