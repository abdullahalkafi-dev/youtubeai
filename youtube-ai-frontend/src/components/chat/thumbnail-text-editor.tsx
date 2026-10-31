'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, Plus, X } from 'lucide-react'

const MAX_LINES = 4
const MAX_LINE_CHARS = 40

/** The thumbnail's words as separate lines: the headline uses " / " between lines. */
export function headlineToLines(text?: string): string[] {
  const lines = (text || '')
    .split(/\n|\s+\/\s+/)
    .map((l) => l.trim())
    .filter(Boolean)
  return lines.length ? lines.slice(0, MAX_LINES) : ['']
}

interface ThumbnailTextEditorProps {
  /** The words on the thumbnail now (lines separated by " / "). */
  currentText?: string
  busy: boolean
  /** New words, one entry per line, and optionally a new photo of the person. */
  onChangeWords: (lines: string[], photo: File | null) => void
}

/**
 * Type the new words for a finished thumbnail, one box per line: three lines can become one, one can
 * become three. The picture stays the same (the AI changes only the lettering); an optional new photo
 * replaces the person. The result keeps the old thumbnail in the chat.
 */
export function ThumbnailTextEditor({ currentText, busy, onChangeWords }: ThumbnailTextEditorProps) {
  const [lines, setLines] = useState<string[]>(() => headlineToLines(currentText))
  const [photo, setPhoto] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // A different thumbnail was picked: start from its words.
  useEffect(() => {
    setLines(headlineToLines(currentText))
    setPhoto(null)
  }, [currentText])

  const filled = lines.map((l) => l.trim()).filter(Boolean)
  const setLine = (i: number, value: string) => setLines((prev) => prev.map((l, k) => (k === i ? value : l)))
  const removeLine = (i: number) => setLines((prev) => (prev.length > 1 ? prev.filter((_, k) => k !== i) : ['']))

  return (
    <div className="flex flex-col gap-1.5 pt-1 border-t border-pink-200/50 dark:border-pink-500/20 text-[10px]">
      <p className="font-semibold text-pink-700 dark:text-pink-300">Words on the thumbnail (one box per line)</p>
      {lines.map((line, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="w-9 shrink-0 text-gray-500 dark:text-gray-400">Line {i + 1}</span>
          <input
            type="text"
            value={line}
            maxLength={MAX_LINE_CHARS}
            disabled={busy}
            onChange={(e) => setLine(i, e.target.value)}
            placeholder={i === 0 ? 'First line' : 'Next line'}
            className="flex-1 min-w-0 px-2 py-1 rounded-md bg-white dark:bg-gray-800 border border-pink-200 dark:border-pink-500/30 text-gray-800 dark:text-gray-100 text-[11px] uppercase focus:outline-none focus:ring-1 focus:ring-pink-400 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => removeLine(i)}
            disabled={busy || (lines.length === 1 && !line)}
            className="p-1 text-gray-400 hover:text-red-500 disabled:opacity-40"
            title="Remove this line"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-1.5 flex-wrap">
        {lines.length < MAX_LINES && (
          <button
            type="button"
            onClick={() => setLines((prev) => [...prev, ''])}
            disabled={busy}
            className="px-2 py-1 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-pink-200 dark:border-pink-500/30 hover:bg-pink-100 dark:hover:bg-pink-500/20 transition font-medium flex items-center gap-1 disabled:opacity-50"
          >
            <Plus className="w-3 h-3" /> Add line
          </button>
        )}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="px-2 py-1 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-pink-200 dark:border-pink-500/30 hover:bg-pink-100 dark:hover:bg-pink-500/20 transition font-medium flex items-center gap-1 disabled:opacity-50"
          title="Optional: a new photo of the person on the thumbnail"
        >
          <Camera className="w-3 h-3" /> {photo ? 'Change new photo' : 'Use a new photo'}
        </button>
        {photo && (
          <span className="flex items-center gap-1 text-gray-600 dark:text-gray-300 max-w-[140px]">
            <span className="truncate">{photo.name}</span>
            <button type="button" onClick={() => setPhoto(null)} className="text-gray-400 hover:text-red-500" title="Do not use this photo">
              <X className="w-3 h-3" />
            </button>
          </span>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) setPhoto(f)
            e.target.value = ''
          }}
        />
        <button
          type="button"
          onClick={() => onChangeWords(filled, photo)}
          disabled={busy || filled.length === 0}
          className="ml-auto px-2.5 py-1 rounded-md bg-pink-600 hover:bg-pink-700 text-white font-medium transition shadow-sm whitespace-nowrap disabled:opacity-50"
          title="Change only the words (and the person, if you chose a new photo). The rest of the picture stays the same."
        >
          {busy ? 'Working...' : '✏️ Change words'}
        </button>
      </div>
    </div>
  )
}
