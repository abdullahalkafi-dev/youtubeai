'use client'

import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Play, ExternalLink, ShieldCheck, Maximize2, X, Image as ImageIcon } from 'lucide-react'

interface MarkdownRendererProps {
  content: string
}

function extractYouTubeId(url: string): string | null {
  if (!url) return null
  const regExp = /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/i
  const match = url.match(regExp)
  return match && match[1].length === 11 ? match[1] : null
}

function YouTubeCard({ url, title, videoId }: { url: string; title?: string; videoId: string }) {
  const [isPlaying, setIsPlaying] = useState(false)
  const thumbUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`

  if (isPlaying) {
    return (
      <div className="my-3 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800 shadow-lg bg-black aspect-video relative">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1`}
          title={title || 'YouTube video'}
          className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
        <button
          onClick={() => setIsPlaying(false)}
          className="absolute top-2 right-2 p-1.5 rounded-full bg-black/70 hover:bg-black text-white text-xs transition"
          title="Close player"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm hover:shadow-md transition group max-w-lg">
      <div className="relative aspect-video bg-gray-950 overflow-hidden cursor-pointer" onClick={() => setIsPlaying(true)}>
        <img
          src={thumbUrl}
          alt={title || 'YouTube video thumbnail'}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src = `https://img.youtube.com/vi/${videoId}/0.jpg`
          }}
        />
        <div className="absolute inset-0 bg-black/25 group-hover:bg-black/40 transition-colors flex items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-red-600/90 text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
            <Play className="w-5 h-5 fill-current ml-0.5" />
          </div>
        </div>
      </div>
      <div className="p-3 flex items-center justify-between gap-3 bg-gray-50/70 dark:bg-gray-800/40">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">
            {title && title !== url ? title : 'YouTube Video Reference'}
          </p>
          <span className="text-[10px] text-gray-500 dark:text-gray-400">Click to play in chat</span>
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 flex items-center gap-1 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline px-2 py-1 rounded bg-indigo-50 dark:bg-indigo-950/50"
        >
          Watch on YouTube <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  )
}

function ImageLightbox({ src, alt }: { src: string; alt?: string }) {
  const [isOpen, setIsOpen] = useState(false)
  const [hasError, setHasError] = useState(false)

  if (hasError) {
    return (
      <div className="my-2 p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 flex items-center gap-2 text-xs text-gray-500">
        <ImageIcon className="w-4 h-4 text-gray-400 shrink-0" />
        <span className="truncate">{alt || 'Image source'}</span>
      </div>
    )
  }

  return (
    <>
      <figure className="my-3 max-w-lg">
        <div
          onClick={() => setIsOpen(true)}
          className="relative rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800 bg-gray-950 shadow-sm hover:shadow-md transition cursor-pointer group"
        >
          <img
            src={src}
            alt={alt || 'News/Subject image'}
            className="w-full max-h-80 object-cover group-hover:scale-102 transition duration-300"
            onError={() => setHasError(true)}
            loading="lazy"
          />
          <div className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-white/80 opacity-0 group-hover:opacity-100 transition shadow">
            <Maximize2 className="w-3.5 h-3.5" />
          </div>
        </div>
        {alt && (
          <figcaption className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5 px-1 italic">
            {alt}
          </figcaption>
        )}
      </figure>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        >
          <div className="relative max-w-4xl max-h-[90vh] bg-transparent flex flex-col items-center">
            <button
              onClick={() => setIsOpen(false)}
              className="absolute -top-10 right-0 p-2 text-white/80 hover:text-white rounded-full transition"
            >
              <X className="w-6 h-6" />
            </button>
            <img
              src={src}
              alt={alt || 'Full preview'}
              className="max-h-[85vh] max-w-full object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            {alt && (
              <p className="text-xs text-white/90 mt-2 text-center bg-black/50 px-3 py-1 rounded-full">
                {alt}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  )
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  if (!content || typeof content !== 'string') return null

  return (
    <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold prose-headings:text-gray-900 dark:prose-headings:text-white prose-p:text-gray-700 dark:prose-p:text-gray-300 prose-p:leading-relaxed prose-p:text-xs prose-strong:text-gray-800 dark:prose-strong:text-gray-200 prose-li:text-xs prose-li:text-gray-700 dark:prose-li:text-gray-300 prose-a:text-indigo-600 dark:prose-a:text-indigo-400 prose-a:no-underline hover:prose-a:underline prose-blockquote:border-l-indigo-300 dark:prose-blockquote:border-l-indigo-600 prose-blockquote:text-gray-600 dark:prose-blockquote:text-gray-400 prose-code:text-xs prose-code:bg-gray-100 dark:prose-code:bg-gray-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:font-normal prose-code:before:content-none prose-code:after:content-none prose-hr:border-gray-200 dark:prose-hr:border-gray-700">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-base font-bold text-gray-900 dark:text-white mb-2 mt-4 first:mt-0">{children}</h1>,
          h2: ({ children }) => {
            const str = String(children || '')
            if (/verified legal|custody status/i.test(str)) {
              return (
                <div className="flex items-center gap-1.5 text-sm font-bold text-emerald-600 dark:text-emerald-400 mb-1.5 mt-4 p-2 bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 rounded-lg">
                  <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>{children}</span>
                </div>
              )
            }
            return <h2 className="text-sm font-bold text-gray-900 dark:text-white mb-1.5 mt-3 first:mt-0">{children}</h2>
          },
          h3: ({ children }) => {
            const str = String(children || '')
            if (/verified legal|custody status/i.test(str)) {
              return (
                <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400 mb-1.5 mt-3 p-2 bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 rounded-lg">
                  <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>{children}</span>
                </div>
              )
            }
            return <h3 className="text-xs font-bold text-gray-800 dark:text-gray-200 mb-1 mt-2.5 first:mt-0">{children}</h3>
          },
          p: ({ children }) => <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="text-xs text-gray-700 dark:text-gray-300 space-y-1 mb-2 pl-4 list-disc">{children}</ul>,
          ol: ({ children }) => <ol className="text-xs text-gray-700 dark:text-gray-300 space-y-1 mb-2 pl-4 list-decimal">{children}</ol>,
          li: ({ children }) => <li className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-gray-800 dark:text-gray-200">{children}</strong>,
          em: ({ children }) => <em className="italic text-gray-600 dark:text-gray-400">{children}</em>,
          img: ({ src, alt }) => {
            if (!src || typeof src !== 'string') return null
            return <ImageLightbox src={src} alt={alt} />
          },
          a: ({ href, children }) => {
            if (!href) return <span>{children}</span>
            const ytId = extractYouTubeId(href)
            if (ytId) {
              const textContent = typeof children === 'string' ? children : undefined
              return <YouTubeCard url={href} title={textContent} videoId={ytId} />
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 hover:underline">
                {children}
              </a>
            )
          },
          blockquote: ({ children }) => (
            <blockquote className="border-l-3 border-indigo-300 dark:border-indigo-600 pl-3 py-1 my-2 text-xs text-gray-600 dark:text-gray-400 italic">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-gray-200 dark:border-gray-700" />,
          table: ({ children }) => (
            <div className="overflow-x-auto my-2">
              <table className="w-full text-xs border-collapse">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="text-left text-xs font-semibold text-gray-600 dark:text-gray-400 px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="text-xs text-gray-700 dark:text-gray-300 px-3 py-2 border-b border-gray-100 dark:border-gray-800">
              {children}
            </td>
          ),
          del: ({ children }) => <del className="line-through text-gray-400 dark:text-gray-500">{children}</del>,
          input: ({ checked, ...props }) => (
            <input
              type="checkbox"
              checked={checked}
              readOnly
              className="mr-1.5 rounded border-gray-300 dark:border-gray-600"
              {...props}
            />
          ),
        }}
      >
        {content}
      </Markdown>
    </div>
  )
}
