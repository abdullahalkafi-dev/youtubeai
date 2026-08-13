'use client'

import { useState } from 'react'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { generateReply, postReply } from '@/store/slices/comments-slice'
import { Sparkles, Send } from 'lucide-react'
import { cn } from '@/lib/utils'

const QUICK_TEMPLATES = [
  'Thanks for watching!',
  'Appreciate the support!',
  'Great question!',
  'Keep watching for more!',
  "That's real talk!",
]

interface CommentReplyFormProps {
  videoId: string
  commentId: string
  commentText: string
  onClose: () => void
}

export function CommentReplyForm({ videoId, commentId, commentText, onClose }: CommentReplyFormProps) {
  const dispatch = useAppDispatch()
  const { replyLoading } = useAppSelector((s) => s.comments)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  const isGenerating = replyLoading === commentId

  const handleGenerate = async () => {
    if (isGenerating) return
    try {
      const result = await dispatch(generateReply({ videoId, commentId, commentText })).unwrap()
      setText(result.reply)
    } catch {
      // Silent fail — UI stays on current state
    }
  }

  const handleSend = async () => {
    if (!text.trim() || sending) return
    setSending(true)
    try {
      await dispatch(postReply({ videoId, parentId: commentId, text })).unwrap()
      setText('')
      onClose()
    } catch (err: any) {
      // Error will be surfaced via rejected case
    } finally {
      setSending(false)
    }
  }

  const handleTemplate = (template: string) => {
    setText(template)
  }

  return (
    <div className="mt-2 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Write a reply..."
        rows={3}
        className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 text-xs text-gray-900 dark:text-white placeholder:text-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
      />

      <div className="flex flex-wrap gap-1.5 mt-2">
        {QUICK_TEMPLATES.map((template) => (
          <button
            key={template}
            onClick={() => handleTemplate(template)}
            className="text-[10px] px-2 py-1 rounded-full border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 hover:text-indigo-600 dark:hover:text-indigo-400 hover:border-indigo-200 dark:hover:border-indigo-500/20 transition"
          >
            {template}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className={cn(
            'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition font-medium',
            isGenerating
              ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 border-gray-200 dark:border-gray-700 cursor-not-allowed'
              : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 hover:text-indigo-600 dark:hover:text-indigo-400 hover:border-indigo-200 dark:hover:border-indigo-500/20',
          )}
        >
          <Sparkles className={cn('w-3 h-3', isGenerating && 'animate-pulse')} />
          {isGenerating ? 'Generating...' : 'Auto-Generate'}
        </button>

        <div className="flex-1" />

        <button
          onClick={onClose}
          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-3 py-1.5 transition"
        >
          Cancel
        </button>

        <button
          onClick={handleSend}
          disabled={!text.trim() || sending}
          className={cn(
            'flex items-center gap-1.5 text-xs font-semibold px-4 py-1.5 rounded-lg transition shadow-sm',
            text.trim() && !sending
              ? 'bg-indigo-500 text-white hover:bg-indigo-600 shadow-indigo-500/20'
              : 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed',
          )}
          title="Post reply to YouTube"
        >
          <Send className="w-3 h-3" />
          {sending ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  )
}
