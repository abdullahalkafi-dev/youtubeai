'use client'

import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Copy, Check, FileText, Diamond } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface ScriptRendererProps {
  content: string
}

function parseScriptSections(content: string): Array<{ header: string; body: string; isJewel: boolean }> {
  const sections: Array<{ header: string; body: string; isJewel: boolean }> = []

  // Split by ## or # headers or bold line headers
  const parts = content.split(/(?=^#{1,3}\s+|^(?:\*\*)?(?:COLD OPEN|WHAT HAPPENED|UNIQUE MECCA BREAKDOWN|THE HUMAN COST|THE YOUTH WARNING|FINAL JEWEL))/gm)

  for (const part of parts) {
    const headerMatch = part.match(/^(?:#{1,3}\s+|\*\*)?(.+?)(?:\*\*)?$/m)
    if (headerMatch) {
      let rawHeader = headerMatch[1].trim()
      // Strip markdown bold asterisks, hashtags, and quotes from section title
      const header = rawHeader
        .replace(/^[\*\#\"\']+|[\*\#\"\']+$/g, '')
        .replace(/\*\*/g, '')
        .trim()

      const body = part.replace(/^(?:#{1,3}\s+|\*\*)?.+?(?:\*\*)?\n/, '').trim()

      // Check if this is a sources section or conversational line
      if (header.toLowerCase().includes('sources')) {
        continue
      }

      sections.push({
        header,
        body,
        isJewel: false,
      })
    } else if (part.trim() && sections.length > 0) {
      // Append to previous section
      sections[sections.length - 1].body += '\n\n' + part.trim()
    }
  }

  // If no sections found, treat as single block
  if (sections.length === 0 && content.trim()) {
    sections.push({ header: '', body: content, isJewel: false })
  }

  return sections
}

function getSectionColor(header: string): string {
  const lower = header.toLowerCase()
  if (lower.includes('cold open')) return 'border-l-red-400 bg-red-50/50 dark:bg-red-500/5'
  if (lower.includes('what happened')) return 'border-l-blue-400 bg-blue-50/50 dark:bg-blue-500/5'
  if (lower.includes('breakdown')) return 'border-l-amber-400 bg-amber-50/50 dark:bg-amber-500/5'
  if (lower.includes('human cost')) return 'border-l-purple-400 bg-purple-50/50 dark:bg-purple-500/5'
  if (lower.includes('youth warning')) return 'border-l-emerald-400 bg-emerald-50/50 dark:bg-emerald-500/5'
  if (lower.includes('jewel') || lower.includes('final')) return 'border-l-amber-500 bg-amber-50/50 dark:bg-amber-500/5'
  return 'border-l-gray-300 bg-gray-50/50 dark:bg-gray-500/5'
}

function renderInlineMarkdown(text: string): React.ReactNode {
  // Use react-markdown for proper inline markdown rendering (bold, italic, links, etc.)
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <>{children}</>,
        strong: ({ children }) => <strong className="font-semibold text-gray-800 dark:text-gray-200">{children}</strong>,
        em: ({ children }) => <em className="italic text-gray-600 dark:text-gray-400">{children}</em>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 hover:underline">
            {children}
          </a>
        ),
        del: ({ children }) => <del className="line-through text-gray-400">{children}</del>,
        code: ({ children }) => (
          <code className="text-[10px] bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded font-normal">
            {children}
          </code>
        ),
      }}
    >
      {text}
    </Markdown>
  )
}

function renderLine(line: string): React.ReactNode {
  // Check for jewel lines
  if (line.includes('💎 JEWEL:') || line.includes('💎JEWEL:') || line.match(/^\*\*💎\s*JEWEL/i)) {
    const jewelText = line.replace(/💎\s*JEWEL:\s*/i, '').replace(/\*\*/g, '').trim()
    return (
      <div className="flex items-start gap-2 my-2 p-2.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-lg">
        <Diamond className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">{renderInlineMarkdown(jewelText)}</span>
      </div>
    )
  }

  // Check for timestamp lines
  const timestampMatch = line.match(/^\[(\d+:\d+(?::\d+)?)\]/)
  if (timestampMatch) {
    return (
      <div className="flex items-start gap-2">
        <span className="text-[10px] font-mono text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded shrink-0">
          {timestampMatch[1]}
        </span>
        <span className="text-xs text-gray-700 dark:text-gray-300">{renderInlineMarkdown(line.replace(/^\[\d+:\d+(?::\d+)?\]\s*/, ''))}</span>
      </div>
    )
  }

  // All other lines — render through react-markdown for proper inline formatting
  return <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{renderInlineMarkdown(line)}</p>
}

export function ScriptRenderer({ content }: ScriptRendererProps) {
  const [copied, setCopied] = useState(false)

  const sections = parseScriptSections(content)

  const handleCopyScript = async () => {
    try {
      // Extract ONLY the pure script body (from first section to end of script/Q&A)
      // Exclude conversational AI intro e.g. "Absolutely — here's a fresh..." and outro e.g. "If you want I can also turn this..."
      let pureScript = sections.map(sec => {
        const cleanHead = sec.header ? `\n\n${sec.header.toUpperCase()}\n` : ''
        const cleanBody = sec.body
          .replace(/## /g, '')
          .replace(/\*\*/g, '')
          .trim()
        return `${cleanHead}${cleanBody}`
      }).join('\n').trim()

      await navigator.clipboard.writeText(pureScript)
      setCopied(true)
      toast.success('Teleprompter script copied!')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Failed to copy')
    }
  }

  return (
    <div className="space-y-3">
      {/* Copy Script Button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-semibold">
          <FileText className="w-3.5 h-3.5" />
          Video Script
        </div>
        <button
          onClick={handleCopyScript}
          className="text-[10px] text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 font-medium flex items-center gap-1 transition"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          Copy Script
        </button>
      </div>

      {/* Script Sections */}
      {sections.map((section, idx) => (
        <div
          key={idx}
          className={cn(
            'border-l-4 rounded-r-xl p-3.5',
            getSectionColor(section.header)
          )}
        >
          {section.header && (
            <h4 className="text-xs font-bold text-gray-800 dark:text-gray-200 mb-2 uppercase tracking-wide">
              {section.header}
            </h4>
          )}
          <div className="space-y-1">
            {section.body.split('\n').filter(Boolean).map((line, lineIdx) => (
              <div key={lineIdx}>{renderLine(line)}</div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
