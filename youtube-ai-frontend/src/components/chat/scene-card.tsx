'use client'

import { useState, useEffect } from 'react'
import { Film, Palette, Sparkles, Loader2, Download, Wand2, X } from 'lucide-react'
import type { SceneConcept } from '@/lib/content-detector'
import api, { formatAssetUrl } from '@/lib/api'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { selectThread } from '@/store/slices/chat-slice'
import { toast } from 'sonner'

interface SceneCardProps {
  concepts: SceneConcept[]
  messageId?: string
  messageImages?: Array<{
    id: string
    url: string
    conceptTitle?: string
    textOverlay?: string
    isSceneImage?: boolean
  }>
  onStartGenerate?: (conceptTitle: string) => void
  onFinishGenerate?: () => void
  onEditImage?: (url: string) => void
  videoTitle?: string
  threadTitle?: string
}

function parseColorScheme(colors: string): string[] {
  return colors.split(/[,;]+/).map(c => c.trim()).filter(Boolean).slice(0, 4)
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

export function SceneCard({
  concepts,
  messageId,
  messageImages,
  onStartGenerate,
  onFinishGenerate,
  onEditImage,
  videoTitle,
  threadTitle,
}: SceneCardProps) {
  const dispatch = useAppDispatch()
  const activeThreadId = useAppSelector((state) => state.chat.activeThreadId)
  const activeThread = useAppSelector((state) => state.chat.threads.find((t) => t.id === activeThreadId))
  const [generatingIdx, setGeneratingIdx] = useState<number | null>(null)
  const [generatedImages, setGeneratedImages] = useState<Record<number, string>>({})
  const [logoPosition, setLogoPosition] = useState<'top-right' | 'none'>('top-right')

  useEffect(() => {
    if (messageImages && concepts) {
      const restored: Record<number, string> = {}
      for (const img of messageImages) {
        if (img.isSceneImage && img.url) {
          const idx = concepts.findIndex((c, i) =>
            img.conceptTitle === `Scene ${i + 1}`
          )
          if (idx !== -1) {
            restored[idx] = img.url
          }
        }
      }
      setGeneratedImages(restored)
    }
  }, [messageImages, concepts])

  if (!concepts || concepts.length === 0) return null

  const handleGenerateScene = async (concept: SceneConcept, idx: number) => {
    if (!activeThreadId) {
      toast.error('No active chat thread found')
      return
    }

    const conceptTitle = `Scene ${idx + 1}`

    try {
      setGeneratingIdx(idx)
      onStartGenerate?.(conceptTitle)
      toast.info(`Generating scene image for ${conceptTitle}...`)

      const result = await api.generateSceneImage(activeThreadId, {
        scene: concept.scene,
        style: concept.style,
        colors: concept.colors,
        textOverlay: concept.textOverlay,
        videoTitle: activeThread?.title && activeThread.title !== 'New Thread' ? activeThread.title : undefined,
        logoPosition,
        messageId,
      })

      if (result.imageUrl) {
        setGeneratedImages((prev) => ({ ...prev, [idx]: result.imageUrl }))
        await dispatch(selectThread(activeThreadId)).unwrap()
        toast.success(`Scene ${conceptTitle} generated!`)
      } else {
        toast.error('Failed to retrieve generated image')
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to generate scene image')
    } finally {
      setGeneratingIdx(null)
      onFinishGenerate?.()
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <Film className="w-4 h-4 text-pink-500" />
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          Scene Concepts
        </span>
      </div>

      {/* Context Anchor */}
      <div className="flex items-center gap-2 text-[10px] text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800/50 rounded-lg px-3 py-2 mb-1">
        <span>Target Subject: {videoTitle || 'Not set'}</span>
        <span>&middot;</span>
        <span>Video Context: {threadTitle || 'General'}</span>
      </div>

      <div className="grid gap-3">
        {concepts.map((concept, idx) => {
          const colors = parseColorScheme(concept.colors)
          const generatedUrl = generatedImages[idx]
          const isGenerating = generatingIdx === idx

          return (
            <div
              key={idx}
              className="bg-pink-50 dark:bg-pink-500/10 border border-pink-200 dark:border-pink-500/20 rounded-xl p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-pink-500 text-white text-xs font-bold flex items-center justify-center">
                    {idx + 1}
                  </span>
                  <span className="text-xs font-semibold text-pink-700 dark:text-pink-300">
                    Scene {idx + 1}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    {(['top-right', 'none'] as const).map((pos) => (
                      <button
                        key={pos}
                        onClick={() => setLogoPosition(pos)}
                        className={`px-2 py-1 rounded text-[10px] font-medium transition ${
                          logoPosition === pos
                            ? 'bg-pink-500 text-white'
                            : 'bg-pink-100 dark:bg-pink-500/20 text-pink-600 dark:text-pink-400 hover:bg-pink-200'
                        }`}
                      >
                        {pos === 'top-right' ? 'Logo' : 'No Logo'}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={() => handleGenerateScene(concept, idx)}
                    disabled={isGenerating}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pink-600 hover:bg-pink-700 disabled:bg-pink-400 text-white text-xs font-medium transition shadow-sm"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Generating...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                        <span>{generatedUrl ? 'Re-generate' : 'Generate'}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {generatedUrl && (
                <div className="mt-3 space-y-2">
                  <div className="relative rounded-lg overflow-hidden border border-pink-300 dark:border-pink-600/40 bg-black aspect-video">
                    <img
                      src={formatAssetUrl(generatedUrl)}
                      alt={`Generated scene ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => onEditImage?.(generatedUrl)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 text-xs font-medium transition"
                    >
                      <Wand2 className="w-3.5 h-3.5" /> Edit / Iterate
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="text-[10px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider">Scene</label>
                <p className="text-xs text-gray-700 dark:text-gray-300 mt-1 leading-relaxed">{concept.scene}</p>
              </div>

              <div>
                <label className="text-[10px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider">Style</label>
                <p className="text-xs text-gray-700 dark:text-gray-300 mt-1 leading-relaxed">{concept.style}</p>
              </div>

              {colors.length > 0 && (
                <div>
                  <label className="text-[10px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider flex items-center gap-1">
                    <Palette className="w-3 h-3" />
                    Colors
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

              {concept.textOverlay && (
                <div>
                  <label className="text-[10px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider">Text Overlay</label>
                  <div className="mt-1 bg-gray-900 rounded-lg p-2 flex items-center justify-center">
                    <span className="text-white font-black text-sm tracking-wide uppercase text-center leading-tight">
                      {concept.textOverlay}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
