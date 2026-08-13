'use client'

import { useState } from 'react'
import { Copy, Check, Tag, Hash } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { SeoContent } from '@/lib/content-detector'

interface SeoCardProps {
  content: SeoContent
}

export function SeoCard({ content }: SeoCardProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const handleCopy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      toast.success(`${field} copied!`)
      setTimeout(() => setCopiedField(null), 2000)
    } catch {
      toast.error('Failed to copy')
    }
  }

  const handleCopyAll = async () => {
    const all = `Title: ${content.title}\n\nDescription: ${content.description}\n\nTags: ${content.tags.join(', ')}\n\nHashtags: ${content.hashtags.map(h => `#${h}`).join(' ')}`
    await handleCopy(all, 'All')
  }

  return (
    <div className="space-y-4">
      {/* Title */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Title</label>
          <button
            onClick={() => handleCopy(content.title, 'Title')}
            className="text-[10px] text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 font-medium flex items-center gap-1 transition"
          >
            {copiedField === 'Title' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            Copy
          </button>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl p-3.5">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{content.title}</p>
          <p className="text-[10px] text-gray-400 mt-1">{content.title.length} characters</p>
        </div>
      </div>

      {/* Description */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Description</label>
          <button
            onClick={() => handleCopy(content.description, 'Description')}
            className="text-[10px] text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 font-medium flex items-center gap-1 transition"
          >
            {copiedField === 'Description' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            Copy
          </button>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl p-3.5">
          <p className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">{content.description}</p>
        </div>
      </div>

      {/* Tags */}
      {content.tags.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1">
              <Tag className="w-3 h-3" />
              Tags ({content.tags.length})
            </label>
            <button
              onClick={() => handleCopy(content.tags.join(', '), 'Tags')}
              className="text-[10px] text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 font-medium flex items-center gap-1 transition"
            >
              {copiedField === 'Tags' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              Copy All
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {content.tags.map((tag, i) => (
              <span
                key={i}
                className="text-xs bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-500/25 font-medium cursor-pointer hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition"
                onClick={() => handleCopy(tag, 'Tag')}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Hashtags */}
      {content.hashtags.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1">
              <Hash className="w-3 h-3" />
              Hashtags
            </label>
            <button
              onClick={() => handleCopy(content.hashtags.map(h => `#${h}`).join(' '), 'Hashtags')}
              className="text-[10px] text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 font-medium flex items-center gap-1 transition"
            >
              {copiedField === 'Hashtags' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              Copy
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {content.hashtags.map((tag, i) => (
              <span
                key={i}
                className="text-xs bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 px-2.5 py-1 rounded-full border border-indigo-200 dark:border-indigo-500/25 font-medium"
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Copy All Button */}
      <button
        onClick={handleCopyAll}
        className="w-full bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold py-2.5 rounded-xl transition shadow-sm shadow-emerald-500/20 flex items-center justify-center gap-1.5"
      >
        <Copy className="w-3.5 h-3.5" />
        Copy All SEO Content
      </button>
    </div>
  )
}
