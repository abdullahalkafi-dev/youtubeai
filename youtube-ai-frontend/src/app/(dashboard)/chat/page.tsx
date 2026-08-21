'use client'

import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAppSelector, useAppDispatch } from '@/store/hooks'
import {
  setActiveThread, createThread, selectThread,
  fetchThreads, optimisticAddUserMessage,
  appendStreamChunk, clearStreaming, finalizeStreamedMessage, removeLastUserMessage, renameThread,
  setSelectedSkill, enterDraftMode, deleteThread,
} from '@/store/slices/chat-slice'
import { useIsMobile } from '@/lib/hooks/use-media-query'
import { useSpeechRecognition } from '@/lib/hooks/use-speech-recognition'
import { getCategoryColor } from '@/lib/category-colors'
import { Plus, Video, Lightbulb, Send, Image, Download, Menu, X, Grid3X3, Star, Mic, MicOff, Paperclip, Pencil, Check, Square, Sparkles, Loader2, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import api, { formatAssetUrl } from '@/lib/api'
import { MessageRenderer } from '@/components/chat/message-renderer'
import { MessageActions } from '@/components/chat/message-actions'
import { EmptyState } from '@/components/chat/empty-state'
import { CategorySelector } from '@/components/chat/category-selector'
import type { ThreadCategory, ChatImage } from '@/types/chat'

export default function ChatPage() {
  const dispatch = useAppDispatch()
  const { threads, activeThreadId, activeThread, sending, streamingContent, selectedSkill, isDraftThread, loading: threadsLoading } = useAppSelector(s => s.chat)
  const channelId = useAppSelector(s => s.auth.activeChannelId)
  const isMobile = useIsMobile()
  const searchParams = useSearchParams()
  const urlVideoId = searchParams.get('videoId')
  const urlVideoTitle = searchParams.get('videoTitle')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [input, setInput] = useState('')
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [generatingConceptText, setGeneratingConceptText] = useState<string | null>(null)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [deleteModalThread, setDeleteModalThread] = useState<{ id: string; title: string } | null>(null)
  const [iteratingImage, setIteratingImage] = useState<{ url: string; mode: 'thumbnail' | 'scene' } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const initialInputRef = useRef('')

  const handleTranscript = useCallback((spokenText: string) => {
    const base = initialInputRef.current
    if (!base) {
      setInput(spokenText)
    } else {
      const needsSpace = !base.endsWith(' ') && !base.endsWith('\n')
      setInput(`${base}${needsSpace ? ' ' : ''}${spokenText}`)
    }
  }, [])

  const handleVoiceError = useCallback((err: string) => {
    toast.error(err)
  }, [])

  const {
    isListening,
    isSupported: voiceSupported,
    startListening,
    stopListening,
    resetTranscript,
  } = useSpeechRecognition({
    onTranscript: handleTranscript,
    onError: handleVoiceError,
  })

  const currentSkill = selectedSkill || 'general'
  const categoryColor = getCategoryColor(currentSkill)

  useEffect(() => {
    if (channelId) dispatch(fetchThreads(channelId))
  }, [channelId, dispatch])

  // Auto-load thread when activeThreadId is set but activeThread is null (e.g., after archive)
  useEffect(() => {
    if (activeThreadId && !activeThread) {
      dispatch(selectThread(activeThreadId))
    }
  }, [activeThreadId, activeThread, dispatch])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeThread?.messages?.length, streamingContent])

  useEffect(() => {
    return () => { abortControllerRef.current?.abort() }
  }, [])

  // Auto-open video thread from URL params (e.g. from "Open in AI Chat" button)
  useEffect(() => {
    if (!urlVideoId || !channelId) return

    // Query backend directly (don't rely on local threads array which may not be loaded yet)
    api.findThreadByVideoId(channelId, urlVideoId).then(existing => {
      if (existing?.id) {
        handleSelectThread(existing.id)
      } else {
        dispatch(createThread({
          channelId,
          type: 'video',
          videoId: urlVideoId,
          title: urlVideoTitle || undefined,
        })).unwrap().then(newThread => {
          if (newThread?.id) {
            handleSelectThread(newThread.id)
          }
        })
      }
    }).catch(() => {
      dispatch(createThread({
        channelId,
        type: 'video',
        videoId: urlVideoId,
        title: urlVideoTitle || undefined,
      })).unwrap().then(newThread => {
        if (newThread?.id) {
          handleSelectThread(newThread.id)
        }
      })
    })
  }, [urlVideoId, channelId])

  const allImages = useMemo(() => {
    if (!activeThread) return []
    const images: ChatImage[] = []
    activeThread.messages.forEach(msg => {
      if (msg.metadata?.images) images.push(...msg.metadata.images)
    })
    return images
  }, [activeThread])

  const hasMessages = Boolean(activeThread && activeThread.messages && activeThread.messages.length > 0)

  const handleSend = async () => {
    if ((!input.trim() && !selectedFile) || (!activeThreadId && !isDraftThread)) return

    if (isListening) {
      stopListening()
    }
    resetTranscript()
    initialInputRef.current = ''

    const messageContent = input
    const fileToSend = selectedFile
    const pinnedImage = iteratingImage
    setInput('')
    setSelectedFile(null)
    setIteratingImage(null)

    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()

    // If draft thread, create real thread first
    let threadId = activeThreadId
    if (isDraftThread) {
      if (!channelId) return
      try {
        const newThread = await dispatch(createThread({ channelId, type: 'standalone' })).unwrap()
        threadId = newThread.id
      } catch (err: any) {
        toast.error(err.message || 'Failed to create thread')
        dispatch(clearStreaming())
        return
      }
    }

    if (!threadId) return

    // === DIRECT IMAGE EDIT — pinned image + text feedback ===
    if (pinnedImage && messageContent.trim()) {
      dispatch(optimisticAddUserMessage({ threadId, content: messageContent }))
      const toastId = toast.loading('Editing image...')
      try {
        // Upload reference image if user attached one
        const referenceUrls: string[] = []
        if (fileToSend) {
          const uploaded = await api.uploadFile(threadId, fileToSend)
          const refUrl = uploaded?.url || uploaded?.metadata?.attachments?.[0]?.url
          if (refUrl) referenceUrls.push(refUrl)
        }
        await api.editImage(threadId, {
          prompt: messageContent,
          baseImageUrl: pinnedImage.url,
          referenceImageUrls: referenceUrls,
        })
        dispatch(selectThread(threadId))
        toast.success('Image edited!', { id: toastId })
      } catch (err: any) {
        toast.error(err.message || 'Image edit failed', { id: toastId })
        dispatch(removeLastUserMessage())
        dispatch(clearStreaming())
      }
      return
    }

    // === DIRECT IMAGE GENERATION — Generate Image mode, no pinned image ===
    if (currentSkill === 'image' && !pinnedImage && !fileToSend && messageContent.trim()) {
      dispatch(optimisticAddUserMessage({ threadId, content: messageContent }))
      const toastId = toast.loading('Generating image...')
      try {
        await api.generateImageDirect(threadId, {
          prompt: messageContent,
          videoTitle: activeThread?.videoTitle || activeThread?.title,
        })
        dispatch(selectThread(threadId))
        toast.success('Image generated!', { id: toastId })
      } catch (err: any) {
        toast.error(err.message || 'Image generation failed', { id: toastId })
        dispatch(removeLastUserMessage())
        dispatch(clearStreaming())
      }
      return
    }

    // === FILE UPLOAD ===
    if (fileToSend) {
      dispatch(optimisticAddUserMessage({ threadId, content: messageContent || `📎 ${fileToSend.name}` }))
      try {
        await api.uploadFile(threadId, fileToSend, messageContent)
        dispatch(selectThread(threadId))
        dispatch(clearStreaming())
      } catch (err: any) {
        toast.error(err.message || 'Upload failed')
        dispatch(removeLastUserMessage())
        dispatch(clearStreaming())
      }
      return
    }

    // === NORMAL CHAT STREAM ===
    dispatch(optimisticAddUserMessage({ threadId, content: messageContent }))

    // Capture threadId to guard against thread switches during stream
    const streamThreadId = threadId
    let fullContent = ''
    let streamCompleted = false
    try {
      await api.sendMessageStream(
        threadId,
        messageContent,
        selectedSkill || undefined,
        (chunk) => { fullContent += chunk; dispatch(appendStreamChunk(chunk)) },
        (messageId) => {
          streamCompleted = true
          dispatch(finalizeStreamedMessage({ content: fullContent, messageId, category: currentSkill }))
        },
        (error) => {
          // Only clean up if we're still on the same thread (user may have switched)
          if (streamThreadId === activeThreadId) {
            if (error !== 'The operation was aborted') {
              toast.error(`Stream interrupted: ${error}`)
            }
            dispatch(clearStreaming())
          }
        },
        abortControllerRef.current.signal,
      )
    } catch (err: any) {
      if (streamThreadId === activeThreadId) {
        if (err.name !== 'AbortError') {
          toast.error(err.message || 'Stream failed')
        }
        dispatch(clearStreaming())
      }
    } finally {
      // Safety: if stream ended without done event, clean up stuck UI
      if (!streamCompleted && streamThreadId === activeThreadId) {
        dispatch(clearStreaming())
      }
    }
  }

  const handleStopStreaming = () => { abortControllerRef.current?.abort() }

  const handleCreateThread = () => {
    dispatch(enterDraftMode())
    setDrawerOpen(false)
  }

  const handleSelectThread = (threadId: string) => {
    // Abort any in-progress stream before switching threads
    abortControllerRef.current?.abort()
    dispatch(setActiveThread(threadId))
    dispatch(selectThread(threadId))
    setDrawerOpen(false)
  }

  const handleRename = () => {
    if (activeThreadId && renameValue.trim()) {
      dispatch(renameThread({ threadId: activeThreadId, title: renameValue.trim() }))
      setIsRenaming(false)
    }
  }

  const handleSetThumbnail = async (image: ChatImage) => {
    if (!activeThread?.videoId) { toast.error('No video linked to this thread'); return }
    const toastId = toast.loading('Uploading thumbnail to YouTube...')
    try {
      await api.setVideoThumbnail(activeThread.videoId, image.url)
      toast.success('Thumbnail set & uploaded to YouTube!', { id: toastId })
    } catch (err: any) {
      toast.error(err.message || 'Failed to upload thumbnail to YouTube', { id: toastId })
    }
  }

  const handleDownload = async (image: ChatImage) => {
    const assetUrl = formatAssetUrl(image.url)
    const toastId = toast.loading('Downloading thumbnail...')
    try {
      const res = await fetch(assetUrl)
      if (!res.ok) throw new Error('Failed to fetch image')
      const blob = await res.blob()
      const blobUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = `thumbnail_${Date.now()}.png`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(blobUrl)
      toast.success('Thumbnail downloaded!', { id: toastId })
    } catch {
      // Fallback direct link
      const link = document.createElement('a')
      link.href = assetUrl
      link.download = `thumbnail_${Date.now()}.png`
      link.target = '_blank'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      toast.success('Download started', { id: toastId })
    }
  }

  const handleVoiceToggle = () => {
    if (isListening) {
      stopListening()
      initialInputRef.current = input
    } else {
      initialInputRef.current = input
      resetTranscript()
      startListening()
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (file) {
      if (file.size > 10 * 1024 * 1024) { toast.error('File too large (max 10MB)'); return }

      // If in image mode and no pinned image, upload and auto-pin for editing
      if (currentSkill === 'image' && !iteratingImage && file.type.startsWith('image/') && activeThreadId) {
        try {
          const toastId = toast.loading('Uploading reference image...')
          const result = await api.uploadFile(activeThreadId, file)
          const attachmentUrl = result?.url || result?.metadata?.attachments?.[0]?.url
          if (attachmentUrl) {
            setIteratingImage({ url: attachmentUrl, mode: 'scene' })
            toast.success('Image pinned for editing. Type your changes below.', { id: toastId })
            return
          }
        } catch (err: any) {
          toast.error(err.message || 'Upload failed')
          return
        }
      }

      setSelectedFile(file)
      toast.info(`File selected: ${file.name}`)
    }
  }

  const handleSuggestionClick = (text: string) => { setInput(text) }

  const threadList = (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
        {!sidebarCollapsed && (
          <Button onClick={handleCreateThread} variant="outline" size="sm" className="flex-1 gap-1.5 text-xs">
            <Plus className="w-3.5 h-3.5" />New Thread
          </Button>
        )}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition ml-1"
        >
          {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
        {threadsLoading && threads.length === 0 ? (
          <div className="space-y-2 p-1">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 bg-gray-100 dark:bg-gray-800/80 rounded-lg animate-pulse p-2 space-y-1.5 border border-transparent">
                <div className="h-2.5 w-3/4 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-2 w-1/3 bg-gray-200 dark:bg-gray-700 rounded" />
              </div>
            ))}
          </div>
        ) : (
          threads.map((thread) => {
            return (
              <div key={thread.id} className="group relative">
                <button
                  onClick={() => handleSelectThread(thread.id)}
                  className={cn(
                    'w-full text-left rounded-lg transition border',
                    sidebarCollapsed ? 'px-1.5 py-2 flex justify-center' : 'px-2.5 py-2',
                    thread.id === activeThreadId
                      ? 'border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-500/10'
                      : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-800/50'
                  )}
                >
                  {sidebarCollapsed ? (
                    <div className="flex items-center justify-center">
                      {thread.type === 'video' ? <Video className="w-4 h-4 text-indigo-500" /> : <Lightbulb className="w-4 h-4 text-amber-500" />}
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5">
                        {thread.type === 'video' ? <Video className="w-3 h-3 text-indigo-500 shrink-0" /> : <Lightbulb className="w-3 h-3 text-amber-500 shrink-0" />}
                        <p className={cn('text-xs font-medium truncate', thread.id === activeThreadId ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400')}>
                          {thread.title}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 ml-4.5">
                        <span className="text-xs text-gray-400">{thread.messageCount} msgs</span>
                      </div>
                    </>
                  )}
                </button>
                {!sidebarCollapsed && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteModalThread({ id: thread.id, title: thread.title }) }}
                    className="absolute right-1 top-1 p-1 rounded opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition"
                    title="Delete thread"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )

  return (
    <>
    <div className="flex h-[calc(100vh-3.5rem)] max-w-[1600px] mx-auto overflow-hidden">
      {!isMobile && (
        <div className={cn(
          "bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 shrink-0 transition-all duration-200",
          sidebarCollapsed ? "w-12" : "w-56"
        )}>
          {threadList}
        </div>
      )}

      {isMobile && drawerOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-white dark:bg-gray-900 shadow-xl">
            <div className="flex items-center justify-between p-3 border-b border-gray-100 dark:border-gray-800">
              <span className="text-sm font-semibold text-gray-900 dark:text-white">Threads</span>
              <button onClick={() => setDrawerOpen(false)} className="text-gray-400 hover:text-gray-600 p-1"><X className="w-4 h-4" /></button>
            </div>
            {threadList}
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0 bg-gray-50 dark:bg-gray-950">
        {/* Header */}
        <div className="px-4 py-2.5 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isMobile && (
                <button onClick={() => setDrawerOpen(true)} className="text-gray-400 hover:text-gray-600 p-1">
                  <Menu className="w-4 h-4" />
                </button>
              )}
              <div>
                {isRenaming && activeThreadId ? (
                  <div className="flex items-center gap-1">
                    <Input value={renameValue} onChange={e => setRenameValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setIsRenaming(false) }} className="h-7 text-sm font-semibold" autoFocus />
                    <button onClick={handleRename} className="text-green-500 p-1"><Check className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setIsRenaming(false)} className="text-gray-400 p-1"><X className="w-3.5 h-3.5" /></button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white font-heading">{activeThread?.title || 'Select a thread'}</h3>
                    {activeThread && (
                      <button onClick={() => { setRenameValue(activeThread.title); setIsRenaming(true) }} className="text-gray-400 hover:text-gray-600 p-0.5">
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-xs text-gray-400">
                    {activeThread?.type === 'video' ? 'Video Thread' : 'Thread'} · {activeThread?.messages?.length || 0} messages
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Button variant="ghost" size="icon" onClick={() => setGalleryOpen(!galleryOpen)} className={cn('w-8 h-8', galleryOpen ? 'text-indigo-500' : 'text-gray-400 hover:text-indigo-500')}>
                <Grid3X3 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 lg:p-5">
            {/* Empty State */}
            {!hasMessages && !sending && activeThread && (
              <EmptyState category={currentSkill} onSuggestionClick={handleSuggestionClick} />
            )}

            {hasMessages && activeThread && (
              <div className="max-w-3xl mx-auto space-y-4">
                {activeThread.messages.map((msg) => (
                  <div key={msg.id} className={cn('flex items-start gap-2.5 group', msg.role === 'user' ? 'justify-end' : '')}>
                    {msg.role === 'assistant' && (
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400 to-indigo-600 flex items-center justify-center shrink-0 shadow-sm">
                        <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                      </div>
                    )}
                    <div className={cn(
                      'rounded-2xl px-4 py-3 max-w-2xl shadow-sm',
                      msg.role === 'user'
                        ? 'bg-indigo-500 text-white rounded-tr-md'
                        : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-tl-md'
                    )}>
                      {msg.role === 'user' ? (
                        <p className="text-sm text-white whitespace-pre-wrap">{typeof msg.content === 'string' ? msg.content : ''}</p>
                      ) : (
                        <>
                          <MessageRenderer
                            content={msg.content}
                            category={msg.metadata?.category || 'general'}
                            messageId={msg.id || msg._id}
                            messageImages={msg.metadata?.images}
                            onStartGenerate={(title) => {
                              setGalleryOpen(true)
                              setGeneratingConceptText(title)
                            }}
                            onFinishGenerate={() => setGeneratingConceptText(null)}
                            onEditImage={(url, mode) => setIteratingImage({ url, mode })}
                            videoTitle={activeThread?.videoTitle || activeThread?.title}
                            threadTitle={activeThread?.title}
                          />
                          {/* Skill badge — shows which skill generated this response */}
                          {msg.metadata?.category && (
                            <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                              <span className={cn(
                                'inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-medium',
                                getCategoryColor(msg.metadata.category).bg,
                                getCategoryColor(msg.metadata.category).bgDark,
                                getCategoryColor(msg.metadata.category).text,
                                getCategoryColor(msg.metadata.category).textDark,
                              )}>
                                {msg.metadata.category}
                              </span>
                            </div>
                          )}
                        </>
                      )}
                      {/* Attachments */}
                      {msg.metadata?.attachments?.map((att, idx) => (
                        <div key={idx} className="mt-2 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
                          {att.type === 'image' ? (
                            <img src={formatAssetUrl(att.url)} alt={att.filename} className="max-w-xs rounded" />
                          ) : (
                            <div className="flex items-center gap-2 text-xs text-gray-500">
                              <Paperclip className="w-3 h-3" />
                              <span>{att.filename}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    {/* Message Actions */}
                    <MessageActions
                      content={msg.content}
                      role={msg.role}
                      threadId={activeThreadId || undefined}
                      messageId={msg.id || (msg as any)._id?.toString?.() || ''}
                      onDelete={() => {
                        if (activeThreadId) {
                          dispatch(setActiveThread(activeThreadId))
                          dispatch(selectThread(activeThreadId))
                        }
                      }}
                    />
                    {msg.role === 'user' && (
                      <div className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-gray-600 dark:text-gray-300">U</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Streaming content */}
            {sending && streamingContent && (
              <div className="flex items-start gap-2.5 mt-4">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400 to-indigo-600 flex items-center justify-center shrink-0 shadow-sm">
                  <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                </div>
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl rounded-tl-md px-4 py-3 shadow-sm max-w-2xl">
                  <MessageRenderer content={streamingContent} category={currentSkill} isStreaming />
                  <span className="inline-block w-1.5 h-4 bg-indigo-400 animate-pulse ml-0.5" />
                </div>
              </div>
            )}

            {/* Loading dots */}
            {sending && !streamingContent && (
              <div className="flex items-start gap-2.5 mt-4">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400 to-indigo-600 flex items-center justify-center shrink-0 shadow-sm">
                  <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                </div>
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl rounded-tl-md px-4 py-3 shadow-sm">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" />
                    <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '.1s' }} />
                    <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '.2s' }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Image Gallery Panel */}
          {galleryOpen && (
            <div className="w-72 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 shrink-0 flex flex-col">
              <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Image className="w-4 h-4 text-indigo-500" />
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">Generated Images</span>
                </div>
                <button onClick={() => setGalleryOpen(false)} className="text-gray-400 hover:text-gray-600 p-1"><X className="w-4 h-4" /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {/* Skeleton Card during active image generation */}
                {generatingConceptText && (
                  <div className="rounded-lg overflow-hidden border border-violet-300 dark:border-violet-600/40 bg-violet-50/50 dark:bg-violet-950/20 p-3 space-y-2.5 animate-pulse shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded-full bg-violet-600 text-white font-bold text-[10px]">
                        {generatingConceptText}
                      </span>
                      <span className="text-[10px] text-violet-600 dark:text-violet-400 font-medium flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin text-violet-500" /> Generating...
                      </span>
                    </div>
                    <div className="aspect-video bg-violet-200/60 dark:bg-violet-900/40 rounded-md flex items-center justify-center">
                      <Sparkles className="w-6 h-6 text-violet-500 animate-bounce" />
                    </div>
                    <p className="text-[10px] text-violet-600 dark:text-violet-300 font-medium text-center">
                      Creating 16:9 HD AI Thumbnail...
                    </p>
                  </div>
                )}

                {allImages.length === 0 && !generatingConceptText ? (
                  <div className="text-center py-8">
                    <Image className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                    <p className="text-xs text-gray-400">No images generated yet</p>
                  </div>
                ) : (
                  allImages.map((img) => (
                    <div key={img.id} className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
                      <div className="relative aspect-video bg-gray-100 dark:bg-gray-800">
                        <img src={formatAssetUrl(img.url)} alt={img.conceptTitle || img.textOverlay || 'Generated Thumbnail'} className="w-full h-full object-cover" loading="lazy" />
                        {img.conceptTitle && (
                          <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-violet-600/90 text-white font-bold text-[9px] shadow-sm backdrop-blur-sm">
                            {img.conceptTitle}
                          </span>
                        )}
                      </div>
                      <div className="p-2.5 bg-gray-50 dark:bg-gray-800/50 space-y-2">
                        {img.textOverlay && (
                          <div className="bg-gray-900 text-white text-[10px] font-black tracking-wide uppercase px-2 py-1 rounded text-center leading-tight">
                            {img.textOverlay}
                          </div>
                        )}
                        <p className="text-[10px] text-gray-500 line-clamp-2 leading-snug">{img.prompt}</p>
                        <div className="flex gap-1.5 pt-0.5">
                          {activeThread?.videoId && (
                            <button onClick={() => handleSetThumbnail(img)} className="flex-1 bg-indigo-500 text-white text-[10px] font-semibold py-1.5 rounded-md hover:bg-indigo-600 transition flex items-center justify-center gap-1">
                              <Star className="w-3 h-3" />Set Thumbnail
                            </button>
                          )}
                          <button onClick={() => handleDownload(img)} className={cn('flex-1 bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-[10px] font-semibold py-1.5 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 transition flex items-center justify-center gap-1', !activeThread?.videoId && 'w-full')}>
                            <Download className="w-3 h-3" />Download
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="px-4 py-3 bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800 shrink-0">
          <div className="max-w-4xl mx-auto">
            {/* Unified Floating Card Input */}
            <div className={cn(
              'border rounded-2xl p-3 shadow-md transition-all space-y-2',
              isListening
                ? 'bg-red-50/30 dark:bg-red-950/20 border-red-400/80 dark:border-red-500/60 ring-2 ring-red-500/20'
                : 'bg-gray-50/80 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700/80 shadow-gray-200/40 dark:shadow-none focus-within:border-indigo-500/80 focus-within:ring-2 focus-within:ring-indigo-500/20'
            )}>
              {/* Active voice banner */}
              {isListening && (
                <div className="flex items-center justify-between px-3 py-1.5 bg-red-100/70 dark:bg-red-900/40 border border-red-200 dark:border-red-800/60 rounded-xl text-xs text-red-800 dark:text-red-200 animate-in fade-in slide-in-from-bottom-1 duration-150">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                    </span>
                    <span className="font-medium text-[11px] sm:text-xs truncate">
                      Listening... speak naturally (pausing will not erase words)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      stopListening()
                      initialInputRef.current = input
                    }}
                    className="px-2 py-0.5 text-[10px] sm:text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-md transition shadow-xs shrink-0 cursor-pointer ml-2"
                  >
                    Done
                  </button>
                </div>
              )}

              {/* Selected file preview */}
              {selectedFile && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-100/70 dark:bg-indigo-500/20 rounded-xl border border-indigo-200 dark:border-indigo-500/30">
                  <Paperclip className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  <span className="text-xs font-medium text-indigo-900 dark:text-indigo-200 truncate flex-1">{selectedFile.name}</span>
                  <span className="text-[10px] text-indigo-400 font-mono">{(selectedFile.size / 1024).toFixed(0)}KB</span>
                  <button onClick={() => setSelectedFile(null)} className="text-gray-400 hover:text-red-500 p-0.5 rounded-full transition"><X className="w-3.5 h-3.5" /></button>
                </div>
              )}

              {/* Iterating Image Preview */}
              {iteratingImage && (
                <div className="flex items-center gap-2 px-3 py-2 bg-pink-50/70 dark:bg-pink-500/10 rounded-xl border border-pink-200 dark:border-pink-500/30">
                  <img src={formatAssetUrl(iteratingImage.url)} alt="Editing" className="w-16 h-9 object-cover rounded" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-semibold text-pink-700 dark:text-pink-300">Editing this image</p>
                    <p className="text-[9px] text-pink-500 truncate">Describe changes below</p>
                  </div>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="p-1 text-gray-400 hover:text-pink-500 dark:hover:text-pink-400 rounded transition"
                    title="Upload reference image"
                  >
                    <Paperclip className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setIteratingImage(null)} className="text-gray-400 hover:text-red-500 p-0.5">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Textarea */}
              <textarea
                value={input}
                onChange={(e) => {
                  setInput(e.target.value)
                  if (isListening) {
                    initialInputRef.current = e.target.value
                    resetTranscript()
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSend()
                  }
                }}
                placeholder="Ask about script, SEO, thumbnail, trends... (Shift + Enter for new line)"
                rows={2}
                className="w-full bg-transparent border-0 px-1 py-1 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-0 resize-none font-normal leading-relaxed"
              />

              {/* Bottom Control Bar */}
              <div className="flex items-center justify-between pt-1 border-t border-gray-200/60 dark:border-gray-700/50">
                <div className="flex items-center gap-2">
                  <CategorySelector value={currentSkill} onChange={(skill) => dispatch(setSelectedSkill(skill))} />
                  <input ref={fileInputRef} type="file" accept=".pdf,.txt,.md,.markdown,.jpg,.jpeg,.png,.webp,.gif" onChange={handleFileSelect} className="hidden" />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="p-1.5 text-gray-400 hover:text-indigo-500 dark:hover:text-indigo-400 rounded-lg hover:bg-gray-200/50 dark:hover:bg-gray-700/50 transition flex items-center gap-1 text-xs cursor-pointer"
                    title="Attach file (.pdf, .txt, .md, images)"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>
                  {voiceSupported && (
                    <button
                      type="button"
                      onClick={handleVoiceToggle}
                      className={cn(
                        'p-1.5 rounded-lg transition flex items-center text-xs cursor-pointer',
                        isListening
                          ? 'text-white bg-red-500 hover:bg-red-600 animate-pulse shadow-sm shadow-red-500/30 ring-2 ring-red-400/50'
                          : 'text-gray-400 hover:text-indigo-500 dark:hover:text-indigo-400 hover:bg-gray-200/50 dark:hover:bg-gray-700/50'
                      )}
                      title={isListening ? 'Stop listening' : 'Continuous voice dictation'}
                    >
                      {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    </button>
                  )}
                </div>

                <div>
                  {sending ? (
                    <Button onClick={handleStopStreaming} size="icon" className="w-8 h-8 rounded-xl bg-red-500 hover:bg-red-600 text-white shrink-0 shadow-sm shadow-red-500/20 cursor-pointer">
                      <Square className="w-3.5 h-3.5" />
                    </Button>
                  ) : (
                    <Button onClick={handleSend} disabled={!input.trim() && !selectedFile} size="icon" className="w-8 h-8 rounded-xl bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white shrink-0 shadow-md shadow-indigo-500/25 transition-all cursor-pointer">
                      <Send className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    {/* Delete Thread Confirmation Modal */}
    {deleteModalThread && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <div className="w-full max-w-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl p-6">
          <h3 className="text-base font-bold text-gray-900 dark:text-white mb-2">Delete Thread?</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
            This will permanently delete <span className="font-semibold text-gray-700 dark:text-gray-300">"{deleteModalThread.title}"</span> and all its messages.
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-5">Video data in Video Library is preserved.</p>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setDeleteModalThread(null)}
              className="px-4 py-2 text-xs font-semibold text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                dispatch(deleteThread(deleteModalThread.id))
                setDeleteModalThread(null)
              }}
              className="px-4 py-2 text-xs font-semibold text-white bg-red-500 hover:bg-red-600 rounded-lg transition shadow-sm"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
