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
import { formatAssetUrl } from '@/lib/api'
import { Wand2, ExternalLink } from 'lucide-react'

interface MessageRendererProps {
  content: string
  category: string
  isStreaming?: boolean
  messageId?: string
  messageImages?: any[]
  onStartGenerate?: (conceptTitle: string) => void
  onFinishGenerate?: () => void
  onEditImage?: (url: string, mode: 'thumbnail' | 'scene', cleanUrl?: string) => void
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
          onEditImage={(url, cleanUrl) => onEditImage?.(url, 'thumbnail', cleanUrl)}
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
        <>
          <MarkdownRenderer content={parsed.raw} />
          {messageImages && messageImages.length > 0 && (
            <div className="mt-3 space-y-3">
              {messageImages.map((img: any, idx: number) => (
                <div key={img.id || idx} className="rounded-xl overflow-hidden border border-indigo-200 dark:border-indigo-800/50 bg-white dark:bg-gray-900 shadow-md">
                  <div className="relative aspect-video bg-gray-950 overflow-hidden">
                    <img
                      src={formatAssetUrl(img.url)}
                      alt={img.prompt || 'Generated image'}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="p-3 bg-gray-50/80 dark:bg-gray-800/40 flex items-center justify-between gap-2 border-t border-gray-100 dark:border-gray-800">
                    <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1 flex-1">
                      {img.prompt}
                    </p>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => onEditImage?.(img.url, img.mode || 'thumbnail', img.cleanBackgroundUrl)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 text-xs font-semibold shadow-sm transition"
                      >
                        <Wand2 className="w-3.5 h-3.5 text-indigo-500" /> Edit / Iterate
                      </button>
                      <a
                        href={formatAssetUrl(img.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 text-xs font-semibold shadow-sm transition"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-gray-400" /> Full View
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Sources — shown for any type that has them */}
      {parsed.sources && parsed.sources.length > 0 && !isStreaming && (
        <SourcesSection sources={parsed.sources} />
      )}
    </div>
  )
}
