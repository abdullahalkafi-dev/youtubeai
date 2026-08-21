'use client'

import { useState, useEffect } from 'react'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { generateReplies, postReply } from '@/store/slices/comments-slice'
import { Sparkles, Send, Check, RefreshCw, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AiReplyOption } from '@/types/comment'

const QUICK_TEMPLATES = [
  'Thanks for watching!',
  'Appreciate the support!',
  'Great question!',
  'Keep watching for more!',
  "That's real talk!",
]

const TONE_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  General: { bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-700 dark:text-slate-300', border: 'border-slate-300 dark:border-slate-700' },
  Humorous: { bg: 'bg-amber-50 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-200 dark:border-amber-800/60' },
  Thankful: { bg: 'bg-rose-50 dark:bg-rose-950/40', text: 'text-rose-700 dark:text-rose-300', border: 'border-rose-200 dark:border-rose-800/60' },
  Witty: { bg: 'bg-purple-50 dark:bg-purple-950/40', text: 'text-purple-700 dark:text-purple-300', border: 'border-purple-200 dark:border-purple-800/60' },
  Informal: { bg: 'bg-emerald-50 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-200 dark:border-emerald-800/60' },
  Engaging: { bg: 'bg-indigo-50 dark:bg-indigo-950/40', text: 'text-indigo-700 dark:text-indigo-300', border: 'border-indigo-200 dark:border-indigo-800/60' },
}

interface CommentReplyFormProps {
  videoId: string
  commentId: string
  commentText: string
  onClose: () => void
  autoGenerate?: boolean
}

export function CommentReplyForm({
  videoId,
  commentId,
  commentText,
  onClose,
  autoGenerate = true,
}: CommentReplyFormProps) {
  const dispatch = useAppDispatch()
  const { replyLoading, generatedReplies } = useAppSelector((s) => s.comments)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [selectedTone, setSelectedTone] = useState<string | null>(null)
  const [showAiOptions, setShowAiOptions] = useState(true)

  const isGenerating = replyLoading === commentId
  const aiOptions: AiReplyOption[] = generatedReplies[commentId] || []

  // Trigger 5-tone generation if empty
  useEffect(() => {
    if (autoGenerate && aiOptions.length === 0 && !isGenerating) {
      dispatch(generateReplies({ videoId, commentId, commentText }))
    }
  }, [videoId, commentId, commentText, autoGenerate, aiOptions.length, isGenerating, dispatch])

  const handleGenerate = async () => {
    if (isGenerating) return
    try {
      await dispatch(generateReplies({ videoId, commentId, commentText })).unwrap()
    } catch {
      // Handled via state
    }
  }

  const handleSelectOption = (option: AiReplyOption) => {
    setText(option.text)
    setSelectedTone(option.tone)
  }

  const handleSendDirect = async (replyText: string) => {
    if (!replyText.trim() || sending) return
    setSending(true)
    try {
      await dispatch(postReply({ videoId, parentId: commentId, text: replyText })).unwrap()
      setText('')
      onClose()
    } catch {
      // Handled in thunk
    } finally {
      setSending(false)
    }
  }

  const handleSend = () => {
    handleSendDirect(text)
  }

  const handleTemplate = (template: string) => {
    setText(template)
    setSelectedTone(null)
  }

  return (
    <div className="mt-3 p-3.5 bg-gray-50 dark:bg-gray-800/80 rounded-xl border border-gray-200 dark:border-gray-700/80 space-y-3 font-sans shadow-sm">
      {/* 5-Tone AI Suggestions Panel (Matching Reference UI) */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
        <div className="px-3.5 py-2.5 bg-gray-50/80 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-md bg-indigo-500/10 text-indigo-500">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs font-semibold text-gray-900 dark:text-white">
              AI Smart Reply Options (5 Tones with Counter-Questions)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 flex items-center gap-1 transition disabled:opacity-50"
              title="Regenerate 5 tone variations"
            >
              <RefreshCw className={cn('w-3 h-3', isGenerating && 'animate-spin')} />
              {isGenerating ? 'Generating...' : 'Regenerate'}
            </button>
            <button
              onClick={() => setShowAiOptions(!showAiOptions)}
              className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition"
            >
              {showAiOptions ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {showAiOptions && (
          <div className="p-2 space-y-1.5">
            {isGenerating && aiOptions.length === 0 ? (
              <div className="py-6 text-center space-y-2">
                <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-xs text-gray-400">Crafting 5 customized replies with counter-questions...</p>
              </div>
            ) : aiOptions.length > 0 ? (
              aiOptions.map((opt, idx) => {
                const isSelected = text === opt.text || selectedTone === opt.tone
                const style = TONE_STYLES[opt.tone] || TONE_STYLES.General
                return (
                  <div
                    key={idx}
                    onClick={() => handleSelectOption(opt)}
                    className={cn(
                      'p-2.5 rounded-lg border transition cursor-pointer flex items-start justify-between gap-3 group relative',
                      isSelected
                        ? 'bg-indigo-50/70 dark:bg-indigo-950/30 border-indigo-300 dark:border-indigo-700 shadow-sm'
                        : 'bg-white dark:bg-gray-900 border-gray-150 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 hover:bg-gray-50/50 dark:hover:bg-gray-800/40',
                    )}
                  >
                    <div className="flex-1 min-w-0 pr-2">
                      <p className="text-xs text-gray-800 dark:text-gray-200 leading-relaxed font-normal">
                        {opt.text}
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <span
                        className={cn(
                          'px-2 py-0.5 text-[10px] font-semibold rounded-md border',
                          style.bg,
                          style.text,
                          style.border,
                        )}
                      >
                        {opt.tone || opt.label}
                      </span>

                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleSendDirect(opt.text)
                        }}
                        disabled={sending}
                        className="opacity-0 group-hover:opacity-100 transition px-2 py-0.5 text-[10px] font-semibold rounded bg-indigo-600 text-white hover:bg-indigo-700 flex items-center gap-1 shadow-sm"
                        title="Post this reply directly to YouTube"
                      >
                        <Send className="w-2.5 h-2.5" />
                        Send
                      </button>
                    </div>
                  </div>
                )
              })
            ) : (
              <div className="py-4 text-center">
                <button
                  onClick={handleGenerate}
                  className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 text-xs font-semibold rounded-lg hover:bg-indigo-100 transition flex items-center gap-1.5 mx-auto"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Generate 5 AI Tone Replies
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Editable Reply Textarea */}
      <div className="space-y-1.5">
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setSelectedTone(null)
          }}
          placeholder="Type or click any AI reply above to customize..."
          rows={3}
          className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-xs text-gray-900 dark:text-white placeholder:text-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-inner"
        />
      </div>

      {/* Quick Fallback Template Chips */}
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mr-1">Quick:</span>
        {QUICK_TEMPLATES.map((template) => (
          <button
            key={template}
            onClick={() => handleTemplate(template)}
            className="text-[10px] px-2 py-0.5 rounded-full border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 hover:text-indigo-600 dark:hover:text-indigo-400 hover:border-indigo-200 dark:hover:border-indigo-500/20 transition"
          >
            {template}
          </button>
        ))}
      </div>

      {/* Action Footer */}
      <div className="flex items-center justify-between pt-1">
        <div className="text-[11px] text-gray-400">
          {text.length > 0 && <span>{text.length} characters</span>}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-3 py-1.5 transition rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Cancel
          </button>

          <button
            onClick={handleSend}
            disabled={!text.trim() || sending}
            className={cn(
              'flex items-center gap-1.5 text-xs font-semibold px-4 py-1.5 rounded-xl transition shadow-sm',
              text.trim() && !sending
                ? 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-indigo-600/20'
                : 'bg-gray-200 dark:bg-gray-800 text-gray-400 cursor-not-allowed',
            )}
            title="Post reply to YouTube"
          >
            <Send className="w-3.5 h-3.5" />
            {sending ? 'Posting to YouTube...' : 'Post Reply'}
          </button>
        </div>
      </div>
    </div>
  )
}
