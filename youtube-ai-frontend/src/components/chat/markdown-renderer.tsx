'use client'

import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownRendererProps {
  content: string
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  if (!content || typeof content !== 'string') return null
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold prose-headings:text-gray-900 dark:prose-headings:text-white prose-p:text-gray-700 dark:prose-p:text-gray-300 prose-p:leading-relaxed prose-p:text-xs prose-strong:text-gray-800 dark:prose-strong:text-gray-200 prose-li:text-xs prose-li:text-gray-700 dark:prose-li:text-gray-300 prose-a:text-indigo-600 dark:prose-a:text-indigo-400 prose-a:no-underline hover:prose-a:underline prose-blockquote:border-l-indigo-300 dark:prose-blockquote:border-l-indigo-600 prose-blockquote:text-gray-600 dark:prose-blockquote:text-gray-400 prose-code:text-xs prose-code:bg-gray-100 dark:prose-code:bg-gray-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:font-normal prose-code:before:content-none prose-code:after:content-none prose-hr:border-gray-200 dark:prose-hr:border-gray-700">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-base font-bold text-gray-900 dark:text-white mb-2 mt-4 first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-bold text-gray-900 dark:text-white mb-1.5 mt-3 first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="text-xs font-bold text-gray-800 dark:text-gray-200 mb-1 mt-2.5 first:mt-0">{children}</h3>,
          p: ({ children }) => <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="text-xs text-gray-700 dark:text-gray-300 space-y-1 mb-2 pl-4 list-disc">{children}</ul>,
          ol: ({ children }) => <ol className="text-xs text-gray-700 dark:text-gray-300 space-y-1 mb-2 pl-4 list-decimal">{children}</ol>,
          li: ({ children }) => <li className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-gray-800 dark:text-gray-200">{children}</strong>,
          em: ({ children }) => <em className="italic text-gray-600 dark:text-gray-400">{children}</em>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 hover:underline">
              {children}
            </a>
          ),
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
