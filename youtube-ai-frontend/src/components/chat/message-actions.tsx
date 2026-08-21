'use client'

import { useState, useEffect } from 'react'
import { Copy, Check, RotateCcw, Volume2, VolumeX, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import api from '@/lib/api'

interface MessageActionsProps {
  content: string
  role: 'user' | 'assistant'
  threadId?: string
  messageId?: string
  onRegenerate?: () => void
  onDelete?: () => void
}

export function MessageActions({ content, role, threadId, messageId, onRegenerate, onDelete }: MessageActionsProps) {
  const [copied, setCopied] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      toast.success('Copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Failed to copy')
    }
  }

  const handleSpeak = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      toast.error('Text-to-Voice is not supported in this browser')
      return
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel()
      setIsSpeaking(false)
      return
    }

    window.speechSynthesis.cancel()

    // Clean text by stripping markdown symbols for natural speech
    const cleanText = content
      .replace(/[#*`_~]/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .trim()

    if (!cleanText) return

    const utterance = new SpeechSynthesisUtterance(cleanText)
    const voices = window.speechSynthesis.getVoices()
    const preferredVoice =
      voices.find(
        (v) =>
          v.lang.startsWith('en') &&
          (v.name.includes('Google') || v.name.includes('Natural')),
      ) || voices.find((v) => v.lang.startsWith('en'))

    if (preferredVoice) utterance.voice = preferredVoice

    utterance.onend = () => setIsSpeaking(false)
    utterance.onerror = () => setIsSpeaking(false)

    setIsSpeaking(true)
    window.speechSynthesis.speak(utterance)
  }

  return (
    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        onClick={handleCopy}
        className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition"
        title="Copy message"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      <button
        onClick={handleSpeak}
        className={cn(
          "p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition",
          isSpeaking && "text-emerald-500 hover:text-emerald-600 dark:text-emerald-400"
        )}
        title={isSpeaking ? "Stop speaking" : "Listen to message (Text-to-Voice)"}
      >
        {isSpeaking ? <VolumeX className="w-3.5 h-3.5 animate-pulse text-emerald-500" /> : <Volume2 className="w-3.5 h-3.5" />}
      </button>
      {role === 'assistant' && onRegenerate && (
        <button
          onClick={onRegenerate}
          className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition"
          title="Regenerate response"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      )}
      {threadId && messageId && (
        <button
          onClick={async () => {
            const rawMessageId = typeof messageId === 'string' ? messageId : (messageId?.id || messageId?._id || String(messageId || ''))
            if (!rawMessageId || rawMessageId === '[object Object]') {
              toast.error('Invalid message identifier')
              return
            }
            try {
              await api.deleteMessage(threadId, rawMessageId)
              onDelete?.()
              toast.success('Message deleted')
            } catch (err: any) {
              toast.error(err.message || 'Failed to delete message')
            }
          }}
          className="p-1.5 rounded-md text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition"
          title="Delete message"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}
