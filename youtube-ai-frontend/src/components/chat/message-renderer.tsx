'use client'

import { detectAndParse } from '@/lib/content-detector'
import { SeoCard } from './seo-card'
import { ThumbnailCard } from './thumbnail-card'
import { SceneCard } from './scene-card'
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
  onEditImage?: (url: string, mode: 'thumbnail' | 'scene') => void
  videoTitle?: string
  threadTitle?: string
}

export function MessageRenderer({ content, category, isStreaming, messageId, messageImages, onStartGenerate, onFinishGenerate, onEditImage, videoTitle, threadTitle }: MessageRendererProps) {
  // During active streaming, render Markdown directly to avoid UI parsing flickers
  if (isStreaming) {
    // Strip trailing incomplete HTML tags like "<span" or "<div" during active stream
    const rawContent = typeof content === 'string' ? content : ''
    const cleanStreamingContent = rawContent.replace(/<[^>]*$/g, '')
    return <MarkdownRenderer content={cleanStreamingContent} />
  }

  if (!content || typeof content !== 'string') return <MarkdownRenderer content="" />

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
          onEditImage={(url) => onEditImage?.(url, 'thumbnail')}
          videoTitle={videoTitle}
          threadTitle={threadTitle}
        />
      ) : parsed.type === 'image' && parsed.sceneConcepts ? (
        <SceneCard
          concepts={parsed.sceneConcepts}
          messageId={messageId}
          messageImages={messageImages}
          onStartGenerate={onStartGenerate}
          onFinishGenerate={onFinishGenerate}
          onEditImage={(url) => onEditImage?.(url, 'scene')}
          videoTitle={videoTitle}
          threadTitle={threadTitle}
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
