'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, MessageSquare, FileText, Sparkles, Image, Target, TrendingUp, Lightbulb, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getCategoryColor, CATEGORY_COLORS } from '@/lib/category-colors'
import type { ThreadCategory } from '@/types/chat'

interface CategorySelectorProps {
  value: ThreadCategory
  onChange: (category: ThreadCategory) => void
}

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  MessageSquare, FileText, Sparkles, Image, Target, TrendingUp, Lightbulb, Layers,
}

const CATEGORY_DESCRIPTIONS: Record<ThreadCategory, string> = {
  general: 'Ask anything about your channel',
  script: 'Write video scripts with timestamps',
  seo: 'Generate titles, descriptions, tags',
  thumbnail: 'Design thumbnail concepts',
  competitor: 'Analyze competing channels',
  trends: 'Find trending topics',
  ideas: 'Score content ideas',
  outline: 'Research topic, get hooks, build outline',
}

// Visible selectable tabs in UI (General and Thumbnail only; others preserved in code for future use)
const VISIBLE_CATEGORIES: ThreadCategory[] = ['general', 'thumbnail']

export function CategorySelector({ value, onChange }: CategorySelectorProps) {
  return (
    <div className="inline-flex items-center p-0.5 bg-gray-200/70 dark:bg-gray-800/80 rounded-xl border border-gray-200 dark:border-gray-700 shadow-inner">
      {VISIBLE_CATEGORIES.map((cat) => {
        const color = getCategoryColor(cat)
        const Icon = ICON_MAP[color.icon] || MessageSquare
        const isActive = cat === value || (cat === 'general' && !VISIBLE_CATEGORIES.includes(value))

        return (
          <button
            key={cat}
            type="button"
            onClick={() => onChange(cat)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all duration-150',
              isActive
                ? cn(
                    'bg-white dark:bg-gray-900 shadow-sm border border-gray-200/80 dark:border-gray-700',
                    color.text, color.textDark,
                  )
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-white/40 dark:hover:bg-gray-800/40',
            )}
            title={CATEGORY_DESCRIPTIONS[cat]}
          >
            <Icon className={cn('w-3.5 h-3.5', isActive ? `${color.text} ${color.textDark}` : 'text-gray-400')} />
            <span>{color.name}</span>
          </button>
        )
      })}
    </div>
  )
}
