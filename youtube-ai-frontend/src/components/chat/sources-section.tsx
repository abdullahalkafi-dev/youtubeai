'use client'

import { ExternalLink, Globe } from 'lucide-react'

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
  if (!sources || sources.length === 0) return null

  return (
    <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700/50">
      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2.5 flex items-center gap-1.5">
        <ExternalLink className="w-3 h-3" />
        Sources ({sources.length})
      </p>
      <div className="space-y-1.5">
        {sources.slice(0, 5).map((source, idx) => (
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
        {sources.length > 5 && (
          <p className="text-[10px] text-gray-400 pl-2">
            +{sources.length - 5} more sources
          </p>
        )}
      </div>
    </div>
  )
}
