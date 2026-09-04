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
import { toggleMobileSidebar } from '@/store/slices/ui-slice'
import { useIsMobile } from '@/lib/hooks/use-media-query'
import { useSpeechRecognition } from '@/lib/hooks/use-speech-recognition'
import { useAudioVisualizer } from '@/lib/hooks/use-audio-visualizer'
import { useTheme } from '@/lib/hooks/use-theme'
import { getCategoryColor } from '@/lib/category-colors'
import { Plus, Video, Lightbulb, Send, Image, Download, Menu, X, Grid3X3, Star, Mic, MicOff, Paperclip, Pencil, Check, Square, Sparkles, Loader2, Trash2, ChevronLeft, ChevronRight, Wand2, Maximize2, Minimize2, Sun, Moon, Monitor, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { showApiErrorToast } from '@/lib/error-handler'
import api, { formatAssetUrl } from '@/lib/api'
import { MessageRenderer } from '@/components/chat/message-renderer'
import { MessageActions } from '@/components/chat/message-actions'
import { EmptyState } from '@/components/chat/empty-state'
import { CategorySelector } from '@/components/chat/category-selector'
import { VoiceWaveform } from '@/components/chat/voice-waveform'
import type { ThreadCategory, ChatImage } from '@/types/chat'

export default function ChatPage() {
  const dispatch = useAppDispatch()
  const { threads, activeThreadId, activeThread, sending, streamingContent, selectedSkill, isDraftThread, loading: threadsLoading } = useAppSelector(s => s.chat)
  const channelId = useAppSelector(s => s.auth.activeChannelId)
  const isMobile = useIsMobile()
  const { theme, setTheme, resolvedTheme } = useTheme()
  const searchParams = useSearchParams()
  const urlVideoId = searchParams.get('videoId')
  const urlVideoTitle = searchParams.get('videoTitle')
  const urlThreadId = searchParams.get('threadId')
  const urlNewScriptId = searchParams.get('newScriptId')
  const urlScriptId = searchParams.get('scriptId')
  const [activeScriptContext, setActiveScriptContext] = useState<{ id: string; title: string; wordCount: number; content: string } | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [input, setInput] = useState('')
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [generatingConceptText, setGeneratingConceptText] = useState<string | null>(null)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [isFocusMode, setIsFocusMode] = useState(false)
  const [deleteModalThread, setDeleteModalThread] = useState<{ id: string; title: string } | null>(null)
  const [iteratingImage, setIteratingImage] = useState<{
    url: string
    mode: 'thumbnail' | 'scene'
    cleanUrl?: string
    selectedHostImage?: string
    aspectRatio?: '16:9' | '9:16'
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const initialInputRef = useRef('')

  const cycleTheme = () => {
    const themes: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system']
    const idx = themes.indexOf(theme)
    setTheme(themes[(idx + 1) % themes.length])
  }
  const ThemeIcon = resolvedTheme === 'dark' ? Moon : Sun

  // Keyboard shortcut: Esc exits Focus Mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFocusMode) {
        setIsFocusMode(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isFocusMode])

  // Dynamic textarea height adjustment
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      const newHeight = Math.min(Math.max(textareaRef.current.scrollHeight, 38), 140)
      textareaRef.current.style.height = `${newHeight}px`
    }
  }, [input])

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

  const { frequencies } = useAudioVisualizer({ isActive: isListening, barCount: 8 })

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

  // Auto-select thread from URL params (e.g. from /scripts "Open in Old Chat")
  useEffect(() => {
    if (!urlThreadId || !channelId) return
    handleSelectThread(urlThreadId)
  }, [urlThreadId, channelId])

  // Auto-open script context from URL params
  useEffect(() => {
    const targetScriptId = urlNewScriptId || urlScriptId
    if (!targetScriptId || !channelId) return

    api.getScript(channelId, targetScriptId).then((script) => {
      if (script?.id || script?._id) {
        setActiveScriptContext({
          id: script.id || script._id || '',
          title: script.title,
          wordCount: script.wordCount || 0,
          content: script.content,
        })
        if (urlNewScriptId) {
          dispatch(createThread({
            channelId,
            type: 'general',
            title: `Script: ${script.title.slice(0, 30)}...`,
          })).unwrap().then((newThread) => {
            if (newThread?.id) {
              handleSelectThread(newThread.id)
            }
          })
        }
      }
    }).catch(() => {})
  }, [urlNewScriptId, urlScriptId, channelId, dispatch])

  // Handle 'outline-generate-script' custom event from OutlineCard
  useEffect(() => {
    const handleOutlineGenerateScript = (e: CustomEvent<any>) => {
      const { hook, sections, showType } = e.detail || {}
      let prompt = `Write a complete teleprompter video script based on this outline:\n`
      if (showType) prompt += `Show Type: ${showType}\n`
      if (hook) prompt += `Selected Hook (${hook.name || ''}): ${hook.script || ''}\n`
      if (sections && sections.length > 0) {
        prompt += `\nOutline Sections:\n`
        sections.forEach((sec: any, idx: number) => {
          prompt += `${idx + 1}. ${sec.title || sec.name || ''} (${sec.timing || ''}): ${sec.points?.join(', ') || ''}\n`
        })
      }
      prompt += `\nPlease write the full spoken teleprompter script targeting 9 to 14 minutes.`
      setInput(prompt)
    }

    window.addEventListener('outline-generate-script' as any, handleOutlineGenerateScript)
    return () => {
      window.removeEventListener('outline-generate-script' as any, handleOutlineGenerateScript)
    }
  }, [])

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
    if (!input.trim() && !selectedFile) return

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

    // If no active thread, create real thread first
    let threadId = activeThreadId
    if (!threadId) {
      if (!channelId) {
        toast.error('Please select a channel first')
        return
      }
      try {
        const threadTitle = activeScriptContext?.title ? `Script: ${activeScriptContext.title.slice(0, 45)}` : undefined
        const newThread = await dispatch(createThread({ channelId, title: threadTitle, type: 'standalone' })).unwrap()
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
          const uploaded = await api.uploadReferenceAsset(threadId, fileToSend)
          const refUrl = uploaded?.url
          if (refUrl) referenceUrls.push(refUrl)
        }
        // Check if prompt triggers aspect ratio switch or inherit from pinnedImage
        let targetAspectRatio = pinnedImage.aspectRatio
        if (/\b(?:reel|reels|short|shorts|tiktok|9:16|vertical)\b/i.test(messageContent)) {
          targetAspectRatio = '9:16'
        } else if (/\b(?:16:9|landscape|horizontal)\b/i.test(messageContent)) {
          targetAspectRatio = '16:9'
        }

        await api.editImage(threadId, {
          prompt: messageContent,
          baseImageUrl: pinnedImage.cleanUrl || pinnedImage.url,
          referenceImageUrls: referenceUrls,
          mode: pinnedImage.mode || (currentSkill === 'thumbnail' ? 'thumbnail' : 'scene'),
          selectedHostImage: pinnedImage.selectedHostImage,
          aspectRatio: targetAspectRatio,
        })
        dispatch(clearStreaming())
        dispatch(selectThread(threadId))
        if (channelId) dispatch(fetchThreads(channelId))
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
        dispatch(clearStreaming())
        dispatch(selectThread(threadId))
        if (channelId) dispatch(fetchThreads(channelId))
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
        if (channelId) dispatch(fetchThreads(channelId))
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

    // Inject active script context if chatting in a new/empty thread
    let streamPrompt = messageContent
    if (activeScriptContext && (!activeThread || !activeThread.messages || activeThread.messages.length === 0)) {
      streamPrompt = `[ACTIVE SCRIPT CONTEXT: "${activeScriptContext.title}"]\n${activeScriptContext.content}\n\n[USER REQUEST]\n${messageContent}`
    }

    // Capture threadId to guard against thread switches during stream
    const streamThreadId = threadId
    let fullContent = ''
    let streamCompleted = false
    try {
      await api.sendMessageStream(
        threadId,
        streamPrompt,
        selectedSkill || undefined,
        (chunk) => { fullContent += chunk; dispatch(appendStreamChunk(chunk)) },
        (messageId, usage, updatedTitle, streamCategory) => {
          streamCompleted = true
          dispatch(finalizeStreamedMessage({ content: fullContent, messageId, category: streamCategory || currentSkill, title: updatedTitle }))
          if (channelId) {
            dispatch(fetchThreads(channelId))
          }
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
      toast.dismiss(toastId)
      showApiErrorToast(err, 'Failed to upload thumbnail to YouTube')
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

  const handleCancelVoice = () => {
    stopListening()
    resetTranscript()
    setInput(initialInputRef.current)
  }

  const handleDoneVoice = () => {
    stopListening()
    resetTranscript()
    initialInputRef.current = input
  }

  const handleDoneAndSendVoice = () => {
    stopListening()
    resetTranscript()
    initialInputRef.current = ''
    handleSend()
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
    <div className={cn(
      "flex overflow-hidden transition-all duration-150",
      isFocusMode
        ? "fixed inset-0 z-50 bg-gray-50 dark:bg-gray-950 h-screen w-screen"
        : "h-screen max-w-[1600px] mx-auto"
    )}>
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
        {/* Unified Streamlined Header */}
        <div className="px-3.5 py-1.5 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shrink-0 flex items-center justify-between min-h-[44px]">
          <div className="flex items-center gap-2.5 min-w-0">
            {isMobile && (
              <button onClick={() => dispatch(toggleMobileSidebar())} className="lg:hidden text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1">
                <Menu className="w-4 h-4" />
              </button>
            )}
            {isMobile && (
              <Button variant="outline" size="sm" onClick={() => setDrawerOpen(true)} className="h-7 px-2 text-xs gap-1">
                <Lightbulb className="w-3 h-3 text-amber-500" />
                <span className="truncate max-w-[110px]">{activeThread?.title || 'Threads'}</span>
              </Button>
            )}
            <div className="flex items-center gap-2 min-w-0">
              <div className="hidden sm:flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500 shrink-0">
                <span>UMA</span>
                <span>/</span>
                <span className="font-medium text-gray-600 dark:text-gray-400">AI Chat</span>
                <span>/</span>
              </div>
              {isRenaming && activeThreadId ? (
                <div className="flex items-center gap-1">
                  <Input value={renameValue} onChange={e => setRenameValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setIsRenaming(false) }} className="h-6 text-xs font-semibold px-2 py-0" autoFocus />
                  <button onClick={handleRename} className="text-green-500 p-0.5"><Check className="w-3.5 h-3.5" /></button>
                  <button onClick={() => setIsRenaming(false)} className="text-gray-400 p-0.5"><X className="w-3.5 h-3.5" /></button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 min-w-0">
                  <h3 className="text-xs sm:text-sm font-semibold text-gray-900 dark:text-white font-heading truncate max-w-[200px] sm:max-w-[320px] md:max-w-[450px]">
                    {activeThread?.title || 'Select a thread'}
                  </h3>
                  {activeThread && (
                    <button onClick={() => { setRenameValue(activeThread.title); setIsRenaming(true) }} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-0.5" title="Rename thread">
                      <Pencil className="w-3 h-3" />
                    </button>
                  )}
                  <span className="hidden md:inline-flex items-center text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-full shrink-0">
                    {activeThread?.messages?.length || 0} msgs
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* Focus / Fullscreen Mode toggle */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsFocusMode(!isFocusMode)}
              className={cn(
                'w-7 h-7 transition',
                isFocusMode ? 'text-indigo-600 bg-indigo-50 dark:bg-indigo-500/20' : 'text-gray-400 hover:text-indigo-500'
              )}
              title={isFocusMode ? 'Exit Fullscreen Focus Mode (Esc)' : 'Enter Fullscreen Focus Mode'}
            >
              {isFocusMode ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </Button>

            {/* Gallery Toggle */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setGalleryOpen(!galleryOpen)}
              className={cn('w-7 h-7', galleryOpen ? 'text-indigo-500 bg-indigo-50 dark:bg-indigo-500/10' : 'text-gray-400 hover:text-indigo-500')}
              title="Toggle Generated Images Gallery"
            >
              <Grid3X3 className="w-3.5 h-3.5" />
            </Button>

            {/* Theme Toggle */}
            <Button
              variant="ghost"
              size="icon"
              onClick={cycleTheme}
              className="w-7 h-7 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              title="Toggle Theme"
            >
              <ThemeIcon className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 lg:p-5">
            {/* Script Context Banner */}
            {activeScriptContext && (
              <div className="max-w-4xl mx-auto mb-4 px-4 py-2.5 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-center justify-between text-xs text-amber-700 dark:text-amber-300 shadow-sm animate-in fade-in slide-in-from-top-1">
                <div className="flex items-center space-x-2 truncate">
                  <span className="p-1 rounded-md bg-amber-500 text-black font-bold text-[10px]">SCRIPT CONTEXT</span>
                  <span className="font-bold truncate">{activeScriptContext.title}</span>
                  <span className="text-zinc-500">({activeScriptContext.wordCount} words)</span>
                </div>
                <button
                  onClick={() => setActiveScriptContext(null)}
                  className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded"
                  title="Dismiss Script Context"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Empty State */}
            {!hasMessages && !sending && activeThread && (
              <EmptyState category={currentSkill} onSuggestionClick={handleSuggestionClick} />
            )}

            {hasMessages && activeThread && (
              <div className="max-w-4xl 2xl:max-w-5xl mx-auto space-y-4">
                {activeThread.messages.map((msg) => (
                  <div key={msg.id} className={cn('flex items-start gap-2.5 group', msg.role === 'user' ? 'justify-end' : '')}>
                    {msg.role === 'assistant' && (
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400 to-indigo-600 flex items-center justify-center shrink-0 shadow-sm">
                        <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                      </div>
                    )}
                    <div className={cn(
                      'rounded-2xl px-4 py-3 shadow-sm',
                      msg.role === 'user'
                        ? 'bg-indigo-500 text-white rounded-tr-md max-w-2xl'
                        : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-tl-md w-full max-w-4xl 2xl:max-w-5xl'
                    )}>
                      {msg.role === 'user' ? (
                        <p className="text-sm text-white whitespace-pre-wrap">{typeof msg.content === 'string' ? msg.content : ''}</p>
                      ) : (
                        <>
                          <MessageRenderer
                            content={msg.content}
                            category={msg.metadata?.category || 'general'}
                            messageId={msg.id || msg._id}
                            threadId={activeThread?.id}
                            initialScriptId={msg.metadata?.scriptId}
                            messageImages={msg.metadata?.images}
                            onStartGenerate={(title) => {
                              setGalleryOpen(true)
                              setGeneratingConceptText(title)
                            }}
                            onFinishGenerate={() => setGeneratingConceptText(null)}
                            onEditImage={(url, mode, cleanUrl, hostImg, aspectRatio) => setIteratingImage({ url, mode, cleanUrl: cleanUrl || url, selectedHostImage: hostImg, aspectRatio })}
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
                          <button
                            onClick={() => setIteratingImage({
                              url: img.url,
                              mode: img.isSceneImage || (img as any).mode === 'scene' ? 'scene' : 'thumbnail',
                              cleanUrl: (img as any).cleanBackgroundUrl || img.url,
                              selectedHostImage: (img as any).selectedHostImage,
                            })}
                            className="flex-1 bg-violet-600/10 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 hover:bg-violet-600/20 border border-violet-300 dark:border-violet-500/30 text-[10px] font-semibold py-1.5 rounded-md transition flex items-center justify-center gap-1"
                          >
                            <Wand2 className="w-3 h-3" /> Edit
                          </button>
                          {activeThread?.videoId && (
                            <button onClick={() => handleSetThumbnail(img)} className="flex-1 bg-indigo-500 text-white text-[10px] font-semibold py-1.5 rounded-md hover:bg-indigo-600 transition flex items-center justify-center gap-1">
                              <Star className="w-3 h-3" /> Set
                            </button>
                          )}
                          <button onClick={() => handleDownload(img)} className="bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-[10px] font-semibold px-2 py-1.5 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 transition flex items-center justify-center gap-1">
                            <Download className="w-3 h-3" />
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
        <div className="px-4 py-2 bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800 shrink-0">
          <div className="max-w-4xl mx-auto space-y-2">
            {/* Quick Action Prompt Chips for Active Script */}
            {activeScriptContext && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
                {[
                  { label: '⚡ Improve Hook', prompt: `Improve the cold open hook (0:00 - 0:45) for the script "${activeScriptContext.title}" to maximize psychological curiosity and retention.`, skill: 'script' as const },
                  { label: '✂️ Shorten to 8 Min', prompt: `Shorten the script "${activeScriptContext.title}" down to an 8-minute read while keeping the most impactful beats, facts, and jewels.`, skill: 'script' as const },
                  { label: '🔄 Rewrite with More Tension', prompt: `Rewrite section 3 of "${activeScriptContext.title}" with more street code tension and prison psychology insights.`, skill: 'script' as const },
                  { label: '⚖️ Legal Fact-Check', prompt: `Perform a legal reality and fact-checking audit on the script "${activeScriptContext.title}".`, skill: 'general' as const },
                  { label: '🔍 10-Part SEO Package', prompt: `Generate a 10-part SEO package (Viral Titles, Thumbnail Concepts, High-CPM Keywords, YouTube Description) for "${activeScriptContext.title}".`, skill: 'seo' as const },
                  { label: '🎨 3 Thumbnail Concepts', prompt: `Generate 3 high-CTR 16:9 thumbnail concepts with bold visual hooks for "${activeScriptContext.title}".`, skill: 'thumbnail' as const },
                  { label: '📱 3 Viral Shorts', prompt: `Extract 3 viral 45-60s Shorts concepts from "${activeScriptContext.title}" with visual hooks and captions.`, skill: 'script' as const },
                ].map((chip, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setInput(chip.prompt)
                      if (chip.skill) {
                        dispatch(setSelectedSkill(chip.skill))
                      }
                    }}
                    className="px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30 whitespace-nowrap text-[11px] font-semibold transition active:scale-95 shrink-0 shadow-xs"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            )}

            {/* Unified Floating Card Input */}
            <div className={cn(
              'border rounded-2xl p-2.5 shadow-md transition-all space-y-1.5',
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

              {/* Iterating Image Preview Banner with Quick Action Chips */}
              {iteratingImage && (
                <div className="flex flex-col gap-2 p-2.5 bg-pink-50/70 dark:bg-pink-500/10 rounded-xl border border-pink-200 dark:border-pink-500/30">
                  <div className="flex items-center gap-2">
                    <img
                      src={formatAssetUrl(iteratingImage.url)}
                      alt="Editing"
                      className={`object-cover rounded border border-pink-300 dark:border-pink-500/40 shrink-0 ${
                        iteratingImage.aspectRatio === '9:16' ? 'w-8 h-14' : 'w-16 h-9'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-[10px] font-semibold text-pink-700 dark:text-pink-300">Editing Image</p>
                        <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-pink-500/20 text-pink-700 dark:text-pink-300">
                          {iteratingImage.aspectRatio || '16:9'}
                        </span>
                      </div>
                      <p className="text-[9px] text-pink-500 truncate">Describe changes or click quick chips below</p>
                    </div>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="p-1 text-gray-400 hover:text-pink-500 dark:hover:text-pink-400 rounded transition"
                      title="Upload reference photo"
                    >
                      <Paperclip className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setIteratingImage(null)} className="text-gray-400 hover:text-red-500 p-0.5">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Quick Action Chips */}
                  <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-pink-200/50 dark:border-pink-500/20 text-[10px]">
                    <button
                      type="button"
                      onClick={() => setInput((prev) => (prev ? `${prev}, remove the logo` : 'Remove the logo'))}
                      className="px-2 py-0.5 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-pink-200 dark:border-pink-500/30 hover:bg-pink-100 dark:hover:bg-pink-500/20 transition"
                    >
                      🚫 Remove Logo
                    </button>
                    <button
                      type="button"
                      onClick={() => setInput((prev) => (prev ? `${prev}, remove me / no host` : 'Remove me / no host'))}
                      className="px-2 py-0.5 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-pink-200 dark:border-pink-500/30 hover:bg-pink-100 dark:hover:bg-pink-500/20 transition"
                    >
                      👤 Remove Host / Me
                    </button>
                    <button
                      type="button"
                      onClick={() => setIteratingImage((prev) => prev ? { ...prev, aspectRatio: prev.aspectRatio === '9:16' ? '16:9' : '9:16' } : null)}
                      className="px-2 py-0.5 rounded-md bg-pink-100 dark:bg-pink-500/20 text-pink-700 dark:text-pink-300 border border-pink-300 dark:border-pink-500/40 hover:bg-pink-200 transition font-medium"
                    >
                      📐 Switch to {iteratingImage.aspectRatio === '9:16' ? '16:9 Video' : '9:16 Reel'}
                    </button>
                  </div>
                </div>
              )}

              {/* Input or Voice Dictation Studio Bar */}
              {isListening ? (
                <div className="p-3 bg-gradient-to-r from-indigo-50/80 via-purple-50/50 to-indigo-50/80 dark:from-indigo-950/40 dark:via-purple-950/30 dark:to-indigo-950/40 rounded-xl border border-indigo-200/80 dark:border-indigo-800/80 space-y-2.5 animate-in fade-in zoom-in-95 duration-200 shadow-sm">
                  {/* Top Header Status */}
                  <div className="flex items-center justify-between pb-1 border-b border-indigo-200/50 dark:border-indigo-800/50">
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                      </span>
                      <span className="text-xs font-semibold text-indigo-900 dark:text-indigo-200">
                        Voice Dictation Active
                      </span>
                    </div>
                    <span className="text-[11px] text-gray-400">
                      Listening in real-time...
                    </span>
                  </div>

                  {/* Live Spoken Transcript */}
                  <div className="min-h-[44px] max-h-[120px] overflow-y-auto px-2.5 py-1.5 text-xs text-gray-800 dark:text-gray-200 leading-relaxed font-normal bg-white/70 dark:bg-gray-900/70 rounded-lg border border-indigo-100 dark:border-indigo-900/40">
                    {input ? (
                      <span>
                        {input}
                        <span className="inline-block w-1.5 h-3.5 bg-indigo-600 dark:bg-indigo-400 ml-1 translate-y-0.5 animate-pulse" />
                      </span>
                    ) : (
                      <span className="text-gray-400 italic">
                        Speak now... your speech is transcribed here in real-time
                      </span>
                    )}
                  </div>

                  {/* Frequency Waveform & Action Controls */}
                  <div className="flex items-center justify-between pt-0.5">
                    <button
                      type="button"
                      onClick={handleCancelVoice}
                      className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition flex items-center gap-1 cursor-pointer"
                      title="Cancel and discard voice input"
                    >
                      <X className="w-3.5 h-3.5" />
                      Cancel
                    </button>

                    {/* 8 Dynamic Animated Frequency Wave Bars */}
                    <div className="flex items-center bg-indigo-500/10 dark:bg-indigo-500/20 px-3 py-0.5 rounded-full border border-indigo-500/20 shadow-xs">
                      <VoiceWaveform frequencies={frequencies} isActive={isListening} />
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleDoneVoice}
                        className="px-2.5 py-1.5 rounded-lg border border-indigo-200 dark:border-indigo-800 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 transition flex items-center gap-1 cursor-pointer"
                        title="Keep transcribed text in textarea"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Done
                      </button>

                      <Button
                        type="button"
                        onClick={handleDoneAndSendVoice}
                        disabled={!input.trim()}
                        size="sm"
                        className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-semibold flex items-center gap-1 shadow-sm shadow-indigo-600/25 transition cursor-pointer disabled:opacity-50"
                        title="Send transcribed message"
                      >
                        <Send className="w-3.5 h-3.5" />
                        Send
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {/* Textarea */}
                  <textarea
                    ref={textareaRef}
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
                    rows={1}
                    className="w-full bg-transparent border-0 px-1 py-0.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-0 resize-none font-normal leading-relaxed min-h-[38px] max-h-[140px]"
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
                </>
              )}
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
