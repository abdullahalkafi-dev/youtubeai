'use client'

import React from 'react'
import { ExternalLink, Play } from 'lucide-react'

interface FormattedDescriptionProps {
  text: string
  className?: string
}

interface Segment {
  type: 'text' | 'link'
  content: string
  url?: string
}

/**
 * Parses raw text containing URLs or markdown links into structured segments.
 */
function parseTextWithLinks(rawText: string): Segment[] {
  if (!rawText) return []

  const segments: Segment[] = []
  // Regex to match Markdown links [text](url) OR raw URLs (https?://[^\s]+)
  const combinedRegex = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)|(https?:\/\/[^\s]+)/g

  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = combinedRegex.exec(rawText)) !== null) {
    // Push preceding text segment if any
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        content: rawText.slice(lastIndex, match.index),
      })
    }

    if (match[1] && match[2]) {
      // Markdown link: [match[1]](match[2])
      segments.push({
        type: 'link',
        content: match[1],
        url: match[2],
      })
    } else if (match[3]) {
      // Raw URL: match[3]
      let url = match[3]
      let trailingPunctuation = ''

      // Clean trailing punctuation like period, comma, closing parenthesis
      const punctMatch = url.match(/[.,;:)]+$/)
      if (punctMatch) {
        trailingPunctuation = punctMatch[0]
        url = url.slice(0, -trailingPunctuation.length)
      }

      segments.push({
        type: 'link',
        content: url,
        url: url,
      })

      if (trailingPunctuation) {
        segments.push({
          type: 'text',
          content: trailingPunctuation,
        })
      }
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < rawText.length) {
    segments.push({
      type: 'text',
      content: rawText.slice(lastIndex),
    })
  }

  return segments
}

export function FormattedDescription({ text, className = '' }: FormattedDescriptionProps) {
  const segments = React.useMemo(() => parseTextWithLinks(text), [text])

  if (!text) return null

  return (
    <span className={`whitespace-pre-wrap leading-relaxed ${className}`}>
      {segments.map((seg, idx) => {
        if (seg.type === 'link' && seg.url) {
          const isYouTube = seg.url.includes('youtube.com') || seg.url.includes('youtu.be')
          const href = seg.url.startsWith('http://') || seg.url.startsWith('https://') ? seg.url : `https://${seg.url}`
          return (
            <a
              key={idx}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={`inline-flex items-center gap-1 font-semibold underline underline-offset-2 transition mx-0.5 rounded px-1 py-0.5 ${
                isYouTube
                  ? 'text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 bg-red-500/10 hover:bg-red-500/20'
                  : 'text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20'
              }`}
              title={`Open link: ${seg.url}`}
            >
              {isYouTube ? (
                <Play className="w-3 h-3 fill-current shrink-0" />
              ) : (
                <ExternalLink className="w-3 h-3 shrink-0" />
              )}
              <span className="break-all">{seg.content}</span>
            </a>
          )
        }
        return <React.Fragment key={idx}>{seg.content}</React.Fragment>
      })}
    </span>
  )
}
