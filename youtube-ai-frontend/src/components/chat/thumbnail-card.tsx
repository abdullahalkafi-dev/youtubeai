'use client'

import { useState, useEffect } from 'react'
import { Image, Palette, Sparkles, Loader2, Download, ExternalLink, Wand2 } from 'lucide-react'
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
    conceptTitle?: string
    textOverlay?: string
    selectedHostImage?: string
    logoPosition?: 'top-left' | 'top-right' | 'none'
  }>
  onStartGenerate?: (conceptTitle: string) => void
  onFinishGenerate?: () => void
  onEditImage?: (url: string) => void
  videoTitle?: string
  threadTitle?: string
}

function parseColorScheme(colors: string): string[] {
  const colorWords = colors.split(/[,;]+/).map(c => c.trim()).filter(Boolean)
  return colorWords.slice(0, 4)
}

function getColorClass(color: string): string {
  const lower = color.toLowerCase()
  if (lower.includes('red') || lower.includes('#ff') || lower.includes('#e')) return 'bg-red-400'
  if (lower.includes('blue') || lower.includes('#00') || lower.includes('#2') || lower.includes('#3')) return 'bg-blue-400'
  if (lower.includes('green') || lower.includes('#0f') || lower.includes('#1')) return 'bg-emerald-400'
  if (lower.includes('yellow') || lower.includes('#ff') || lower.includes('#f')) return 'bg-yellow-400'
  if (lower.includes('purple') || lower.includes('#8') || lower.includes('#9')) return 'bg-violet-400'
  if (lower.includes('orange') || lower.includes('#f9') || lower.includes('#fb')) return 'bg-orange-400'
  if (lower.includes('black') || lower.includes('#000')) return 'bg-gray-900'
  if (lower.includes('white') || lower.includes('#fff')) return 'bg-white border border-gray-200'
  if (lower.includes('gold') || lower.includes('#d4')) return 'bg-amber-400'
  if (lower.includes('dark')) return 'bg-gray-700'
  return 'bg-gray-400'
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
  const activeThreadId = useAppSelector((state) => state.chat.activeThreadId)
  const activeThread = useAppSelector((state) => state.chat.threads.find((t) => t.id === activeThreadId))
  const [generatingIdx, setGeneratingIdx] = useState<number | null>(null)
  const [generatedImages, setGeneratedImages] = useState<Record<number, string>>({})
  const [modalState, setModalState] = useState<{ isOpen: boolean; concept: ThumbnailConcept | null; idx: number }>({
    isOpen: false,
    concept: null,
    idx: 0,
  })

  // Hydrate generated images strictly from this message's metadata images
  useEffect(() => {
    if (messageImages && thumbnails) {
      const restored: Record<number, string> = {}
      for (const img of messageImages) {
        const idx = thumbnails.findIndex(
          (c, i) =>
            (img.textOverlay && img.textOverlay.toLowerCase() === c.text.toLowerCase()) ||
            img.conceptTitle === `Concept ${i + 1}`,
        )
        if (idx !== -1 && img.url) {
          restored[idx] = img.url
        }
      }
      setGeneratedImages(restored)
    }
  }, [messageImages, thumbnails])

  if (!thumbnails || thumbnails.length === 0) return null

  const handleGenerateImage = async (
    concept: ThumbnailConcept,
    idx: number,
    options?: { selectedHostImage?: string; logoPosition?: 'top-left' | 'top-right' | 'none'; customText?: string },
  ) => {
    if (!activeThreadId) {
      toast.error('No active chat thread found')
      return
    }

    const conceptTitle = `Concept ${idx + 1}`

    try {
      setGeneratingIdx(idx)
      onStartGenerate?.(conceptTitle)
      toast.info(`Generating AI thumbnail for ${conceptTitle}...`)

      const result = await api.generateThumbnailImage(activeThreadId, {
        text: options?.customText || concept.text,
        visual: concept.visual,
        colors: concept.colors,
        conceptTitle,
        videoTitle: activeThread?.title && activeThread.title !== 'New Thread' ? activeThread.title : undefined,
        selectedHostImage: options?.selectedHostImage || 'host_1.png',
        logoPosition: options?.logoPosition || 'top-right',
        messageId,
      })

      if (result.imageUrl) {
        setGeneratedImages((prev) => ({ ...prev, [idx]: result.imageUrl }))
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
      <div className="flex items-center gap-2 mb-2">
        <Image className="w-4 h-4 text-violet-500" />
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          Thumbnail Concepts
        </span>
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
          const generatedUrl = generatedImages[idx]
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
                        <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                        <span>{generatedUrl ? 'Re-generate' : '1-Click Generate'}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Text Overlay Preview */}
              <div>
                <label className="text-[10px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider">Text Overlay</label>
                <div className="mt-1 bg-gray-900 rounded-lg p-3 flex items-center justify-center min-h-[48px]">
                  <span className="text-white font-black text-lg tracking-wide uppercase text-center leading-tight">
                    {typeof concept.text === 'string' ? concept.text : ''}
                  </span>
                </div>
              </div>

              {/* Generated Image Preview if Available */}
              {generatedUrl && (
                <div className="mt-3 space-y-2">
                  <label className="text-[10px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider flex items-center justify-between">
                    <span>Generated AI Thumbnail Preview</span>
                    <a
                      href={formatAssetUrl(generatedUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-violet-500 hover:underline flex items-center gap-1 text-[10px]"
                    >
                      <ExternalLink className="w-3 h-3" /> Full View
                    </a>
                  </label>
                  <div className="relative rounded-lg overflow-hidden border border-violet-300 dark:border-violet-600/40 bg-black aspect-video">
                    <img
                      src={formatAssetUrl(generatedUrl)}
                      alt={`Generated thumbnail concept ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              )}

              {/* Edit / Iterate button */}
              {generatedUrl && onEditImage && (
                <button
                  onClick={() => onEditImage(generatedUrl)}
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
          onConfirmGenerate={async (options: any) => {
            if (modalState.concept) {
              await handleGenerateImage(modalState.concept, modalState.idx, options)
            }
          }}
        />
      )}
    </div>
  )
}

