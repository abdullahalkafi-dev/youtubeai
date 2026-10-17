'use client'

import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Loader2, MessageSquareText, RotateCcw, Send, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { errorMessage, reelsApi } from '@/lib/reels-api'
import { cn } from '@/lib/utils'
import type { CampaignChatMessage } from '@/types/publishing'

const SUGGESTIONS = ['How is this campaign doing?', 'Which reel should I publish next?', 'What should I make more of?', 'Give me 3 new reel ideas for this topic']

/** "Ask about this campaign": a slide-over assistant that only knows this campaign. */
export function CampaignChat({ channelId, campaignId, campaignName }: { channelId: string; campaignId: string; campaignName: string }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<CampaignChatMessage[] | null>(null)
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || messages !== null) return
    let alive = true
    reelsApi
      .campaignChat(channelId, campaignId)
      .then((r) => alive && setMessages(r.messages))
      .catch(() => alive && setMessages([]))
    return () => {
      alive = false
    }
  }, [open, messages, channelId, campaignId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking])

  const ask = async (q: string) => {
    const question = q.trim()
    if (!question || thinking) return
    setInput('')
    setMessages((m) => [...(m ?? []), { role: 'user', content: question }])
    setThinking(true)
    try {
      const { answer } = await reelsApi.askCampaign(channelId, campaignId, question)
      setMessages((m) => [...(m ?? []), { role: 'assistant', content: answer }])
    } catch (err) {
      toast.error(errorMessage(err))
      setMessages((m) => (m ?? []).slice(0, -1))
      setInput(question)
    } finally {
      setThinking(false)
    }
  }

  const clear = async () => {
    try {
      await reelsApi.clearCampaignChat(channelId, campaignId)
      setMessages([])
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 px-4 py-3 rounded-full bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm shadow-xl flex items-center gap-2 transition active:scale-95"
      >
        <MessageSquareText className="w-4 h-4" /> Ask about this campaign
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md h-full bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 flex flex-col shadow-2xl">
            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Campaign assistant</p>
                <p className="text-[11px] text-zinc-500 truncate">{campaignName}</p>
              </div>
              {!!messages?.length && (
                <button onClick={clear} title="Start over" className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <RotateCcw className="w-4 h-4" />
                </button>
              )}
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages === null ? (
                <Loader2 className="w-5 h-5 animate-spin text-amber-500 mx-auto mt-10" />
              ) : messages.length === 0 ? (
                <div className="space-y-3 pt-4">
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    Ask me anything about this campaign: how it is doing, which reel to post next, or what to make more of.
                  </p>
                  <div className="flex flex-col gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => ask(s)}
                        className="text-left px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-700 dark:text-zinc-300 hover:border-amber-500 hover:text-amber-600 transition"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((m, i) => (
                  <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                    <div
                      className={cn(
                        'max-w-[88%] px-3 py-2 rounded-2xl text-sm leading-relaxed',
                        m.role === 'user' ? 'bg-amber-500 text-black rounded-br-sm' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 rounded-bl-sm',
                      )}
                    >
                      {m.role === 'user' ? (
                        m.content
                      ) : (
                        <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0.5 prose-headings:my-2">
                          <Markdown remarkPlugins={[remarkGfm]}>{m.content}</Markdown>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
              {thinking && (
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500" /> Looking at your campaign…
                </div>
              )}
              <div ref={endRef} />
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                ask(input)
              }}
              className="p-3 border-t border-zinc-200 dark:border-zinc-800 flex gap-2"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about this campaign…"
                className="flex-1 px-3 py-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-sm dark:text-zinc-100 focus:outline-none focus:border-amber-500"
              />
              <button type="submit" disabled={!input.trim() || thinking} className="px-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black">
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
