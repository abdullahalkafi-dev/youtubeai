'use client'

import { useState } from 'react'
import { Copy, Check, ChevronDown, ChevronRight, Layers, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

interface HookOption {
  name: string
  script: string
}

interface OutlineSection {
  title: string
  timestamp?: string
  points: string[]
}

interface OutlineCardProps {
  content: string
}

const SECTION_COLORS: Record<string, string> = {
  'COLD OPEN': 'border-l-red-500 bg-red-50/50 dark:bg-red-500/5',
  'WHAT HAPPENED': 'border-l-blue-500 bg-blue-50/50 dark:bg-blue-500/5',
  'UNIQUE MECCA BREAKDOWN': 'border-l-amber-500 bg-amber-50/50 dark:bg-amber-500/5',
  'THE HUMAN COST': 'border-l-purple-500 bg-purple-50/50 dark:bg-purple-500/5',
  'THE YOUTH WARNING': 'border-l-emerald-500 bg-emerald-50/50 dark:bg-emerald-500/5',
  'FINAL JEWEL': 'border-l-indigo-500 bg-indigo-50/50 dark:bg-indigo-500/5',
}

function parseOutline(content: string) {
  const hooks: HookOption[] = []
  const sections: OutlineSection[] = []
  let showType = ''
  let score = ''
  let jewel = ''

  // Parse hooks
  const hookRegex = /###\s*Hook\s*\d+[:\s]*(.*?)\n([\s\S]*?)(?=###\s*Hook|$)/g
  let hookMatch
  while ((hookMatch = hookRegex.exec(content)) !== null) {
    hooks.push({
      name: hookMatch[1].trim(),
      script: hookMatch[2].trim().split('\n').map(l => l.replace(/^[-*]\s*/, '').trim()).filter(Boolean).join(' '),
    })
  }

  // Parse show type
  const showTypeMatch = content.match(/##\s*Recommended Show Type\s*\n([\s\S]*?)(?=\n##|$)/)
  if (showTypeMatch) showType = showTypeMatch[1].trim()

  // Parse score
  const scoreMatch = content.match(/##\s*Score\s*\n([\s\S]*?)(?=\n##|$)/)
  if (scoreMatch) score = scoreMatch[1].trim()

  // Parse outline sections
  const sectionRegex = /###\s*(COLD OPEN|WHAT HAPPENED|UNIQUE MECCA BREAKDOWN|THE HUMAN COST|THE YOUTH WARNING|FINAL JEWEL[^\n]*)\s*(?:\[([^\]]*)\])?\s*\n([\s\S]*?)(?=###|$)/g
  let sectionMatch
  while ((sectionMatch = sectionRegex.exec(content)) !== null) {
    const title = sectionMatch[1].trim()
    const timestamp = sectionMatch[2]?.trim()
    const points = sectionMatch[3]
      .split('\n')
      .map((l) => l.replace(/^[-*]\s*/, '').replace(/\*\*JEWEL:\*\*\s*/, '').trim())
      .filter(Boolean)

    sections.push({ title, timestamp, points })

    if (title.includes('FINAL JEWEL')) {
      const jewelMatch = sectionMatch[3].match(/\*\*JEWEL:\*\*\s*(.*)/i)
      if (jewelMatch) jewel = jewelMatch[1].trim()
    }
  }

  return { hooks, sections, showType, score, jewel }
}

export function OutlineCard({ content }: OutlineCardProps) {
  const [selectedHook, setSelectedHook] = useState<number | null>(null)
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set([0, 1]))
  const [copied, setCopied] = useState<string | null>(null)

  const { hooks, sections, showType, score, jewel } = parseOutline(content)

  const toggleSection = (index: number) => {
    const next = new Set(expandedSections)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    setExpandedSections(next)
  }

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }

  const handleGenerateScript = () => {
    const hook = selectedHook !== null ? hooks[selectedHook] : hooks[0]
    if (!hook) return
    const event = new CustomEvent('outline-generate-script', {
      detail: { hook, sections, showType },
    })
    window.dispatchEvent(event)
  }

  return (
    <div className="space-y-4">
      {/* Hooks */}
      {hooks.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-amber-500" />
            <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
              Hook Options
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {hooks.map((hook, i) => (
              <button
                key={i}
                onClick={() => setSelectedHook(i)}
                className={cn(
                  'p-3 rounded-lg border text-left transition-all',
                  selectedHook === i
                    ? 'border-indigo-300 bg-indigo-50 dark:bg-indigo-500/10 dark:border-indigo-500/30 ring-1 ring-indigo-200 dark:ring-indigo-500/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                )}
              >
                <p className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 mb-1">
                  HOOK {i + 1}: {hook.name}
                </p>
                <p className="text-xs text-gray-700 dark:text-gray-300 line-clamp-3">
                  {hook.script}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Show Type */}
      {showType && (
        <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-500/10 rounded-lg border border-blue-200 dark:border-blue-500/20">
          <Layers className="w-4 h-4 text-blue-500" />
          <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
            {showType}
          </span>
        </div>
      )}

      {/* Outline Sections */}
      {sections.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">
            Outline
          </h3>
          <div className="space-y-1.5">
            {sections.map((section, i) => {
              const isExpanded = expandedSections.has(i)
              const colorClass = Object.entries(SECTION_COLORS).find(([key]) =>
                section.title.includes(key)
              )?.[1] || 'border-l-gray-300 bg-gray-50/50 dark:bg-gray-800/30'

              return (
                <div
                  key={i}
                  className={cn('border-l-4 rounded-r-lg', colorClass)}
                >
                  <button
                    onClick={() => toggleSection(i)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    )}
                    <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                      {section.title}
                    </span>
                    {section.timestamp && (
                      <span className="text-[10px] text-gray-400 ml-auto">{section.timestamp}</span>
                    )}
                  </button>
                  {isExpanded && (
                    <div className="px-3 pb-2.5 space-y-1">
                      {section.points.map((point, j) => (
                        <p key={j} className="text-xs text-gray-600 dark:text-gray-400 pl-5">
                          {point}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Score */}
      {score && (
        <div className="flex items-center gap-3 px-3 py-2.5 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Score:</div>
          <span className="text-xs font-bold text-gray-900 dark:text-white">{score}</span>
        </div>
      )}

      {/* Jewel */}
      {jewel && (
        <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 dark:bg-amber-500/10 rounded-lg border border-amber-200 dark:border-amber-500/20">
          <span className="text-sm">💎</span>
          <p className="text-xs font-medium text-amber-800 dark:text-amber-300">{jewel}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleGenerateScript}
          className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 transition"
        >
          <Zap className="w-3.5 h-3.5" />
          Generate Full Script
        </button>
        <button
          onClick={() => copyToClipboard(content, 'outline')}
          className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition"
        >
          {copied === 'outline' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied === 'outline' ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}
