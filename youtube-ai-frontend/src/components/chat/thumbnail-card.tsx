'use client'

import { useState, useEffect } from 'react'
import { Image, Palette, Sparkles, Loader2, ExternalLink, Wand2, Monitor, Smartphone } from 'lucide-react'
import type { ThumbnailConcept } from '@/lib/content-detector'
import api, { formatAssetUrl } from '@/lib/api'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { selectThread } from '@/store/slices/chat-slice'
import { toast } from 'sonner'
import { ThumbnailCustomizerModal } from './thumbnail-customizer-modal'

interface ThumbnailCardProps {
  thumbnails: ThumbnailConcept[]
  messageId?: string
  messageImages?: Array<{
    id: string
    url: string
    cleanBackgroundUrl?: string
    conceptTitle?: string
    textOverlay?: string
    selectedHostImage?: string
    logoPosition?: 'top-left' | 'top-right' | 'none'
    aspectRatio?: '16:9' | '9:16'
  }>
  onStartGenerate?: (conceptTitle: string) => void
  onFinishGenerate?: () => void
  onEditImage?: (url: string, cleanBackgroundUrl?: string, selectedHostImage?: string, aspectRatio?: '16:9' | '9:16') => void
  videoTitle?: string
  threadTitle?: string
}

function parseColorScheme(colors: string): string[] {
  const colorWords = colors.split(/[,;]+/).map(c => c.trim()).filter(Boolean)
  return colorWords.slice(0, 4)
}

function getColorClass(color: string): string {
  const lower = color.toLowerCase()
  if (lower.includes('gold') || lower.includes('yellow') || lower.includes('amber')) return 'bg-amber-500/20 text-amber-300 border-amber-500/30'
  if (lower.includes('blue') || lower.includes('navy') || lower.includes('cobalt')) return 'bg-blue-500/20 text-blue-300 border-blue-500/30'
  if (lower.includes('red') || lower.includes('crimson') || lower.includes('scarlet')) return 'bg-red-500/20 text-red-300 border-red-500/30'
  if (lower.includes('green') || lower.includes('emerald')) return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
  if (lower.includes('purple') || lower.includes('violet')) return 'bg-purple-500/20 text-purple-300 border-purple-500/30'
  if (lower.includes('orange')) return 'bg-orange-500/20 text-orange-300 border-orange-500/30'
  if (lower.includes('black') || lower.includes('dark')) return 'bg-gray-800 text-gray-300 border-gray-700'
  if (lower.includes('white') || lower.includes('light')) return 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 border-gray-300 dark:border-gray-700'
  return 'bg-violet-500/20 text-violet-300 border-violet-500/30'
}

export function ThumbnailCard({
  thumbnails,
  messageId,
  messageImages,
  onStartGenerate,
  onFinishGenerate,
  onEditImage,
  videoTitle,
  threadTitle,
}: ThumbnailCardProps) {
  const dispatch = useAppDispatch()
  const activeThreadId = useAppSelector((s) => s.chat.activeThreadId)
  const activeThread = useAppSelector((s) => s.chat.activeThread)
  const [generatingIdx, setGeneratingIdx] = useState<number | null>(null)
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<'16:9' | '9:16'>('16:9')
  const [generatedImages, setGeneratedImages] = useState<
    Record<number, { url: string; cleanBackgroundUrl?: string; selectedHostImage?: string; aspectRatio?: '16:9' | '9:16' }>
  >({})
  const [modalState, setModalState] = useState<{ isOpen: boolean; concept: ThumbnailConcept | null; idx: number }>({
    isOpen: false,
    concept: null,
    idx: 0,
  })

  // Hydrate generated images strictly from this message's metadata images
  useEffect(() => {
    if (messageImages && thumbnails) {
      const restored: Record<number, { url: string; cleanBackgroundUrl?: string; selectedHostImage?: string; aspectRatio?: '16:9' | '9:16' }> = {}
      for (const img of messageImages) {
        const idx = thumbnails.findIndex(
          (c, i) =>
            (img.textOverlay && img.textOverlay.toLowerCase() === c.text.toLowerCase()) ||
            img.conceptTitle === `Concept ${i + 1}`,
        )
        if (idx !== -1 && img.url) {
          restored[idx] = {
            url: img.url,
            cleanBackgroundUrl: img.cleanBackgroundUrl,
            selectedHostImage: img.selectedHostImage,
            aspectRatio: img.aspectRatio || '16:9',
          }
        }
      }
      setGeneratedImages(restored)
    }
  }, [messageImages, thumbnails])

  if (!thumbnails || thumbnails.length === 0) return null

  const handleGenerateImage = async (
    concept: ThumbnailConcept,
    idx: number,
    options?: {
      selectedHostImage?: string
      logoPosition?: 'top-left' | 'top-right' | 'none'
      customText?: string
      aspectRatio?: '16:9' | '9:16'
    },
  ) => {
    if (!activeThreadId) {
      toast.error('No active chat thread found')
      return
    }

    const conceptTitle = `Concept ${idx + 1}`
    const targetAspectRatio = options?.aspectRatio || selectedAspectRatio
    const hostImg = options?.selectedHostImage === 'none' ? 'none' : (options?.selectedHostImage || 'default')
    const excludeHost = hostImg === 'none'

    try {
      setGeneratingIdx(idx)
      onStartGenerate?.(conceptTitle)
      toast.info(`Generating ${targetAspectRatio} thumbnail for ${conceptTitle}...`)

      const result = await api.generateThumbnailImage(activeThreadId, {
        text: options?.customText || concept.text,
        visual: concept.visual,
        colors: concept.colors,
        conceptTitle,
        videoTitle: videoTitle || (activeThread?.title && activeThread.title !== 'New Thread' ? activeThread.title : undefined),
        selectedHostImage: hostImg,
        logoPosition: options?.logoPosition || 'top-right',
        aspectRatio: targetAspectRatio,
        excludeHost,
        messageId,
      })

      if (result.imageUrl) {
        setGeneratedImages((prev) => ({
          ...prev,
          [idx]: {
            url: result.imageUrl,
            cleanBackgroundUrl: (result as any).cleanBackgroundUrl,
            selectedHostImage: hostImg,
            aspectRatio: targetAspectRatio,
          },
        }))
        await dispatch(selectThread(activeThreadId)).unwrap()
        toast.success(`Pristine Thumbnail ${conceptTitle} generated!`)
      } else {
        toast.error('Failed to retrieve generated image URL')
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to generate thumbnail image')
    } finally {
      setGeneratingIdx(null)
      onFinishGenerate?.()
    }
  }

  return (
    <div className="space-y-3">
      {/* Header & Aspect Ratio Selector */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Image className="w-4 h-4 text-violet-500" />
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Thumbnail Concepts
          </span>
          {videoTitle && (
            <span
              className="text-[11px] font-medium text-violet-600 dark:text-violet-400 bg-violet-500/10 dark:bg-violet-500/20 px-2 py-0.5 rounded-full truncate max-w-[260px]"
              title={videoTitle}
            >
              {videoTitle}
            </span>
          )}
        </div>

        <div className="flex items-center bg-gray-200 dark:bg-gray-800 p-0.5 rounded-lg border border-gray-300 dark:border-gray-700">
          <button
            type="button"
            onClick={() => setSelectedAspectRatio('16:9')}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition ${
              selectedAspectRatio === '16:9'
                ? 'bg-white dark:bg-gray-700 text-violet-600 dark:text-violet-300 shadow-sm'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <Monitor className="w-3 h-3" />
            16:9 Video
          </button>
          <button
            type="button"
            onClick={() => setSelectedAspectRatio('9:16')}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition ${
              selectedAspectRatio === '9:16'
                ? 'bg-white dark:bg-gray-700 text-violet-600 dark:text-violet-300 shadow-sm'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <Smartphone className="w-3 h-3" />
            9:16 Reel
          </button>
        </div>
      </div>

      {/* Context Anchor */}
      <div className="flex items-center gap-2 text-[10px] text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800/50 rounded-lg px-3 py-2 mb-1">
        <span>Target Subject: {videoTitle || 'Not set'}</span>
        <span>&middot;</span>
        <span>Video Context: {threadTitle || 'General'}</span>
      </div>

      <div className="grid gap-3">
        {thumbnails.map((concept, idx) => {
          const colors = parseColorScheme(concept.colors)
          const imgData = generatedImages[idx]
          const generatedUrl = typeof imgData === 'string' ? imgData : imgData?.url
          const cleanUrl = typeof imgData === 'object' ? imgData?.cleanBackgroundUrl : undefined
          const hostImg = typeof imgData === 'object' ? imgData?.selectedHostImage : undefined
          const currentRatio = (imgData as any)?.aspectRatio || selectedAspectRatio
          const isGenerating = generatingIdx === idx

          return (
            <div
              key={idx}
              className="bg-violet-50 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-500/20 rounded-xl p-4 space-y-3"
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-violet-500 text-white text-xs font-bold flex items-center justify-center">
                    {idx + 1}
                  </span>
                  <span className="text-xs font-semibold text-violet-700 dark:text-violet-300">
                    Concept {idx + 1}
                  </span>
                  <span className="text-[10px] text-violet-600 dark:text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded border border-violet-500/20 font-mono">
                    {currentRatio}
                  </span>
                </div>

                {/* Generate Buttons */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setModalState({ isOpen: true, concept, idx })}
                    disabled={isGenerating}
                    className="px-2.5 py-1.5 rounded-lg border border-violet-300 dark:border-violet-600/40 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-500/20 disabled:opacity-50 text-xs font-medium transition"
                  >
                    Select Host & Logo
                  </button>

                  <button
                    onClick={() => handleGenerateImage(concept, idx)}
                    disabled={isGenerating}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:bg-violet-400 text-white text-xs font-medium transition shadow-sm"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Generating...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>1-Click Generate</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Text Overlay */}
              <div>
                <label className="text-[10px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider">Headline Text</label>
                <div className="text-sm font-bold text-gray-900 dark:text-white mt-0.5 tracking-wide uppercase">
                  &ldquo;{concept.text}&rdquo;
                </div>
              </div>

              {/* Generated Image Preview if Available */}
              {generatedUrl && (
                <div className="mt-3 space-y-2">
                  <label className="text-[10px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider flex items-center justify-between">
                    <span>Generated AI Thumbnail Preview ({currentRatio})</span>
                    <a
                      href={formatAssetUrl(generatedUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-violet-500 hover:underline flex items-center gap-1 text-[10px]"
                    >
                      <ExternalLink className="w-3 h-3" /> Full View
                    </a>
                  </label>
                  <div className={`relative rounded-lg overflow-hidden border border-violet-300 dark:border-violet-600/40 bg-black ${
                    currentRatio === '9:16' ? 'aspect-[9/16] max-w-[280px] mx-auto' : 'aspect-video'
                  }`}>
                    <img
                      src={formatAssetUrl(generatedUrl)}
                      alt={`Generated thumbnail concept ${idx + 1}`}
                      className="w-full h-full object-contain"
                    />
                  </div>
                </div>
              )}

              {/* Edit / Iterate button */}
              {generatedUrl && onEditImage && (
                <button
                  onClick={() => onEditImage(generatedUrl, cleanUrl, hostImg, currentRatio)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 text-xs font-medium transition"
                >
                  <Wand2 className="w-3.5 h-3.5" /> Edit / Iterate
                </button>
              )}

              {/* Visual Concept */}
              <div>
                <label className="text-[10px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider">Visual Concept</label>
                <p className="text-xs text-gray-700 dark:text-gray-300 mt-1 leading-relaxed">{concept.visual}</p>
              </div>

              {/* Color Scheme */}
              {colors.length > 0 && (
                <div>
                  <label className="text-[10px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider flex items-center gap-1">
                    <Palette className="w-3 h-3" />
                    Color Scheme
                  </label>
                  <div className="flex items-center gap-2 mt-1.5">
                    {colors.map((color, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <div className={`w-5 h-5 rounded-full ${getColorClass(color)} shadow-sm`} />
                        <span className="text-[10px] text-gray-500 dark:text-gray-400">{color}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {modalState.concept && (
        <ThumbnailCustomizerModal
          isOpen={modalState.isOpen}
          onClose={() => setModalState({ isOpen: false, concept: null, idx: 0 })}
          conceptTitle={`Concept ${modalState.idx + 1}`}
          defaultText={modalState.concept.text}
          visualDescription={modalState.concept.visual}
          colors={modalState.concept.colors}
          initialAspectRatio={selectedAspectRatio}
          initialHostImage={generatedImages[modalState.idx]?.selectedHostImage || 'none'}
          onConfirmGenerate={async (options: {
            selectedHostImage: string
            logoPosition: 'top-left' | 'top-right' | 'none'
            customText: string
            aspectRatio: '16:9' | '9:16'
          }) => {
            if (modalState.concept) {
              await handleGenerateImage(modalState.concept, modalState.idx, options)
            }
          }}
        />
      )}
    </div>
  )
}

