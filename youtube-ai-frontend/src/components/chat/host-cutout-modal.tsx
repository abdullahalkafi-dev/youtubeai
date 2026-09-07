'use client'

import { useState, useEffect, useRef } from 'react'
import {
  X,
  User,
  UserX,
  Upload,
  Check,
  Sparkles,
  Loader2,
  Trash2,
  ShieldCheck,
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

export function HostCutoutModal({
  isOpen,
  onClose,
  selectedHostImage = 'none',
  customHostUrl,
  onApply,
  threadId,
}: HostCutoutModalProps) {
  const [currentSelectedHost, setCurrentSelectedHost] = useState<string>(selectedHostImage)
  const [currentCustomUrl, setCurrentCustomUrl] = useState<string | undefined>(customHostUrl)
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setCurrentSelectedHost(selectedHostImage || 'none')
      setCurrentCustomUrl(customHostUrl)
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !threadId) {
      if (!threadId) toast.error('No active thread to associate uploaded photo')
      return
    }

    setIsUploading(true)
    try {
      const res = await api.uploadReferenceAsset(threadId, file)
      if (res?.url) {
        setCurrentCustomUrl(res.url)
        setCurrentSelectedHost('custom')
        toast.success('Host photo uploaded! Auto-cutout ready.')
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to upload photo')
    } finally {
      setIsUploading(false)
      if (e.target) e.target.value = ''
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-pink-100 dark:bg-pink-900/40 flex items-center justify-center text-pink-600 dark:text-pink-400">
              <User className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white font-heading">
                Host Cutout & Avatar Studio
              </h3>
              <p className="text-xs text-gray-400">
                Pick a host avatar, upload your own selfie, or remove the host entirely
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

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Custom Selfie Upload Section */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-pink-500" />
                Upload Your Own Photo / Selfie
              </label>
              <span className="text-[10px] text-pink-600 dark:text-pink-400 font-medium flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" /> Auto-Cutout & Transparent PNG
              </span>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileUpload}
            />

            {currentCustomUrl ? (
              <div
                onClick={() => setCurrentSelectedHost('custom')}
                className={`relative flex items-center gap-4 p-3 rounded-xl border-2 transition cursor-pointer ${
                  currentSelectedHost === 'custom'
                    ? 'border-pink-500 bg-pink-50/50 dark:bg-pink-950/20 shadow-sm'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                {/* Checkerboard preview box */}
                <div className="w-16 h-16 rounded-lg border border-pink-200 dark:border-pink-800/60 overflow-hidden bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] dark:bg-[radial-gradient(#334155_1px,transparent_1px)] bg-[size:8px_8px] shrink-0 flex items-center justify-center">
                  <img
                    src={formatAssetUrl(currentCustomUrl)}
                    alt="Custom Host"
                    className="w-full h-full object-contain"
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-gray-900 dark:text-white">
                      Your Custom Host Cutout
                    </p>
                    {currentSelectedHost === 'custom' && (
                      <span className="px-1.5 py-0.2 rounded text-[9px] bg-pink-500 text-white font-bold">
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                    Composited directly on clean backgrounds with zero diffusion distortion.
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      fileInputRef.current?.click()
                    }}
                    className="px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition"
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setCurrentCustomUrl(undefined)
                      if (currentSelectedHost === 'custom') setCurrentSelectedHost('none')
                    }}
                    className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg transition"
                    title="Remove custom host"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="w-full py-4 border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-pink-400 dark:hover:border-pink-500 rounded-xl flex flex-col items-center justify-center gap-1.5 text-gray-500 dark:text-gray-400 hover:text-pink-600 dark:hover:text-pink-400 transition bg-gray-50/50 dark:bg-gray-900/50"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin text-pink-500" />
                    <span className="text-xs font-medium">Uploading & preparing cutout...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-5 h-5 text-gray-400 group-hover:text-pink-500" />
                    <span className="text-xs font-medium">Upload photo / selfie (JPEG, PNG, WebP)</span>
                    <span className="text-[10px] text-gray-400">
                      Sharp extracts foreground cutout into transparent PNG automatically
                    </span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* Standard Presets & Pure Scene */}
          <div className="space-y-2.5">
            <label className="text-xs font-semibold text-gray-800 dark:text-gray-200">
              Host Presets & Removal
            </label>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {/* Option: No Host */}
              <button
                type="button"
                onClick={() => setCurrentSelectedHost('none')}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition ${
                  currentSelectedHost === 'none'
                    ? 'border-pink-500 bg-pink-50 dark:bg-pink-950/20 text-pink-600 dark:text-pink-400 shadow-sm'
                    : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 text-gray-600 dark:text-gray-400'
                }`}
              >
                <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-1.5">
                  <UserX className="w-6 h-6 text-gray-400" />
                </div>
                <span className="text-xs font-medium">No Host</span>
                <span className="text-[9px] text-gray-400">Pure scene</span>
              </button>

              {/* Presets 1 through 7 */}
              {hostPresets.map((preset) => {
                const isSelected = currentSelectedHost === preset.id
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setCurrentSelectedHost(preset.id)}
                    className={`relative flex flex-col items-center justify-center p-2.5 rounded-xl border-2 transition ${
                      isSelected
                        ? 'border-pink-500 bg-pink-50/70 dark:bg-pink-950/30 text-pink-600 dark:text-pink-400 shadow-sm'
                        : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {isSelected && (
                      <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-pink-500 text-white flex items-center justify-center">
                        <Check className="w-2.5 h-2.5" />
                      </span>
                    )}

                    <div className="w-12 h-12 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 mb-1.5 flex items-center justify-center">
                      <img
                        src={formatAssetUrl(preset.url)}
                        alt={preset.label}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <span className="text-xs font-medium">{preset.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900/80 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Current selection:{' '}
            <span className="font-semibold text-gray-800 dark:text-gray-200">
              {currentSelectedHost === 'none'
                ? 'No Host (Pure Scene)'
                : currentSelectedHost === 'custom'
                ? 'Custom Selfie Cutout'
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
