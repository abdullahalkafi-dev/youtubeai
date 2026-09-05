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
  threadId?: string
  initialScriptId?: string
  messageImages?: any[]
  onStartGenerate?: (conceptTitle: string) => void
  onFinishGenerate?: () => void
  onEditImage?: (
    url: string,
    mode: 'thumbnail' | 'scene',
    cleanUrl?: string,
    selectedHostImage?: string,
    aspectRatio?: '16:9' | '9:16',
    textOverlay?: string,
    visualDescription?: string,
  ) => void
  videoTitle?: string
  threadTitle?: string
}

function resolveTopicHeadline(content: string, videoTitle?: string, threadTitle?: string): string {
  if (videoTitle && !/^(?:today'?s\s+video\s+topic\s+ideas|new\s+thread|video\s+topic\s+ideas)$/i.test(videoTitle.trim())) {
    return videoTitle.trim();
  }
  const scriptTitleMatch = content.match(/^(?:#+\s*)SCRIPT TITLE:\s*([^\n\r]+)/im);
  if (scriptTitleMatch && scriptTitleMatch[1]?.trim()) {
    return scriptTitleMatch[1].trim();
  }
  const topicMatch = content.match(/(?:(?:make\s+this\s+video\s+today|video\s+topic|topic|case|story|episode):\s*([^\n\r\*#]+))/im);
  if (topicMatch && topicMatch[1]?.trim()) {
    return topicMatch[1].trim();
  }
  if (threadTitle && !/^(?:today'?s\s+video\s+topic\s+ideas|new\s+thread)$/i.test(threadTitle.trim())) {
    return threadTitle.replace(/^Script:\s*/i, '').trim();
  }
  return videoTitle || threadTitle || '';
}

export function MessageRenderer({
  content,
  category,
  isStreaming,
  messageId,
  threadId,
  initialScriptId,
  messageImages,
  onStartGenerate,
  onFinishGenerate,
  onEditImage,
  videoTitle,
  threadTitle,
}: MessageRendererProps) {
  // During active streaming, render Markdown directly to avoid UI parsing flickers
  if (isStreaming) {
    // Strip script delimiters and trailing incomplete HTML tags like "<span" or "<div" during active stream
    const rawContent = typeof content === 'string' ? content : ''
    const cleanStreamingContent = rawContent
      .replace(/<!--\s*SCRIPT_(?:START|END)?\s*-->?/gi, '')
      .replace(/<<<\/?SCRIPT_(?:START|END)?>>>?/gi, '')
      .replace(/<[^>]*$/g, '')
    return <MarkdownRenderer content={cleanStreamingContent} />
  }

  if (!content || typeof content !== 'string') return <MarkdownRenderer content="" />

  const effectiveTopic = resolveTopicHeadline(content, videoTitle, threadTitle);
  const parsed = detectAndParse(content, category)

  return (
    <div>
      {parsed.blocks && parsed.blocks.length > 1 ? (
        <div className="space-y-6">
          {parsed.blocks.map((block, idx) => {
            switch (block.type) {
              case 'markdown':
                return <MarkdownRenderer key={idx} content={block.content} />
              case 'thumbnail':
                return (
                  <ThumbnailCard
                    key={idx}
                    thumbnails={block.thumbnails}
                    messageId={messageId}
                    messageImages={messageImages}
                    onStartGenerate={onStartGenerate}
                    onEditImage={(url, cleanUrl, hostImg, aspectRatio, textOverlay, visualDescription) =>
                      onEditImage?.(url, 'thumbnail', cleanUrl, hostImg, aspectRatio, textOverlay, visualDescription)}
                    videoTitle={effectiveTopic}
                    threadTitle={threadTitle}
                  />
                )
              case 'script':
                return (
                  <ScriptRenderer
                    key={idx}
                    content={block.scriptContent}
                    threadId={threadId}
                    messageId={messageId}
                    initialScriptId={initialScriptId}
                    threadTitle={threadTitle}
                    videoTitle={effectiveTopic}
                  />
                )
              case 'seo':
                return <SeoCard key={idx} content={block.seo} />
              case 'ideas':
                return <ScoreCard key={idx} score={block.ideaScore} />
              case 'scene':
                return (
                  <SceneCard
                    key={idx}
                    concepts={block.sceneConcepts}
                    messageId={messageId}
                    messageImages={messageImages}
                    onStartGenerate={onStartGenerate}
                    onFinishGenerate={onFinishGenerate}
                    onEditImage={(url) => onEditImage?.(url, 'scene', url, undefined, '16:9')}
                    videoTitle={effectiveTopic}
                    threadTitle={threadTitle}
                  />
                )
              case 'trends':
                return <TrendsCard key={idx} trends={block.trends} />
              case 'outline':
                return <OutlineCard key={idx} content={block.content} />
              default:
                return null
            }
          })}

          {!parsed.blocks.some((b) => b.type === 'thumbnail' || b.type === 'scene') && messageImages && messageImages.length > 0 && (
            <div className="mt-3 space-y-3">
              {messageImages.map((img: any, idx: number) => (
                <div key={img.id || idx} className="rounded-xl overflow-hidden border border-indigo-200 dark:border-indigo-800/50 bg-white dark:bg-gray-900 shadow-md">
                  <div className={`relative bg-gray-950 overflow-hidden ${
                    img.aspectRatio === '9:16' ? 'aspect-[9/16] max-w-[280px] mx-auto' : 'aspect-video'
                  }`}>
                    <img
                      src={formatAssetUrl(img.url)}
                      alt={img.prompt || 'Generated image'}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className="p-3 bg-gray-50/80 dark:bg-gray-800/40 flex items-center justify-between gap-2 border-t border-gray-100 dark:border-gray-800">
                    <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1 flex-1">
                      {img.prompt}
                    </p>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => onEditImage?.(img.url, img.mode || 'thumbnail', img.cleanBackgroundUrl, img.selectedHostImage, img.aspectRatio || '16:9', img.textOverlay, img.visualDescription)}
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
        </div>
      ) : parsed.type === 'seo' && parsed.seo ? (
        <SeoCard content={parsed.seo} />
      ) : parsed.type === 'thumbnail' && parsed.thumbnails ? (
        <ThumbnailCard
          thumbnails={parsed.thumbnails}
          messageId={messageId}
          messageImages={messageImages}
          onStartGenerate={onStartGenerate}
          onEditImage={(url, cleanUrl, hostImg, aspectRatio, textOverlay, visualDescription) =>
            onEditImage?.(url, 'thumbnail', cleanUrl, hostImg, aspectRatio, textOverlay, visualDescription)}
          videoTitle={effectiveTopic}
          threadTitle={threadTitle}
        />
      ) : parsed.type === 'image' && parsed.sceneConcepts ? (
        <SceneCard
          concepts={parsed.sceneConcepts}
          messageId={messageId}
          messageImages={messageImages}
          onStartGenerate={onStartGenerate}
          onFinishGenerate={onFinishGenerate}
          onEditImage={(url) => onEditImage?.(url, 'scene', url, undefined, '16:9')}
          videoTitle={effectiveTopic}
          threadTitle={threadTitle}
        />
      ) : parsed.type === 'ideas' && parsed.ideaScore ? (
        <div className="space-y-4">
          <ScoreCard score={parsed.ideaScore} />
          <MarkdownRenderer content={parsed.raw} />
        </div>
      ) : parsed.type === 'modular_package' ? (
        <div className="space-y-6">
          {parsed.preamble && (
            <div className="rounded-2xl bg-zinc-50/70 dark:bg-zinc-900/40 p-5 border border-zinc-200/60 dark:border-zinc-800/60 space-y-3">
              <div className="flex items-center space-x-2 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                <span>Production Strategy & Metadata</span>
              </div>
              <MarkdownRenderer content={parsed.preamble} />
            </div>
          )}

          {parsed.teleprompterScript && (
            <ScriptRenderer
              content={parsed.teleprompterScript}
              threadId={threadId}
              messageId={messageId}
              initialScriptId={initialScriptId}
              threadTitle={threadTitle}
              videoTitle={effectiveTopic}
            />
          )}

          {parsed.postamble && (
            <div className="rounded-2xl bg-zinc-50/70 dark:bg-zinc-900/40 p-5 border border-zinc-200/60 dark:border-zinc-800/60 space-y-3">
              <div className="flex items-center space-x-2 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                <span>Distribution & SEO Package</span>
              </div>
              <MarkdownRenderer content={parsed.postamble} />
            </div>
          )}
        </div>
      ) : parsed.type === 'script' ? (
        <ScriptRenderer
          content={parsed.raw}
          threadId={threadId}
          messageId={messageId}
          initialScriptId={initialScriptId}
          threadTitle={threadTitle}
          videoTitle={effectiveTopic}
        />
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
                  <div className={`relative bg-gray-950 overflow-hidden ${
                    img.aspectRatio === '9:16' ? 'aspect-[9/16] max-w-[280px] mx-auto' : 'aspect-video'
                  }`}>
                    <img
                      src={formatAssetUrl(img.url)}
                      alt={img.prompt || 'Generated image'}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className="p-3 bg-gray-50/80 dark:bg-gray-800/40 flex items-center justify-between gap-2 border-t border-gray-100 dark:border-gray-800">
                    <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1 flex-1">
                      {img.prompt}
                    </p>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => onEditImage?.(img.url, img.mode || 'thumbnail', img.cleanBackgroundUrl, img.selectedHostImage, img.aspectRatio || '16:9', img.textOverlay, img.visualDescription)}
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
