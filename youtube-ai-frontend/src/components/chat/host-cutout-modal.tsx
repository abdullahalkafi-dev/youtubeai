'use client'

import { useState, useEffect, useRef } from 'react'
import ReactCrop, { type Crop, type PixelCrop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import {
  X,
  User,
  UserX,
  Upload,
  Check,
  Sparkles,
  Loader2,
  Trash2,
  Crop as CropIcon,
  Eye,
  CheckCircle2,
  RefreshCw,
  Info,
} from 'lucide-react'
import api, { formatAssetUrl } from '@/lib/api'
import { toast } from 'sonner'

interface HostCutoutModalProps {
  isOpen: boolean
  onClose: () => void
  selectedHostImage?: string
  customHostUrl?: string
  onApply: (selection: {
    selectedHostImage: string
    customHostUrl?: string
    excludeHost: boolean
  }) => void
  threadId?: string
}

function getCroppedImgBase64(image: HTMLImageElement, crop?: PixelCrop): string {
  const canvas = document.createElement('canvas')
  if (!crop || !crop.width || !crop.height) {
    let w = image.naturalWidth
    let h = image.naturalHeight
    const maxDim = 1200
    if (w > maxDim || h > maxDim) {
      if (w > h) {
        h = Math.round((h * maxDim) / w)
        w = maxDim
      } else {
        w = Math.round((w * maxDim) / h)
        h = maxDim
      }
    }
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image, 0, 0, w, h)
    return canvas.toDataURL('image/png')
  }

  const scaleX = image.naturalWidth / image.width
  const scaleY = image.naturalHeight / image.height

  let targetWidth = Math.floor(crop.width * scaleX)
  let targetHeight = Math.floor(crop.height * scaleY)

  const maxDim = 1200
  if (targetWidth > maxDim || targetHeight > maxDim) {
    if (targetWidth > targetHeight) {
      targetHeight = Math.round((targetHeight * maxDim) / targetWidth)
      targetWidth = maxDim
    } else {
      targetWidth = Math.round((targetWidth * maxDim) / targetHeight)
      targetHeight = maxDim
    }
  }

  canvas.width = targetWidth
  canvas.height = targetHeight

  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    image,
    crop.x * scaleX,
    crop.y * scaleY,
    crop.width * scaleX,
    crop.height * scaleY,
    0,
    0,
    targetWidth,
    targetHeight,
  )

  return canvas.toDataURL('image/png')
}

export function HostCutoutModal({
  isOpen,
  onClose,
  selectedHostImage = 'none',
  customHostUrl,
  onApply,
  threadId,
}: HostCutoutModalProps) {
  const [activeTab, setActiveTab] = useState<'studio' | 'presets'>('studio')
  const [currentSelectedHost, setCurrentSelectedHost] = useState<string>(selectedHostImage)
  const [currentCustomUrl, setCurrentCustomUrl] = useState<string | undefined>(customHostUrl)

  // Cropper & Studio state
  const [rawImageSrc, setRawImageSrc] = useState<string | null>(null)
  const [crop, setCrop] = useState<Crop>()
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>()
  const imgRef = useRef<HTMLImageElement>(null)

  // Preview & Processing state
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [previewCutoutUrl, setPreviewCutoutUrl] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setCurrentSelectedHost(selectedHostImage || 'none')
      setCurrentCustomUrl(customHostUrl)
      if (customHostUrl) {
        setActiveTab('studio')
      } else if (selectedHostImage && selectedHostImage !== 'none' && selectedHostImage !== 'custom') {
        setActiveTab('presets')
      } else {
        setActiveTab('studio')
      }
    }
  }, [isOpen, selectedHostImage, customHostUrl])

  if (!isOpen) return null

  const hostPresets = [
    { id: 'host_1.png', label: 'Host #1', url: '/api/assets/unique-images/host_1.png' },
    { id: 'host_2.png', label: 'Host #2', url: '/api/assets/unique-images/host_2.png' },
    { id: 'host_3.png', label: 'Host #3', url: '/api/assets/unique-images/host_3.png' },
    { id: 'host_4.png', label: 'Host #4', url: '/api/assets/unique-images/host_4.png' },
    { id: 'host_5.png', label: 'Host #5', url: '/api/assets/unique-images/host_5.png' },
    { id: 'host_6.png', label: 'Host #6', url: '/api/assets/unique-images/host_6.png' },
    { id: 'host_7.png', label: 'Host #7', url: '/api/assets/unique-images/host_7.png' },
  ]

  const onSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0]
      const reader = new FileReader()
      reader.addEventListener('load', () => {
        setRawImageSrc(reader.result?.toString() || null)
        setPreviewCutoutUrl(null)
        setCrop({
          unit: '%',
          x: 10,
          y: 0,
          width: 80,
          height: 85,
        })
      })
      reader.readAsDataURL(file)
    }
  }

  const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget
    const initialCrop: PixelCrop = {
      unit: 'px',
      x: Math.round(width * 0.1),
      y: 0,
      width: Math.round(width * 0.8),
      height: Math.round(height * 0.85),
    }
    setCompletedCrop(initialCrop)
    setCrop({
      unit: '%',
      x: 10,
      y: 0,
      width: 80,
      height: 85,
    })
  }

  const generateAutoCutout = async (cropToUse?: PixelCrop) => {
    if (!imgRef.current || !threadId) return

    setIsPreviewing(true)
    try {
      const base64Cropped = getCroppedImgBase64(imgRef.current, cropToUse || completedCrop)
      if (!base64Cropped) return

      const res = await api.previewCutout(threadId, base64Cropped)
      if (res?.previewUrl) {
        setPreviewCutoutUrl(res.previewUrl)
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate cutout')
    } finally {
      setIsPreviewing(false)
    }
  }

  // Automatically trigger cutout generation when crop changes (debounced 350ms)
  useEffect(() => {
    if (!rawImageSrc || !imgRef.current || !threadId || !completedCrop?.width) return
    const timer = setTimeout(() => {
      generateAutoCutout(completedCrop)
    }, 350)
    return () => clearTimeout(timer)
  }, [completedCrop, rawImageSrc, threadId])

  const handleSaveCutout = async () => {
    if (!threadId) return
    const imageToSave = previewCutoutUrl || (imgRef.current ? getCroppedImgBase64(imgRef.current, completedCrop) : null)
    if (!imageToSave) {
      toast.error('No cutout or crop available to save')
      return
    }

    setIsSaving(true)
    try {
      const res = await api.saveCustomHost(threadId, imageToSave, `custom_host_${Date.now()}.png`)
      if (res?.url) {
        setCurrentCustomUrl(res.url)
        setCurrentSelectedHost('custom')
        setRawImageSrc(null)
        setPreviewCutoutUrl(null)
        toast.success('Custom host cutout saved to your studio!')
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to save cutout')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteCustomHost = async () => {
    if (!threadId || !currentCustomUrl) return
    setIsDeleting(true)
    try {
      const filename = currentCustomUrl.split('/').pop() || currentCustomUrl
      await api.deleteCustomHost(threadId, filename)
      setCurrentCustomUrl(undefined)
      if (currentSelectedHost === 'custom') setCurrentSelectedHost('none')
      toast.success('Custom host removed')
    } catch (err: any) {
      toast.error(err.message || 'Failed to remove custom host')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleApply = () => {
    const excludeHost = currentSelectedHost === 'none'
    onApply({
      selectedHostImage: currentSelectedHost,
      customHostUrl: currentSelectedHost === 'custom' ? currentCustomUrl : undefined,
      excludeHost,
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-pink-100 dark:bg-pink-900/40 flex items-center justify-center text-pink-600 dark:text-pink-400 shadow-sm">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900 dark:text-white font-heading flex items-center gap-2">
                Host Cutout & Avatar Studio
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-pink-50 dark:bg-pink-950/60 text-pink-600 dark:text-pink-400 font-semibold border border-pink-200 dark:border-pink-800/50">
                  Auto Background Removal
                </span>
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Frame your portrait bust shot — background is removed automatically into a transparent cutout
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1.5 rounded-lg transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-6 pt-3 pb-0 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2 bg-gray-50/50 dark:bg-gray-900/50">
          <button
            type="button"
            onClick={() => setActiveTab('studio')}
            className={`pb-3 px-3 text-xs font-semibold border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'studio'
                ? 'border-pink-600 text-pink-600 dark:text-pink-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <CropIcon className="w-3.5 h-3.5" />
            Custom Photo & Cutout Studio
            {currentCustomUrl && (
              <span className="w-2 h-2 rounded-full bg-emerald-500" title="Custom host ready" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('presets')}
            className={`pb-3 px-3 text-xs font-semibold border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'presets'
                ? 'border-pink-600 text-pink-600 dark:text-pink-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Presets & Pure Scene ({hostPresets.length + 1})
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {activeTab === 'studio' && (
            <div className="space-y-6">
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onSelectFile}
              />

              {/* Case 1: Active Custom Host Saved */}
              {!rawImageSrc && currentCustomUrl && (
                <div className="p-4 rounded-xl border-2 border-emerald-500/40 bg-emerald-50/30 dark:bg-emerald-950/20 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    {/* Checkerboard container */}
                    <div className="w-20 h-20 rounded-xl border border-emerald-200 dark:border-emerald-800/60 overflow-hidden bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] dark:bg-[radial-gradient(#334155_1px,transparent_1px)] bg-[size:8px_8px] shrink-0 flex items-center justify-center shadow-inner">
                      <img
                        src={formatAssetUrl(currentCustomUrl)}
                        alt="Custom Host Cutout"
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                          Active Custom Host Cutout
                        </h4>
                        <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-600 text-white font-bold">
                          READY
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-md">
                        This cutout will be composited sharply directly into your YouTube thumbnail scene without diffusion smoothing or facial distortions.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3 py-1.5 text-xs font-semibold bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-pink-500 rounded-lg text-gray-700 dark:text-gray-200 transition"
                    >
                      Upload New Photo
                    </button>
                    <button
                      type="button"
                      disabled={isDeleting}
                      onClick={handleDeleteCustomHost}
                      className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition"
                      title="Delete saved host"
                    >
                      {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              {/* Case 2: No Image Loaded & No Custom Host */}
              {!rawImageSrc && !currentCustomUrl && (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="p-8 border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-pink-500 dark:hover:border-pink-400 rounded-2xl flex flex-col items-center justify-center text-center cursor-pointer bg-gray-50/50 dark:bg-gray-900/50 transition group"
                >
                  <div className="w-14 h-14 rounded-2xl bg-pink-50 dark:bg-pink-950/40 border border-pink-200 dark:border-pink-900/50 flex items-center justify-center text-pink-600 dark:text-pink-400 mb-3 group-hover:scale-105 transition">
                    <Upload className="w-6 h-6" />
                  </div>
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                    Upload Portrait or Green-Screen Photo
                  </h4>
                  <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm mt-1">
                    Frame your head & shoulders — background is automatically removed into a transparent cutout.
                  </p>
                  <button
                    type="button"
                    className="mt-4 px-4 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-xl text-xs font-semibold shadow-sm transition"
                  >
                    Select Photo from Computer
                  </button>
                </div>
              )}

              {/* Case 3: Interactive Cropper & Studio Workbench */}
              {rawImageSrc && (
                <div className="space-y-5">
                  <div className="flex items-center justify-between bg-emerald-50/50 dark:bg-emerald-950/20 p-3 rounded-xl border border-emerald-200 dark:border-emerald-900/40 text-xs text-emerald-700 dark:text-emerald-300">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 shrink-0 text-emerald-600" />
                      <span>
                        <strong>Automatic Cutout:</strong> Drag the handles to frame your head & shoulders. The transparent cutout updates automatically!
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setRawImageSrc(null)
                        setPreviewCutoutUrl(null)
                      }}
                      className="px-2.5 py-1 bg-white dark:bg-gray-800 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 rounded-lg font-medium transition shrink-0"
                    >
                      Change Photo
                    </button>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                    {/* Left: Cropper Workbench */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                          <CropIcon className="w-3.5 h-3.5 text-pink-500" />
                          Step 1: Frame Head & Torso
                        </label>
                        <span className="text-[11px] text-gray-400">
                          {completedCrop ? `${Math.round(completedCrop.width)} × ${Math.round(completedCrop.height)} px` : 'Drag to frame'}
                        </span>
                      </div>

                      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-950 flex items-center justify-center p-3 select-none min-h-[380px] max-h-[500px]">
                        <ReactCrop
                          crop={crop}
                          onChange={(_, percentCrop) => setCrop(percentCrop)}
                          onComplete={(c) => setCompletedCrop(c)}
                          className="flex items-center justify-center"
                        >
                          <img
                            ref={imgRef}
                            src={rawImageSrc}
                            alt="Crop target"
                            onLoad={onImageLoad}
                            style={{ maxHeight: 'min(440px, 48vh)', maxWidth: '100%', width: 'auto', objectFit: 'contain' }}
                            className="select-none"
                          />
                        </ReactCrop>
                      </div>

                      <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-800/40 text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-2">
                        <Info className="w-4 h-4 shrink-0 text-pink-500" />
                        <span>Green screen or solid backgrounds are automatically keyed out with smooth feathering and de-spill.</span>
                      </div>
                    </div>

                    {/* Right: Live Preview Checkerboard */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                          <Eye className="w-3.5 h-3.5 text-emerald-500" />
                          Step 2: Transparent Cutout Result
                        </label>
                        {isPreviewing ? (
                          <span className="text-[10px] text-pink-600 font-semibold flex items-center gap-1 animate-pulse">
                            <Loader2 className="w-3 h-3 animate-spin" /> Removing Background...
                          </span>
                        ) : previewCutoutUrl ? (
                          <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Cutout Ready
                          </span>
                        ) : null}
                      </div>

                      <div className="min-h-[380px] max-h-[500px] h-full rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] dark:bg-[radial-gradient(#334155_1px,transparent_1px)] bg-[size:10px_10px] flex items-center justify-center p-4 relative shadow-inner">
                        {isPreviewing && !previewCutoutUrl ? (
                          <div className="text-center p-6 space-y-3 text-gray-400">
                            <Loader2 className="w-8 h-8 mx-auto text-pink-600 animate-spin" />
                            <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                              Removing background automatically...
                            </p>
                            <p className="text-[11px] text-gray-400">
                              Chroma keying green screen with feathered anti-aliasing
                            </p>
                          </div>
                        ) : previewCutoutUrl ? (
                          <div className="relative w-full h-full flex items-center justify-center">
                            <img
                              src={previewCutoutUrl}
                              alt="Cutout Preview"
                              className="max-h-full max-w-full object-contain filter drop-shadow-lg"
                            />
                            {isPreviewing && (
                              <div className="absolute inset-0 bg-black/20 backdrop-blur-[1px] rounded-xl flex items-center justify-center">
                                <div className="bg-black/70 text-white text-xs px-3 py-1.5 rounded-lg flex items-center gap-2 shadow">
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-pink-400" />
                                  Updating cutout...
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-center p-6 space-y-2 text-gray-400">
                            <Loader2 className="w-8 h-8 mx-auto text-gray-300 dark:text-gray-600 animate-spin" />
                            <p className="text-xs font-medium">Generating transparent cutout...</p>
                          </div>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleSaveCutout}
                          disabled={!previewCutoutUrl || isSaving}
                          className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition flex items-center justify-center gap-2 shadow-sm"
                        >
                          {isSaving ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              Saving to Studio...
                            </>
                          ) : (
                            <>
                              <Check className="w-4 h-4" />
                              Save & Use This Cutout
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'presets' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Select a pre-keyed host presenter avatar or choose pure scene with no host.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {/* No Host Option */}
                <button
                  type="button"
                  onClick={() => setCurrentSelectedHost('none')}
                  className={`flex flex-col items-center justify-center p-3.5 rounded-xl border-2 transition ${
                    currentSelectedHost === 'none'
                      ? 'border-pink-500 bg-pink-50 dark:bg-pink-950/30 text-pink-600 dark:text-pink-400 shadow-sm'
                      : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 text-gray-600 dark:text-gray-400'
                  }`}
                >
                  <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-2">
                    <UserX className="w-6 h-6 text-gray-400" />
                  </div>
                  <span className="text-xs font-semibold">No Host</span>
                  <span className="text-[10px] text-gray-400">Pure Cinematic Scene</span>
                </button>

                {/* Host Presets 1 to 7 */}
                {hostPresets.map((preset) => {
                  const isSelected = currentSelectedHost === preset.id
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setCurrentSelectedHost(preset.id)}
                      className={`relative flex flex-col items-center justify-center p-3 rounded-xl border-2 transition ${
                        isSelected
                          ? 'border-pink-500 bg-pink-50/70 dark:bg-pink-950/30 text-pink-600 dark:text-pink-400 shadow-sm'
                          : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {isSelected && (
                        <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-pink-500 text-white flex items-center justify-center shadow">
                          <Check className="w-2.5 h-2.5" />
                        </span>
                      )}

                      <div className="w-14 h-14 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 mb-2 flex items-center justify-center shadow-inner">
                        <img
                          src={formatAssetUrl(preset.url)}
                          alt={preset.label}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <span className="text-xs font-semibold">{preset.label}</span>
                      <span className="text-[10px] text-gray-400">Pre-keyed Avatar</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900/80 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
            <span>Selected:</span>
            <span className="font-semibold text-gray-900 dark:text-white px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-800">
              {currentSelectedHost === 'none'
                ? 'No Host (Pure Scene)'
                : currentSelectedHost === 'custom'
                ? 'Custom Studio Cutout'
                : currentSelectedHost}
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 rounded-xl transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="px-5 py-2 bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-700 hover:to-rose-700 text-white rounded-xl text-xs font-semibold shadow-sm transition"
            >
              Apply Selection
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
