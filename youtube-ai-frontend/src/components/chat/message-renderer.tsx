'use client'

import { detectAndParse } from '@/lib/content-detector'
import { SeoCard } from './seo-card'
import { ThumbnailCard } from './thumbnail-card'
import { ScoreCard } from './score-card'
import { ScriptRenderer } from './script-renderer'
import { TrendsCard } from './trends-card'
import { OutlineCard } from './outline-card'
import { MarkdownRenderer } from './markdown-renderer'
import { SourcesSection } from './sources-section'

interface MessageRendererProps {
  content: string
  category: string
  isStreaming?: boolean
  messageId?: string
  messageImages?: any[]
  onStartGenerate?: (conceptTitle: string) => void
  onFinishGenerate?: () => void
}

export function MessageRenderer({ content, category, isStreaming, messageId, messageImages, onStartGenerate, onFinishGenerate }: MessageRendererProps) {
  // During active streaming, render Markdown directly to avoid UI parsing flickers
  if (isStreaming) {
    // Strip trailing incomplete HTML tags like "<span" or "<div" during active stream
    const cleanStreamingContent = content.replace(/<[^>]*$/g, '')
    return <MarkdownRenderer content={cleanStreamingContent} />
  }

  const parsed = detectAndParse(content, category)

  return (
    <div>
      {parsed.type === 'seo' && parsed.seo ? (
        <SeoCard content={parsed.seo} />
      ) : parsed.type === 'thumbnail' && parsed.thumbnails ? (
        <ThumbnailCard
          thumbnails={parsed.thumbnails}
          messageId={messageId}
          messageImages={messageImages}
          onStartGenerate={onStartGenerate}
          onFinishGenerate={onFinishGenerate}
        />
      ) : parsed.type === 'ideas' && parsed.ideaScore ? (
        <div className="space-y-4">
          <ScoreCard score={parsed.ideaScore} />
          <MarkdownRenderer content={parsed.raw} />
        </div>
      ) : parsed.type === 'script' ? (
        <ScriptRenderer content={parsed.raw} />
      ) : parsed.type === 'trends' && parsed.trends ? (
        <TrendsCard trends={parsed.trends} />
      ) : parsed.type === 'outline' ? (
        <OutlineCard content={parsed.raw} />
      ) : (
        <MarkdownRenderer content={parsed.raw} />
      )}

      {/* Sources — shown for any type that has them */}
      {parsed.sources && parsed.sources.length > 0 && !isStreaming && (
        <SourcesSection sources={parsed.sources} />
      )}
    </div>
  )
}
