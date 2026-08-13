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

export function CategorySelector({ value, onChange }: CategorySelectorProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const currentColor = getCategoryColor(value)
  const categories = Object.keys(CATEGORY_COLORS) as ThreadCategory[]

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all',
          currentColor.border, currentColor.borderDark,
          currentColor.bg, currentColor.bgDark,
          currentColor.text, currentColor.textDark,
        )}
      >
        {(() => {
          const Icon = ICON_MAP[currentColor.icon] || MessageSquare
          return <Icon className="w-3.5 h-3.5" />
        })()}
        <span>{currentColor.name}</span>
        <ChevronDown className={cn('w-3 h-3 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="p-1.5">
            {categories.map((cat) => {
              const color = getCategoryColor(cat)
              const Icon = ICON_MAP[color.icon] || MessageSquare
              const isActive = cat === value

              return (
                <button
                  key={cat}
                  onClick={() => { onChange(cat); setOpen(false) }}
                  className={cn(
                    'w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-3 transition-all',
                    isActive
                      ? `${color.bg} ${color.bgDark}`
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                  )}
                >
                  <div className={cn(
                    'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                    isActive ? `${color.bg} ${color.bgDark}` : 'bg-gray-100 dark:bg-gray-700'
                  )}>
                    <Icon className={cn('w-4 h-4', isActive ? `${color.text} ${color.textDark}` : 'text-gray-400')} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-xs font-semibold', isActive ? `${color.text} ${color.textDark}` : 'text-gray-700 dark:text-gray-300')}>
                      {color.name}
                    </p>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                      {CATEGORY_DESCRIPTIONS[cat]}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
