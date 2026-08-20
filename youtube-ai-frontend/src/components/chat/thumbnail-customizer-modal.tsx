'use client'

import { useState, useEffect } from 'react'
import { X, Sparkles, Check, User, ShieldCheck, Type, Loader2 } from 'lucide-react'
import api, { formatAssetUrl } from '@/lib/api'
import { toast } from 'sonner'

interface HostImage {
  id: string
  filename: string
  url: string
  title: string
}

interface LogoAsset {
  id: string
  filename: string
  url: string
  title: string
}

interface ThumbnailCustomizerModalProps {
  isOpen: boolean
  onClose: () => void
  conceptTitle: string
  defaultText: string
  visualDescription: string
  colors: string
  onConfirmGenerate: (options: {
    selectedHostImage: string
    logoPosition: 'top-left' | 'top-right' | 'none'
    customText: string
  }) => Promise<void>
}

export function ThumbnailCustomizerModal({
  isOpen,
  onClose,
  conceptTitle,
  defaultText,
  visualDescription,
  colors,
  onConfirmGenerate,
}: ThumbnailCustomizerModalProps) {
  const [hostImages, setHostImages] = useState<HostImage[]>([])
  const [logoAssets, setLogoAssets] = useState<LogoAsset[]>([])
  const [loadingAssets, setLoadingAssets] = useState(false)
  const [selectedHostImage, setSelectedHostImage] = useState<string>('host_1.png')
  const [logoPosition, setLogoPosition] = useState<'top-left' | 'top-right' | 'none'>('top-right')
  const [textOverlay, setTextOverlay] = useState<string>(defaultText)
  const [isGenerating, setIsGenerating] = useState(false)

  useEffect(() => {
    setTextOverlay(defaultText)
  }, [defaultText])

  useEffect(() => {
    if (isOpen) {
      fetchAssets()
    }
  }, [isOpen])

  const fetchAssets = async () => {
    try {
      setLoadingAssets(true)
      const [images, logos] = await Promise.all([
        api.getUniqueHostImages().catch(() => []),
        api.getLogoAssets().catch(() => []),
      ])

      if (images && images.length > 0) {
        setHostImages(images)
        if (!selectedHostImage) {
          setSelectedHostImage(images[0].filename)
        }
      } else {
        // Complete fallback list of all 7 host images
        setHostImages([
          { id: 'host_1.png', filename: 'host_1.png', url: '/api/assets/unique-images/host_1.png', title: 'Host Photo #1' },
          { id: 'host_2.png', filename: 'host_2.png', url: '/api/assets/unique-images/host_2.png', title: 'Host Photo #2' },
          { id: 'host_3.png', filename: 'host_3.png', url: '/api/assets/unique-images/host_3.png', title: 'Host Photo #3' },
          { id: 'host_4.png', filename: 'host_4.png', url: '/api/assets/unique-images/host_4.png', title: 'Host Photo #4' },
          { id: 'host_5.png', filename: 'host_5.png', url: '/api/assets/unique-images/host_5.png', title: 'Host Photo #5' },
          { id: 'host_6.png', filename: 'host_6.png', url: '/api/assets/unique-images/host_6.png', title: 'Host Photo #6' },
          { id: 'host_7.png', filename: 'host_7.png', url: '/api/assets/unique-images/host_7.png', title: 'Host Photo #7' },
        ])
      }

      if (logos && logos.length > 0) {
        setLogoAssets(logos)
      }
    } catch {
      setHostImages([
        { id: 'host_1.png', filename: 'host_1.png', url: '/api/assets/unique-images/host_1.png', title: 'Host Photo #1' },
        { id: 'host_2.png', filename: 'host_2.png', url: '/api/assets/unique-images/host_2.png', title: 'Host Photo #2' },
        { id: 'host_3.png', filename: 'host_3.png', url: '/api/assets/unique-images/host_3.png', title: 'Host Photo #3' },
        { id: 'host_4.png', filename: 'host_4.png', url: '/api/assets/unique-images/host_4.png', title: 'Host Photo #4' },
        { id: 'host_5.png', filename: 'host_5.png', url: '/api/assets/unique-images/host_5.png', title: 'Host Photo #5' },
        { id: 'host_6.png', filename: 'host_6.png', url: '/api/assets/unique-images/host_6.png', title: 'Host Photo #6' },
        { id: 'host_7.png', filename: 'host_7.png', url: '/api/assets/unique-images/host_7.png', title: 'Host Photo #7' },
      ])
    } finally {
      setLoadingAssets(false)
    }
  }

  const handleConfirm = async () => {
    try {
      setIsGenerating(true)
      await onConfirmGenerate({
        selectedHostImage,
        logoPosition,
        customText: textOverlay,
      })
      onClose()
    } catch (err: any) {
      const errMsg = err?.response?.data?.message || err.message || 'Failed to generate pristine thumbnail'
      toast.error(`Generation Failed: ${errMsg}`)
    } finally {
      setIsGenerating(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-gray-900 border border-violet-500/30 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/80">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-violet-500/20 text-violet-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Customize Thumbnail — <span className="text-violet-400">{conceptTitle}</span>
              </h3>
              <p className="text-xs text-gray-400">Choose exact host face photo and brand logo placement</p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={isGenerating}
            className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-left">
          {/* Step 1: Select Unique Host Image */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-bold text-gray-200 uppercase tracking-wider flex items-center gap-2">
                <User className="w-4 h-4 text-violet-400" />
                1. Select Host Face Image
              </label>
              <span className="text-[10px] text-violet-400 font-medium bg-violet-500/10 px-2 py-0.5 rounded border border-violet-500/20">
                100% Untouched Face
              </span>
            </div>

            {loadingAssets ? (
              <div className="flex items-center justify-center py-8 text-gray-400 text-xs gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-violet-500" />
                <span>Loading unique host images...</span>
              </div>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                {hostImages.map((img) => {
                  const isSelected = selectedHostImage === img.filename
                  return (
                    <button
                      key={img.filename}
                      type="button"
                      onClick={() => setSelectedHostImage(img.filename)}
                      className={`relative aspect-square rounded-xl overflow-hidden border-2 transition group ${
                        isSelected
                          ? 'border-violet-500 ring-2 ring-violet-500/40 shadow-lg shadow-violet-500/20 scale-105'
                          : 'border-gray-800 hover:border-gray-600 opacity-70 hover:opacity-100'
                      }`}
                    >
                      <img
                        src={formatAssetUrl(img.url)}
                        alt={img.title}
                        className="w-full h-full object-cover"
                      />
                      {isSelected && (
                        <div className="absolute inset-0 bg-violet-600/30 flex items-center justify-center">
                          <div className="w-6 h-6 rounded-full bg-violet-500 text-white flex items-center justify-center shadow-md">
                            <Check className="w-4 h-4" />
                          </div>
                        </div>
                      )}
                      <div className="absolute bottom-0 inset-x-0 bg-black/70 py-0.5 text-[9px] text-center text-white truncate px-1 font-medium">
                        {img.filename.replace('.png', '')}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Step 2: Brand Logo Position */}
          <div>
            <label className="text-xs font-bold text-gray-200 uppercase tracking-wider flex items-center gap-2 mb-3">
              <ShieldCheck className="w-4 h-4 text-amber-400" />
              2. Brand Logo Position (MAE Logo)
            </label>

            <div className="grid grid-cols-3 gap-3">
              {[
                { id: 'top-right', label: 'Top-Right (Default)', desc: 'Official placement' },
                { id: 'top-left', label: 'Top-Left', desc: 'Alternate placement' },
                { id: 'none', label: 'No Logo', desc: 'Omit brand logo' },
              ].map((opt) => {
                const isSelected = logoPosition === opt.id
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setLogoPosition(opt.id as any)}
                    className={`p-3 rounded-xl border text-left transition flex items-center justify-between ${
                      isSelected
                        ? 'bg-amber-500/10 border-amber-500/60 text-white shadow-md'
                        : 'bg-gray-800/50 border-gray-800 text-gray-400 hover:border-gray-700 hover:text-gray-200'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-semibold text-white">{opt.label}</div>
                      <div className="text-[10px] text-gray-400">{opt.desc}</div>
                    </div>
                    {isSelected && (
                      <div className="w-4 h-4 rounded-full bg-amber-400 text-gray-950 flex items-center justify-center shrink-0">
                        <Check className="w-3 h-3 stroke-[3]" />
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Step 3: Text Overlay */}
          <div>
            <label className="text-xs font-bold text-gray-200 uppercase tracking-wider flex items-center gap-2 mb-2">
              <Type className="w-4 h-4 text-emerald-400" />
              3. Text Overlay Phrase
            </label>
            <input
              type="text"
              value={textOverlay}
              onChange={(e) => setTextOverlay(e.target.value)}
              placeholder="2-3 bold words e.g. VERDICT REVEALED"
              className="w-full px-4 py-2.5 bg-gray-950 border border-gray-800 rounded-xl text-white font-bold tracking-wide focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 text-sm"
            />
            <p className="text-[10px] text-gray-400 mt-1">Keep to 2-4 strong impact words for maximum YouTube CTR.</p>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-800 bg-gray-900/90">
          <button
            type="button"
            onClick={onClose}
            disabled={isGenerating}
            className="px-4 py-2 text-xs font-semibold text-gray-400 hover:text-white rounded-xl hover:bg-gray-800 transition"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleConfirm}
            disabled={isGenerating}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-violet-500/25 transition disabled:opacity-50"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Generating Pristine Image...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 text-amber-300 fill-amber-300" />
                <span>Confirm & Generate Pristine Thumbnail</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
