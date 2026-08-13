'use client'

import { MessageSquare, FileText, Sparkles, Image, Target, TrendingUp, Lightbulb, Layers } from 'lucide-react'
import { getCategoryColor } from '@/lib/category-colors'
import type { ThreadCategory } from '@/types/chat'

interface EmptyStateProps {
  category: ThreadCategory
  onSuggestionClick: (text: string) => void
}

const SUGGESTIONS: Record<ThreadCategory, Array<{ icon: string; text: string }>> = {
  general: [
    { icon: 'MessageSquare', text: 'What are the top trending stories this week?' },
    { icon: 'Lightbulb', text: 'Give me 5 video ideas for my channel' },
    { icon: 'TrendingUp', text: 'How can I improve my channel performance?' },
  ],
  script: [
    { icon: 'FileText', text: 'Write a 10-minute script about a trending case' },
    { icon: 'FileText', text: 'Create a cold open for my next video' },
    { icon: 'FileText', text: 'Help me write the youth warning section' },
  ],
  seo: [
    { icon: 'Sparkles', text: 'Generate SEO for my latest video' },
    { icon: 'Sparkles', text: 'Write an optimized title and description' },
    { icon: 'Sparkles', text: 'Suggest 15 tags for my video' },
  ],
  thumbnail: [
    { icon: 'Image', text: 'Design 3 thumbnail concepts for my video' },
    { icon: 'Image', text: 'What text should I put on my thumbnail?' },
    { icon: 'Image', text: 'Suggest color schemes for a courtroom video' },
  ],
  competitor: [
    { icon: 'Target', text: 'Analyze what top channels in my niche are doing' },
    { icon: 'Target', text: 'Find content gaps I can fill' },
    { icon: 'Target', text: 'What angles are competitors missing?' },
  ],
  trends: [
    { icon: 'TrendingUp', text: 'What criminal psychology stories are trending?' },
    { icon: 'TrendingUp', text: 'Find me high-opportunity topics to cover' },
    { icon: 'TrendingUp', text: 'Which trending stories fit my channel?' },
  ],
  ideas: [
    { icon: 'Lightbulb', text: 'Score this idea: [paste your idea]' },
    { icon: 'Lightbulb', text: 'Evaluate this topic for my channel' },
    { icon: 'Lightbulb', text: 'Is this story worth covering? Rate it.' },
  ],
  outline: [
    { icon: 'Layers', text: 'Build an outline for a video about [topic]' },
    { icon: 'Layers', text: 'Research a trending story and create hooks' },
    { icon: 'Layers', text: 'Help me plan a prison psychology video' },
  ],
}

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  MessageSquare, FileText, Sparkles, Image, Target, TrendingUp, Lightbulb, Layers,
}

export function EmptyState({ category, onSuggestionClick }: EmptyStateProps) {
  const color = getCategoryColor(category)
  const suggestions = SUGGESTIONS[category] || SUGGESTIONS.general

  return (
    <div className="flex flex-col items-center justify-center h-full px-4 py-8">
      {/* AI Avatar */}
      <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center mb-4 shadow-lg shadow-indigo-500/25`}>
        <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
        </svg>
      </div>

      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">UMA AI Assistant</h3>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-6 text-center max-w-xs">
        I'm your content strategist for Unique Mecca Audio. Ask me about scripts, SEO, thumbnails, trends, or ideas.
      </p>

      {/* Suggestion Cards */}
      <div className="w-full max-w-md space-y-2">
        {suggestions.map((suggestion, idx) => {
          const Icon = ICON_MAP[suggestion.icon] || MessageSquare
          return (
            <button
              key={idx}
              onClick={() => onSuggestionClick(suggestion.text)}
              className={`w-full text-left px-4 py-3 rounded-xl border transition-all hover:shadow-sm ${color.border} ${color.borderDark} hover:${color.bg} hover:${color.bgDark} group`}
            >
              <div className="flex items-center gap-3">
                <Icon className={`w-4 h-4 ${color.text} ${color.textDark} shrink-0`} />
                <span className="text-xs text-gray-600 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-white transition">
                  {suggestion.text}
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
