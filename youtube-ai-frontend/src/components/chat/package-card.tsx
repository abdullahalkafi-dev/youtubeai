'use client'

import { useState } from 'react'
import { ChevronDown, Package, Sparkles, Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { PackageContent, ThumbnailConcept } from '@/lib/content-detector'
import { SeoCard } from './seo-card'
import { ThumbnailCard } from './thumbnail-card'
import { MarkdownRenderer } from './markdown-renderer'

interface PackageCardProps {
  pkg: PackageContent
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
  /** Backend confidence gate — when true the first 2 thumbnails auto-fire. */
  autoImages?: boolean
  onStartGenerate?: (conceptTitle: string, count?: number) => void
  onFinishGenerate?: () => void
  onEditImage?: (
    url: string,
    mode: 'thumbnail' | 'scene',
    cleanUrl?: string,
    selectedHostImage?: string,
    aspectRatio?: '16:9' | '9:16',
    textOverlay?: string,
    visualDescription?: string,
    logoPosition?: 'top-left' | 'top-right' | 'none',
  ) => void
  videoTitle?: string
  threadTitle?: string
}

/**
 * Unified Package card — title, SEO, and thumbnails render as ONE unit.
 * Research ("why this works") is collapsed by default so the client sees the
 * answer first and the evidence on click.
 */
export function PackageCard({
  pkg,
  messageId,
  messageImages,
  autoImages,
  onStartGenerate,
  onFinishGenerate,
  onEditImage,
  videoTitle,
  threadTitle,
}: PackageCardProps) {
  const [researchOpen, setResearchOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopyTitle = async () => {
    if (!pkg.seo?.title) return
    try {
      await navigator.clipboard.writeText(pkg.seo.title)
      setCopied(true)
      toast.success('Title copied!')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Failed to copy')
    }
  }

  return (
    <div className="space-y-4 min-w-0 max-w-full overflow-hidden rounded-2xl border border-fuchsia-200 dark:border-fuchsia-500/25 bg-gradient-to-b from-fuchsia-50/60 to-white dark:from-fuchsia-500/5 dark:to-gray-900 p-4 sm:p-5">
      {/* Header — one unit, not separate artifacts */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-6 h-6 rounded-full bg-fuchsia-600 text-white flex items-center justify-center shrink-0">
            <Package className="w-3.5 h-3.5" />
          </span>
          <span className="text-xs font-bold text-fuchsia-700 dark:text-fuchsia-300 uppercase tracking-wider">
            Unified Package
          </span>
          <span className="text-[10px] text-fuchsia-600 dark:text-fuchsia-400 bg-fuchsia-500/10 px-2 py-0.5 rounded-full border border-fuchsia-500/20">
            Title + SEO + Thumbnails
          </span>
        </div>
        {autoImages && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 rounded-full">
            <Sparkles className="w-3 h-3" />
            Auto-generating 2 thumbnails
          </span>
        )}
      </div>

      {/* Research — collapsed by default: answer first, evidence on click */}
      {pkg.research && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden bg-white/70 dark:bg-gray-900/70">
          <button
            type="button"
            onClick={() => setResearchOpen((v) => !v)}
            className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60 transition"
          >
            <span className="text-[11px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
              Why this works — market research
            </span>
            <ChevronDown
              className={cn(
                'w-4 h-4 text-gray-400 transition-transform shrink-0',
                researchOpen && 'rotate-180',
              )}
            />
          </button>
          {researchOpen && (
            <div className="px-3.5 pb-3.5 pt-1 border-t border-gray-100 dark:border-gray-800">
              <MarkdownRenderer content={pkg.research} />
            </div>
          )}
        </div>
      )}

      {/* Title — biggest element, one-click copy */}
      {pkg.seo?.title && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Title
            </label>
            <button
              onClick={handleCopyTitle}
              className="text-[10px] text-fuchsia-600 dark:text-fuchsia-400 hover:text-fuchsia-700 dark:hover:text-fuchsia-300 font-medium flex items-center gap-1 transition"
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              Copy
            </button>
          </div>
          <div className="bg-white dark:bg-gray-900 border border-fuchsia-200 dark:border-fuchsia-500/25 rounded-xl p-3.5 shadow-sm">
            <p className="text-sm font-bold text-gray-900 dark:text-white leading-snug">
              {pkg.seo.title}
            </p>
            <p className="text-[10px] text-gray-400 mt-1">
              {pkg.seo.title.length} characters
            </p>
          </div>
        </div>
      )}

      {/* Description / Tags / Hashtags */}
      {pkg.seo && <SeoCard content={pkg.seo} />}

      {/* Thumbnails — auto-fire when the router was confident */}
      {pkg.thumbnails && pkg.thumbnails.length > 0 && (
        <ThumbnailCard
          thumbnails={pkg.thumbnails as ThumbnailConcept[]}
          messageId={messageId}
          messageImages={messageImages}
          autoGenerate={autoImages}
          onStartGenerate={onStartGenerate}
          onFinishGenerate={onFinishGenerate}
          onEditImage={(url, cleanUrl, hostImg, aspectRatio, textOverlay, visualDescription, logoPosition) =>
            onEditImage?.(url, 'thumbnail', cleanUrl, hostImg, aspectRatio, textOverlay, visualDescription, logoPosition)}
          videoTitle={videoTitle}
          threadTitle={threadTitle}
        />
      )}
    </div>
  )
}
