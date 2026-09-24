'use client'

import { useState } from 'react'
import { Copy, Check, Package } from 'lucide-react'
import { toast } from 'sonner'

interface KitBlock {
  key: string
  label: string
  body: string
}

function extractKitBlocks(content: string): KitBlock[] {
  if (!content || !/repackage kit/i.test(content)) return []

  const kitStart = content.search(/##\s*REPACKAGE KIT/i)
  if (kitStart < 0) return []
  const kit = content.slice(kitStart)

  const blocks: KitBlock[] = []

  const grab = (key: string, label: string, startRe: RegExp, endRe: RegExp) => {
    const startMatch = kit.match(startRe)
    if (!startMatch || startMatch.index == null) return
    const from = startMatch.index + startMatch[0].length
    const rest = kit.slice(from)
    const endMatch = rest.match(endRe)
    const body = (endMatch && endMatch.index != null ? rest.slice(0, endMatch.index) : rest).trim()
    if (body) blocks.push({ key, label, body })
  }

  grab('title', 'Title', /###\s*TITLE\b[^\n]*\n/i, /\n###\s+/i)
  grab('description', 'Description', /###\s*DESCRIPTION\b[^\n]*\n/i, /\n###\s+/i)
  grab('tags', 'Tags', /###\s*TAGS\b[^\n]*\n/i, /\n###\s+/i)
  grab('hashtags', 'Hashtags', /###\s*HASHTAGS\b[^\n]*\n/i, /\n###\s+/i)

  const bundleMatch = kit.match(/###\s*COPY BUNDLE[\s\S]*?```([\s\S]*?)```/i)
  if (bundleMatch?.[1]?.trim()) {
    blocks.push({ key: 'bundle', label: 'Copy full package', body: bundleMatch[1].trim() })
  }

  return blocks
}

export function RepackageKitSection({ content }: { content: string }) {
  const blocks = extractKitBlocks(content)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  if (blocks.length === 0) return null

  const handleCopy = async (block: KitBlock) => {
    try {
      await navigator.clipboard.writeText(block.body)
      setCopiedKey(block.key)
      toast.success(`${block.label} copied`)
      setTimeout(() => setCopiedKey(null), 2000)
    } catch {
      toast.error('Failed to copy')
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-indigo-200/60 dark:border-indigo-500/20 bg-indigo-50/40 dark:bg-indigo-500/5 p-3">
      <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 mb-2 flex items-center gap-1.5">
        <Package className="w-3.5 h-3.5" />
        Repackage kit — copy into YouTube Studio
      </p>
      <div className="flex flex-wrap gap-2">
        {blocks.map((b) => (
          <button
            key={b.key}
            type="button"
            onClick={() => handleCopy(b)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:border-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition"
          >
            {copiedKey === b.key ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            {b.label}
          </button>
        ))}
      </div>
    </div>
  )
}
