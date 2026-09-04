'use client'

import { useState, useEffect } from 'react'
import { X, Sparkles, Check, User, UserX, ShieldCheck, Type, Loader2, Monitor, Smartphone } from 'lucide-react'
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
  initialAspectRatio?: '16:9' | '9:16'
  initialHostImage?: string
  onConfirmGenerate: (options: {
    selectedHostImage: string
    logoPosition: 'top-left' | 'top-right' | 'none'
    customText: string
    aspectRatio: '16:9' | '9:16'
  }) => Promise<void>
}

export function ThumbnailCustomizerModal({
  isOpen,
  onClose,
  conceptTitle,
  defaultText,
  visualDescription,
  colors,
  initialAspectRatio = '16:9',
  initialHostImage = 'none',
  onConfirmGenerate,
}: ThumbnailCustomizerModalProps) {
  const [hostImages, setHostImages] = useState<HostImage[]>([])
  const [logoAssets, setLogoAssets] = useState<LogoAsset[]>([])
  const [loadingAssets, setLoadingAssets] = useState(false)
  const [selectedHostImage, setSelectedHostImage] = useState<string>(initialHostImage || 'none')
  const [logoPosition, setLogoPosition] = useState<'top-left' | 'top-right' | 'none'>('top-right')
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>(initialAspectRatio)
  const [textOverlay, setTextOverlay] = useState<string>(defaultText)
  const [isGenerating, setIsGenerating] = useState(false)

  useEffect(() => {
    setTextOverlay(defaultText)
  }, [defaultText])

  useEffect(() => {
    if (initialAspectRatio) {
      setAspectRatio(initialAspectRatio)
    }
  }, [initialAspectRatio])

  useEffect(() => {
    if (initialHostImage !== undefined) {
      setSelectedHostImage(initialHostImage || 'none')
    }
  }, [initialHostImage])

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
        if (!selectedHostImage && selectedHostImage !== 'none') {
          setSelectedHostImage(initialHostImage || 'none')
        }
      } else {
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
        aspectRatio,
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

  const wordCount = textOverlay.trim() ? textOverlay.trim().split(/\s+/).length : 0
  const isOptimalWordCount = wordCount >= 2 && wordCount <= 4

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/80">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-violet-400" />
            <h2 className="text-base font-bold text-white tracking-wide">
              Customize Thumbnail Composition — {conceptTitle}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-left">
          {/* Step 1: Aspect Ratio Selection */}
          <div>
            <label className="text-xs font-bold text-gray-200 uppercase tracking-wider flex items-center gap-2 mb-3">
              <Monitor className="w-4 h-4 text-cyan-400" />
              1. Canvas Format & Aspect Ratio
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setAspectRatio('16:9')}
                className={`p-3 rounded-xl border text-left transition flex items-center justify-between ${
                  aspectRatio === '16:9'
                    ? 'bg-cyan-500/10 border-cyan-500/60 text-white shadow-md'
                    : 'bg-gray-800/50 border-gray-800 text-gray-400 hover:border-gray-700 hover:text-gray-200'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Monitor className="w-4 h-4 text-cyan-400" />
                  <div>
                    <div className="text-xs font-semibold text-white">16:9 Standard Video</div>
                    <div className="text-[10px] text-gray-400">1536x1024 YouTube Landscape</div>
                  </div>
                </div>
                {aspectRatio === '16:9' && (
                  <div className="w-4 h-4 rounded-full bg-cyan-400 text-gray-950 flex items-center justify-center shrink-0">
                    <Check className="w-3 h-3 stroke-[3]" />
                  </div>
                )}
              </button>

              <button
                type="button"
                onClick={() => setAspectRatio('9:16')}
                className={`p-3 rounded-xl border text-left transition flex items-center justify-between ${
                  aspectRatio === '9:16'
                    ? 'bg-cyan-500/10 border-cyan-500/60 text-white shadow-md'
                    : 'bg-gray-800/50 border-gray-800 text-gray-400 hover:border-gray-700 hover:text-gray-200'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Smartphone className="w-4 h-4 text-cyan-400" />
                  <div>
                    <div className="text-xs font-semibold text-white">9:16 Vertical Reel</div>
                    <div className="text-[10px] text-gray-400">1024x1536 Shorts & Reels</div>
                  </div>
                </div>
                {aspectRatio === '9:16' && (
                  <div className="w-4 h-4 rounded-full bg-cyan-400 text-gray-950 flex items-center justify-center shrink-0">
                    <Check className="w-3 h-3 stroke-[3]" />
                  </div>
                )}
              </button>
            </div>
          </div>

          {/* Step 2: Select Unique Host Image */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-bold text-gray-200 uppercase tracking-wider flex items-center gap-2">
                <User className="w-4 h-4 text-violet-400" />
                2. Select Host Face Image
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
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                {/* Dedicated No Host Option */}
                <button
                  type="button"
                  onClick={() => setSelectedHostImage('none')}
                  className={`relative aspect-square rounded-xl overflow-hidden border-2 transition group flex flex-col items-center justify-center p-1 ${
                    selectedHostImage === 'none'
                      ? 'border-red-500 ring-2 ring-red-500/40 bg-red-500/10 scale-105 shadow-lg shadow-red-500/20'
                      : 'border-gray-800 hover:border-gray-600 bg-gray-800/40 opacity-70 hover:opacity-100'
                  }`}
                >
                  <UserX className={`w-5 h-5 mb-1 ${selectedHostImage === 'none' ? 'text-red-400' : 'text-gray-400'}`} />
                  <span className="text-[9px] font-bold text-gray-300 text-center leading-tight">No Host</span>
                  {selectedHostImage === 'none' && (
                    <div className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-red-500 text-white flex items-center justify-center">
                      <Check className="w-2.5 h-2.5" />
                    </div>
                  )}
                </button>

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

          {/* Step 3: Brand Logo Position */}
          <div>
            <label className="text-xs font-bold text-gray-200 uppercase tracking-wider flex items-center gap-2 mb-3">
              <ShieldCheck className="w-4 h-4 text-amber-400" />
              3. Brand Logo Position (MAE Logo)
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

          {/* Step 4: Text Overlay with Word Counter */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-gray-200 uppercase tracking-wider flex items-center gap-2">
                <Type className="w-4 h-4 text-emerald-400" />
                4. Text Overlay Phrase
              </label>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                  isOptimalWordCount
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                }`}
              >
                {wordCount} {wordCount === 1 ? 'word' : 'words'} (Goal: 2-4)
              </span>
            </div>
            <input
              type="text"
              value={textOverlay}
              onChange={(e) => setTextOverlay(e.target.value)}
              placeholder="2-4 bold impact words e.g. VERDICT REVEALED"
              className="w-full px-4 py-2.5 bg-gray-950 border border-gray-800 rounded-xl text-white font-bold tracking-wide focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 text-sm"
            />
            <p className="text-[10px] text-gray-400 mt-1">
              Keep strictly to 2-4 uppercase words placed safely away from borders for maximum click-through rate.
            </p>
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
                <span>Generating Image...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 text-amber-300 fill-amber-300" />
                <span>Confirm & Generate Thumbnail</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
