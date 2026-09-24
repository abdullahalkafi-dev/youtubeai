'use client'

import { useState } from 'react'
import { ExternalLink, ChevronDown, ChevronRight } from 'lucide-react'

interface Source {
  title: string
  url: string
}

interface SourcesSectionProps {
  sources: Source[]
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '')
  } catch {
    return url
  }
}

function getFaviconUrl(url: string): string {
  try {
    const domain = new URL(url).hostname
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`
  } catch {
    return ''
  }
}

export function SourcesSection({ sources }: SourcesSectionProps) {
  const [expanded, setExpanded] = useState(false)
  if (!sources || sources.length === 0) return null

  const visible = expanded ? sources : sources.slice(0, 5)

  return (
    <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700/50">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2.5 hover:text-indigo-600 dark:hover:text-indigo-300 transition"
      >
        <ExternalLink className="w-3 h-3" />
        Sources ({sources.length})
        {expanded ? <ChevronDown className="w-3.5 h-3.5 ml-auto" /> : <ChevronRight className="w-3.5 h-3.5 ml-auto" />}
      </button>
      <div className="space-y-1.5">
        {visible.map((source, idx) => (
          <a
            key={idx}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 text-xs px-2.5 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/50 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition group"
          >
            <img
              src={getFaviconUrl(source.url)}
              alt=""
              className="w-4 h-4 rounded-sm shrink-0"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none'
              }}
            />
            <span className="truncate flex-1 text-gray-700 dark:text-gray-300 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition">
              {source.title}
            </span>
            <span className="text-[10px] text-gray-400 shrink-0 hidden sm:inline">
              {getDomain(source.url)}
            </span>
          </a>
        ))}
        {!expanded && sources.length > 5 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-[11px] text-indigo-600 dark:text-indigo-400 pl-2 hover:underline"
          >
            Show {sources.length - 5} more sources
          </button>
        )}
      </div>
    </div>
  )
}
