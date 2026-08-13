'use client'

import { useState } from 'react'
import { ChevronDown, Database, TrendingUp, Video, CheckCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getCategoryColor } from '@/lib/category-colors'
import type { ThreadCategory } from '@/types/chat'

interface ContextIndicatorProps {
  category: ThreadCategory
  videoTitle?: string
  channelName?: string
}

const CONTEXT_DATA: Record<ThreadCategory, string[]> = {
  general: ['Channel stats loaded', 'Recent activity available'],
  script: ['Channel voice & style loaded', 'Script structure template ready', 'Trending topics available'],
  seo: ['Top performing videos loaded', 'Approved SEO patterns ready', 'Channel keywords available'],
  thumbnail: ['Channel style guide loaded', 'Thumbnail best practices ready'],
  competitor: ['Trending topics loaded', 'Channel positioning data ready'],
  trends: ['15 latest trending topics loaded', 'Opportunity scores calculated'],
  ideas: ['Scoring criteria loaded', 'Channel context available'],
  outline: ['Trending topics loaded', 'Channel voice & style ready', 'Research mode enabled'],
}

export function ContextIndicator({ category, videoTitle, channelName }: ContextIndicatorProps) {
  const [expanded, setExpanded] = useState(false)
  const color = getCategoryColor(category)
  const items = CONTEXT_DATA[category] || CONTEXT_DATA.general

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {videoTitle && (
        <span className={cn('inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium', color.bg, color.bgDark, color.text, color.textDark)}>
          <Video className="w-2.5 h-2.5" />
          <span className="truncate max-w-[120px]">{videoTitle}</span>
        </span>
      )}

      <button
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition font-medium"
      >
        <Database className="w-2.5 h-2.5" />
        {items.length} context items
        <ChevronDown className={cn('w-2.5 h-2.5 transition-transform', expanded && 'rotate-180')} />
      </button>

      {expanded && (
        <div className="w-full flex flex-wrap gap-1.5 mt-1">
          {items.map((item, idx) => (
            <span key={idx} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400">
              <CheckCircle className="w-2.5 h-2.5 text-emerald-400" />
              {item}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
