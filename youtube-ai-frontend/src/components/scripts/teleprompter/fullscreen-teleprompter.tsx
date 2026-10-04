'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Play,
  Pause,
  X,
  Gauge,
  RotateCcw,
  Navigation,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  Highlighter,
  Sun,
  Moon,
} from 'lucide-react'
import { parseScriptSections, calculateTeleprompterStats, isSourceCitationLine } from '@/lib/teleprompter-parser'

interface FullscreenTeleprompterProps {
  isOpen: boolean
  onClose: () => void
  title: string
  content: string
  wordCount?: number
  estimatedDurationMinutes?: number
}

// Split paragraph into clean speaking sentences for spotlight tracking
function parseSentencesFromText(text: string): string[] {
  const clean = text.replace(/^>\s*/gm, '').replace(/\*\*/g, '').trim()
  if (!clean) return []
  const matches = clean.match(/[^.!?\n]+(?:[.!?]+["']?|$)/g)
  if (!matches || matches.length <= 1) return [clean]
  return matches.map((m) => m.trim()).filter(Boolean)
}

// ─── Smart Block-Grouping Body Renderer ─────────────────────────────────────
// Groups consecutive `> ` blockquote lines into a single block with a gray
// left border (the vertical line the client wants). Handles sub-section headers,
// stage cues, jewel markers, and legal status headers.

type BlockType = 'blockquote' | 'subheader' | 'cue' | 'jewel' | 'legalheader' | 'para'
interface BodyBlock {
  type: BlockType
  lines: string[]
}

function groupBodyIntoBlocks(body: string): BodyBlock[] {
  const rawLines = body.split('\n')
  const blocks: BodyBlock[] = []
  let currentQuoteLines: string[] = []

  const flushQuote = () => {
    if (currentQuoteLines.length > 0) {
      blocks.push({ type: 'blockquote', lines: currentQuoteLines })
      currentQuoteLines = []
    }
  }

  for (const raw of rawLines) {
    const line = raw.trimEnd()

    // Blank line — flush any open blockquote, then skip
    if (!line.trim()) {
      flushQuote()
      continue
    }

    const trimmed = line.trim()
    // Remove accidental leading backslashes
    const clean = trimmed.replace(/^\\+/, '')

    // ── Skip horizontal rules --- and === ... === section dividers
    if (/^-{3,}$/.test(clean) || /^={3,}.*={3,}$/.test(clean)) {
      flushQuote()
      continue
    }

    // ── Skip source citation lines (not spoken) — Source: AP..., ([url]), footnotes
    if (isSourceCitationLine(clean)) {
      flushQuote()
      continue
    }

    // ── Stage cue: [BEAT] / [PAUSE]
    if (/^\[(?:BEAT|PAUSE)\]/i.test(clean)) {
      flushQuote()
      blocks.push({ type: 'cue', lines: [clean] })
      continue
    }

    // ── Jewel marker: 💎 JEWEL, 💎 FINAL JEWEL, or bare JEWEL / JEWEL LESSON
    // Require end-of-line (optional colon) so words like JEWELS/JEWELRY never false-positive.
    if (/^(?:#{2,3}\s*)?(?:\*{0,2})?(?:💎\s*(?:FINAL\s+)?JEWEL|JEWEL(?:\s*LESSON)?)(?:\*{0,2}):?\s*$/i.test(clean)) {
      flushQuote()
      blocks.push({ type: 'jewel', lines: [clean] })
      continue
    }

    // ── Legal status header: ### ON-SCREEN LEGAL STATUS
    if (/^#{2,3}\s+ON-SCREEN/i.test(trimmed) || /^#{2,3}\s+LEGAL STATUS/i.test(trimmed)) {
      flushQuote()
      blocks.push({ type: 'legalheader', lines: [trimmed.replace(/^#+\s*/, '')] })
      continue
    }

    // ── Sub-section header: **A. TITLE**, **➤ A. TITLE**, or bare A. TITLE
    if (/^\*{0,2}➤\s*/.test(trimmed) || /^\*{0,2}[A-Z]\.\s+/.test(trimmed)) {
      flushQuote()
      blocks.push({ type: 'subheader', lines: [trimmed.replace(/\*\*/g, '').replace(/^➤\s*/, '')] })
      continue
    }

    // ── Blockquote line: > text  OR just >
    if (/^>\s*$/.test(trimmed)) {
      // Lone `>` = breath spacer — close the rail so consecutive `>` spacers
      // cannot merge into one continuous multi-line gray wall.
      flushQuote()
      continue
    }
    if (/^>\s*/.test(trimmed)) {
      const content = trimmed.replace(/^>\s*/, '')
      currentQuoteLines.push(content)
      continue
    }

    // ── Everything else → paragraph
    flushQuote()
    blocks.push({ type: 'para', lines: [trimmed] })
  }

  flushQuote()
  return blocks
}

interface SectionBodyRendererProps {
  body: string
  sectionIdx: number
  fontSize: number
  isHighlightEnabled: boolean
  activeSentenceId: string | null
  sentenceRefs: React.MutableRefObject<Map<string, HTMLElement>>
  handleSentenceClick: (id: string) => void
  isDark: boolean
}

function SectionBodyRenderer({
  body,
  sectionIdx,
  fontSize,
  isHighlightEnabled,
  activeSentenceId,
  sentenceRefs,
  handleSentenceClick,
  isDark,
}: SectionBodyRendererProps) {
  const blocks = groupBodyIntoBlocks(body)

  return (
    <div className="space-y-3">
      {blocks.map((block, bIdx) => {
        const key = `sec-${sectionIdx}-b-${bIdx}`

        // ── STAGE CUE pill ─────────────────────────────────────────────────
        if (block.type === 'cue') {
          return (
            <div key={key} className="py-1.5 flex items-center justify-center">
              <span className={`px-3 py-0.5 rounded-full text-[11px] font-mono font-black uppercase tracking-widest ${
                isDark
                  ? 'bg-zinc-800 text-amber-400 border border-zinc-700 shadow-inner'
                  : 'bg-amber-100/80 text-amber-900 border border-amber-300 shadow-xs'
              }`}>
                {block.lines[0]}
              </span>
            </div>
          )
        }

        // ── JEWEL badge ────────────────────────────────────────────────────
        if (block.type === 'jewel') {
          return (
            <div key={key} className="flex items-center space-x-2 pt-1 pb-0.5">
              <div className={`flex-1 h-px ${isDark ? 'bg-amber-500/30' : 'bg-amber-500/40'}`} />
              <span className={`font-black text-[11px] sm:text-xs uppercase tracking-widest ${
                isDark ? 'text-amber-400' : 'text-amber-700'
              }`}>
                {block.lines[0]}
              </span>
              <div className={`flex-1 h-px ${isDark ? 'bg-amber-500/30' : 'bg-amber-500/40'}`} />
            </div>
          )
        }

        // ── LEGAL STATUS header ────────────────────────────────────────────
        if (block.type === 'legalheader') {
          return (
            <div key={key} className={`py-1 border-b mb-1 ${isDark ? 'border-zinc-700/60' : 'border-zinc-200'}`}>
              <span
                style={{ fontSize: `${Math.max(11, fontSize * 0.6)}px` }}
                className={`font-black uppercase tracking-[0.2em] ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}
              >
                {block.lines[0]}
              </span>
            </div>
          )
        }

        // ── SUB-SECTION header (➤ A. TITLE) ───────────────────────────────
        if (block.type === 'subheader') {
          const subId = `${key}-sub`
          const isSubActive = isHighlightEnabled && activeSentenceId === subId
          return (
            <div
              key={key}
              ref={(el) => {
                if (el) sentenceRefs.current.set(subId, el)
                else sentenceRefs.current.delete(subId)
              }}
              onClick={(e) => {
                e.stopPropagation()
                handleSentenceClick(subId)
              }}
              style={{ fontSize: `${fontSize * 1.05}px`, lineHeight: '1.5' }}
              className={`font-extrabold tracking-tight pt-2 cursor-pointer rounded-lg px-2 -mx-2 transition-all duration-200 ${
                isSubActive
                  ? isDark
                    ? 'text-amber-300 bg-amber-500/15 shadow-[0_0_25px_rgba(245,158,11,0.25)] ring-1 ring-amber-400/40 scale-[1.015] origin-left'
                    : 'text-amber-950 font-black bg-amber-200 shadow-sm ring-1 ring-amber-400 scale-[1.015] origin-left'
                  : isDark
                  ? 'text-white hover:text-amber-200'
                  : 'text-zinc-900 hover:text-amber-700'
              }`}
            >
              {block.lines[0]}
            </div>
          )
        }

        // ── BLOCKQUOTE group — the vertical gray line the client wants ─────
        if (block.type === 'blockquote') {
          return (
            <div
              key={key}
              className={`pl-4 sm:pl-5 border-l-[3px] space-y-1 ${
                isDark ? 'border-zinc-600/70' : 'border-zinc-300'
              }`}
            >
              {block.lines.map((spokenLine, lIdx) => {
                if (!spokenLine) {
                  // Blank `>` = breath gap
                  return <div key={lIdx} className="h-1" />
                }
                const lineId = `${key}-l-${lIdx}`
                const isActive = isHighlightEnabled && activeSentenceId === lineId
                return (
                  <div
                    key={lineId}
                    ref={(el) => {
                      if (el) sentenceRefs.current.set(lineId, el)
                      else sentenceRefs.current.delete(lineId)
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleSentenceClick(lineId)
                    }}
                    style={{ fontSize: `${fontSize}px`, lineHeight: '1.6' }}
                    className={`cursor-pointer rounded-md transition-all duration-200 ${
                      isActive
                        ? isDark
                          ? 'text-amber-300 font-bold bg-amber-400/15 shadow-[0_0_20px_rgba(251,191,36,0.22)] ring-1 ring-amber-400/40 px-2 py-0.5 -mx-2 scale-[1.015] inline-block origin-left'
                          : 'text-zinc-950 font-black bg-amber-200/95 shadow-sm ring-1 ring-amber-400 px-2 py-0.5 -mx-2 scale-[1.015] inline-block origin-left'
                        : isDark
                        ? 'font-medium text-zinc-200 hover:text-white hover:bg-zinc-800/30'
                        : 'font-semibold text-zinc-900 hover:text-black hover:bg-zinc-100'
                    }`}
                  >
                    {spokenLine}
                  </div>
                )
              })}
            </div>
          )
        }

        // ── PLAIN PARAGRAPH ────────────────────────────────────────────────
        const sentences = parseSentencesFromText(block.lines[0])
        return (
          <div
            key={key}
            style={{ fontSize: `${fontSize}px`, lineHeight: '1.7' }}
            className={`font-medium ${isDark ? 'text-zinc-400' : 'text-zinc-700'}`}
          >
            {sentences.map((sent, sIdx) => {
              const sentenceId = `${key}-s-${sIdx}`
              const isActive = isHighlightEnabled && activeSentenceId === sentenceId
              return (
                <span
                  key={sentenceId}
                  ref={(el) => {
                    if (el) sentenceRefs.current.set(sentenceId, el)
                    else sentenceRefs.current.delete(sentenceId)
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleSentenceClick(sentenceId)
                  }}
                  className={`cursor-pointer rounded-md transition-all duration-200 ${
                    isActive
                      ? isDark
                        ? 'text-amber-300 font-bold bg-amber-400/15 shadow-[0_0_20px_rgba(251,191,36,0.22)] ring-1 ring-amber-400/40 px-1.5 py-0.5 -mx-1 scale-[1.015] inline-block origin-left'
                        : 'text-zinc-950 font-black bg-amber-200/95 shadow-sm ring-1 ring-amber-400 px-1.5 py-0.5 -mx-1 scale-[1.015] inline-block origin-left'
                      : isDark
                      ? 'text-zinc-300 hover:text-white hover:bg-zinc-800/40'
                      : 'text-zinc-700 hover:text-zinc-950 hover:bg-zinc-100'
                  }`}
                >
                  {sent}{' '}
                </span>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export function FullscreenTeleprompter({
  isOpen,
  onClose,
  title,
  content,
  wordCount = 0,
  estimatedDurationMinutes = 0,
}: FullscreenTeleprompterProps) {
  const dynamicStats = calculateTeleprompterStats(content)
  const displayWordCount = (wordCount > 2200 || !wordCount) ? dynamicStats.wordCount : wordCount
  const displayDuration = (estimatedDurationMinutes > 20 || !estimatedDurationMinutes) ? dynamicStats.estimatedDurationMinutes : estimatedDurationMinutes

  const [isPlaying, setIsPlaying] = useState(false)
  const [wpm, setWpm] = useState(140)
  const [fontSize, setFontSize] = useState(20) // Responsive default
  const [columnWidth, setColumnWidth] = useState<'narrow' | 'medium' | 'wide'>('medium')
  const [progress, setProgress] = useState(0)
  const [showControls, setShowControls] = useState(true)
  const [showMinimap, setShowMinimap] = useState(false) // Auto-collapsed on compact/half-screen
  const [activeSectionIdx, setActiveSectionIdx] = useState(0)
  const [activeSentenceId, setActiveSentenceId] = useState<string | null>(null)
  const [isHighlightEnabled, setIsHighlightEnabled] = useState<boolean>(true)
  const isHighlightEnabledRef = useRef<boolean>(true)

  // Scoped Teleprompter Theme: Always defaults to Light Mode on open
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const isDark = theme === 'dark'

  // Reset to Light Mode every time the teleprompter modal is opened
  useEffect(() => {
    if (isOpen) {
      setTheme('light')
    }
  }, [isOpen])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))
  }, [])

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([])
  const sentenceRefs = useRef<Map<string, HTMLElement>>(new Map())
  const animFrameRef = useRef<number | null>(null)
  const lastTimeRef = useRef<number | null>(null)
  const accumulatedScrollRef = useRef<number>(0)
  const hideControlsTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Keep ref synchronized with state to avoid re-binding 60fps animation loops
  useEffect(() => {
    isHighlightEnabledRef.current = isHighlightEnabled
  }, [isHighlightEnabled])

  // Restore client highlight preference from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('teleprompter_highlight_enabled')
      if (saved !== null) {
        const enabled = saved === 'true'
        setIsHighlightEnabled(enabled)
        isHighlightEnabledRef.current = enabled
      }
    }
  }, [])

  const sections = parseScriptSections(content)

  // Auto open minimap only on large desktop monitors (>= 1280px)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setShowMinimap(window.innerWidth >= 1280)
      if (window.innerWidth < 768) {
        setFontSize(22)
      }
    }
  }, [])

  // Scroll width classes - responsive for half screen
  const widthClasses = {
    narrow: 'max-w-md sm:max-w-xl',
    medium: 'max-w-xl sm:max-w-2xl lg:max-w-3xl',
    wide: 'max-w-2xl sm:max-w-4xl lg:max-w-5xl',
  }[columnWidth]

  // Pixels per second based on WPM
  const getScrollSpeedPxPerSec = useCallback(() => {
    const wordsPerSecond = wpm / 60
    const wordsPerLine = columnWidth === 'narrow' ? 4 : columnWidth === 'medium' ? 6 : 8
    const lineHeight = fontSize * 1.65
    return (wordsPerSecond / wordsPerLine) * lineHeight
  }, [wpm, fontSize, columnWidth])

  // Sync accumulated scroll position when playing toggles
  useEffect(() => {
    if (scrollContainerRef.current) {
      accumulatedScrollRef.current = scrollContainerRef.current.scrollTop
    }
  }, [isPlaying])

  // Helper to detect which sentence intersects the 40% eyeline guide
  const updateEyelineSentence = useCallback(() => {
    if (!scrollContainerRef.current) return
    const container = scrollContainerRef.current
    const containerRect = container.getBoundingClientRect()
    const eyelineY = containerRect.top + container.clientHeight * 0.4

    let bestId: string | null = null
    let minDiff = Infinity

    sentenceRefs.current.forEach((el, id) => {
      const rect = el.getBoundingClientRect()
      if (rect.top <= eyelineY + 24 && rect.bottom >= eyelineY - 24) {
        bestId = id
        minDiff = 0
      } else {
        const diff = Math.abs((rect.top + rect.bottom) / 2 - eyelineY)
        if (diff < minDiff && diff < 90) {
          minDiff = diff
          bestId = id
        }
      }
    })

    if (bestId) {
      setActiveSentenceId(bestId)
    }
  }, [])

  // Animation Frame Loop for 60fps auto-scroll with sub-pixel accumulator
  useEffect(() => {
    if (!isPlaying) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      lastTimeRef.current = null
      return
    }

    const scrollStep = (timestamp: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = timestamp
      const deltaTime = (timestamp - lastTimeRef.current) / 1000
      lastTimeRef.current = timestamp

      if (scrollContainerRef.current) {
        const container = scrollContainerRef.current
        const speed = getScrollSpeedPxPerSec()
        accumulatedScrollRef.current += speed * deltaTime
        container.scrollTop = accumulatedScrollRef.current

        // Track active section for minimap
        if (sectionRefs.current.length > 0) {
          const scrollPos = container.scrollTop + container.clientHeight / 3
          let activeIdx = 0
          for (let i = 0; i < sectionRefs.current.length; i++) {
            const el = sectionRefs.current[i]
            if (el && el.offsetTop <= scrollPos) {
              activeIdx = i
            }
          }
          setActiveSectionIdx(activeIdx)
        }

        // Update eyeline sentence highlight only when enabled (saves 60fps DOM query overhead)
        if (isHighlightEnabledRef.current) {
          updateEyelineSentence()
        }

        // Update progress
        const maxScroll = container.scrollHeight - container.clientHeight
        if (maxScroll > 0) {
          const currentProgress = Math.min(100, Math.round((container.scrollTop / maxScroll) * 100))
          setProgress(currentProgress)

          // Auto stop at the end
          if (container.scrollTop >= maxScroll - 5) {
            setIsPlaying(false)
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(scrollStep)
    }

    animFrameRef.current = requestAnimationFrame(scrollStep)

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    }
  }, [isPlaying, getScrollSpeedPxPerSec, updateEyelineSentence])

  const toggleHighlight = useCallback(() => {
    setIsHighlightEnabled((prev) => {
      const next = !prev
      isHighlightEnabledRef.current = next
      if (typeof window !== 'undefined') {
        localStorage.setItem('teleprompter_highlight_enabled', String(next))
      }
      if (!next) {
        setActiveSentenceId(null)
      } else {
        setTimeout(updateEyelineSentence, 50)
      }
      return next
    })
  }, [updateEyelineSentence])

  const resetToTop = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0
      accumulatedScrollRef.current = 0
      setActiveSectionIdx(0)
      setProgress(0)
      if (isHighlightEnabledRef.current) {
        setTimeout(updateEyelineSentence, 50)
      }
    }
  }, [updateEyelineSentence])

  // Keyboard Shortcuts
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        setIsPlaying((prev) => !prev)
      } else if (e.code === 'ArrowUp') {
        e.preventDefault()
        setWpm((prev) => Math.min(1000, prev + 10))
      } else if (e.code === 'ArrowDown') {
        e.preventDefault()
        setWpm((prev) => Math.max(50, prev - 10))
      } else if (e.code === 'KeyH') {
        e.preventDefault()
        toggleHighlight()
      } else if (e.code === 'KeyT') {
        e.preventDefault()
        toggleTheme()
      } else if (e.code === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.code === 'KeyM') {
        e.preventDefault()
        setShowMinimap((prev) => !prev)
      } else if (e.code === 'Home') {
        e.preventDefault()
        resetToTop()
      } else if (e.code === 'End') {
        e.preventDefault()
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
          accumulatedScrollRef.current = scrollContainerRef.current.scrollHeight
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, toggleHighlight, resetToTop])

  // Sync scroll state on user manual scroll
  const handleContainerScroll = () => {
    if (scrollContainerRef.current && !isPlaying) {
      accumulatedScrollRef.current = scrollContainerRef.current.scrollTop
      const maxScroll = scrollContainerRef.current.scrollHeight - scrollContainerRef.current.clientHeight
      if (maxScroll > 0) {
        setProgress(Math.min(100, Math.round((scrollContainerRef.current.scrollTop / maxScroll) * 100)))
      }
      if (isHighlightEnabledRef.current) {
        updateEyelineSentence()
      }
    }
  }

  // Mouse activity controls visibility
  const handleMouseMove = () => {
    setShowControls(true)
    if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current)
    if (isPlaying) {
      hideControlsTimerRef.current = setTimeout(() => {
        setShowControls(false)
      }, 3000)
    }
  }

  // Jump to specific section from minimap
  const jumpToSection = (idx: number) => {
    const targetEl = sectionRefs.current[idx]
    if (targetEl && scrollContainerRef.current) {
      const targetTop = Math.max(0, targetEl.offsetTop - 80)
      scrollContainerRef.current.scrollTop = targetTop
      accumulatedScrollRef.current = targetTop
      setActiveSectionIdx(idx)

      const maxScroll = scrollContainerRef.current.scrollHeight - scrollContainerRef.current.clientHeight
      if (maxScroll > 0) {
        setProgress(Math.min(100, Math.round((targetTop / maxScroll) * 100)))
      }
      if (isHighlightEnabledRef.current) {
        setTimeout(updateEyelineSentence, 50)
      }
    }
  }

  // Tap or click on a sentence to focus and scroll right to the eyeline
  const handleSentenceClick = (sentenceId: string) => {
    if (isHighlightEnabledRef.current) {
      setActiveSentenceId(sentenceId)
    }
    const el = sentenceRefs.current.get(sentenceId)
    if (el && scrollContainerRef.current) {
      const container = scrollContainerRef.current
      const rect = el.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()
      const targetEyeline = containerRect.top + container.clientHeight * 0.4
      const offsetDiff = rect.top - targetEyeline
      container.scrollTop += offsetDiff
      accumulatedScrollRef.current = container.scrollTop
    }
  }

  if (!isOpen) return null

  return (
    <div
      onMouseMove={handleMouseMove}
      className={`fixed inset-0 z-[100] flex flex-col select-none overflow-hidden transition-colors duration-200 ${
        isDark ? 'bg-black text-white' : 'bg-white text-zinc-900'
      }`}
    >
      {/* Top Floating Responsive Control Bar */}
      <div
        className={`absolute top-0 left-0 right-0 z-20 transition-all duration-300 ${
          showControls ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'
        } ${
          isDark
            ? 'bg-gradient-to-b from-black/95 via-black/85 to-transparent border-zinc-800/60'
            : 'bg-gradient-to-b from-white/95 via-white/85 to-transparent border-zinc-200 shadow-xs'
        } p-2.5 sm:p-4 flex items-center justify-between border-b backdrop-blur-md gap-1.5 sm:gap-2`}
      >
        {/* Left: Close + Title */}
        <div className="flex items-center space-x-1.5 sm:space-x-3 min-w-0 max-w-[32%] sm:max-w-[40%]">
          <button
            onClick={onClose}
            className={`p-1.5 sm:p-2 rounded-xl transition shrink-0 ${
              isDark
                ? 'bg-zinc-900/80 hover:bg-zinc-800 text-zinc-400 hover:text-white'
                : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-600 hover:text-zinc-900 border border-zinc-200'
            }`}
            title="Exit Teleprompter (Esc)"
          >
            <X className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
          <div className="truncate min-w-0">
            <h2 className={`text-xs sm:text-sm font-bold truncate ${isDark ? 'text-zinc-100' : 'text-zinc-900'}`}>
              {title}
            </h2>
            <p className={`hidden md:block text-[11px] truncate ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
              {displayDuration}m read · {displayWordCount} words · Space to Play · H to Highlight · T for Theme
            </p>
          </div>
        </div>

        {/* Right: Responsive Controls */}
        <div className="flex items-center space-x-1 sm:space-x-2 shrink-0">
          {/* Speed Stepper / Slider */}
          <div className={`flex items-center space-x-1 sm:space-x-1.5 px-2 py-1 rounded-xl ${
            isDark
              ? 'bg-zinc-900/90 border border-zinc-800/90'
              : 'bg-zinc-100/90 border border-zinc-200'
          }`}>
            <Gauge className={`w-3.5 h-3.5 shrink-0 ${isDark ? 'text-amber-400' : 'text-amber-600'}`} />
            <button
              onClick={() => setWpm((p) => Math.max(50, p - 5))}
              className={`p-0.5 rounded transition ${
                isDark ? 'text-zinc-400 hover:text-white hover:bg-zinc-800' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200'
              }`}
              title="Decrease Speed (-5 WPM)"
            >
              <Minus className="w-3 h-3" />
            </button>
            <span className={`text-[11px] sm:text-xs font-semibold min-w-[3.2rem] sm:min-w-[3.5rem] text-center font-mono ${
              isDark ? 'text-zinc-200' : 'text-zinc-800'
            }`}>
              {wpm} WPM
            </span>
            <button
              onClick={() => setWpm((p) => Math.min(1000, p + 5))}
              className={`p-0.5 rounded transition ${
                isDark ? 'text-zinc-400 hover:text-white hover:bg-zinc-800' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200'
              }`}
              title="Increase Speed (+5 WPM)"
            >
              <Plus className="w-3 h-3" />
            </button>
            <input
              type="range"
              min={50}
              max={1000}
              step={5}
              value={wpm}
              onChange={(e) => setWpm(Number(e.target.value))}
              className={`hidden lg:block w-16 xl:w-20 accent-amber-500 cursor-pointer h-1 rounded-lg ml-1 ${
                isDark ? 'bg-zinc-700' : 'bg-zinc-300'
              }`}
            />
          </div>

          {/* Font Size Stepper */}
          <div className={`flex items-center space-x-1 px-1.5 sm:px-2 py-1 rounded-xl ${
            isDark ? 'bg-zinc-900/90 border border-zinc-800/90' : 'bg-zinc-100/90 border border-zinc-200'
          }`}>
            <button
              onClick={() => setFontSize((prev) => Math.max(16, prev - 2))}
              className={`px-1.5 py-0.5 text-xs font-bold rounded ${
                isDark ? 'text-zinc-400 hover:text-white' : 'text-zinc-600 hover:text-zinc-900'
              }`}
              title="Decrease Font Size"
            >
              A-
            </button>
            <span className={`text-[11px] sm:text-xs px-0.5 font-mono ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
              {fontSize}px
            </span>
            <button
              onClick={() => setFontSize((prev) => Math.min(48, prev + 2))}
              className={`px-1.5 py-0.5 text-xs font-bold rounded ${
                isDark ? 'text-zinc-400 hover:text-white' : 'text-zinc-600 hover:text-zinc-900'
              }`}
              title="Increase Font Size"
            >
              A+
            </button>
          </div>

          {/* Column Width Selector (Compact cycle toggle on < md, full segmented on >= md) */}
          <div className={`hidden md:flex items-center space-x-1 p-0.5 rounded-xl text-xs ${
            isDark ? 'bg-zinc-900/90 border border-zinc-800/90' : 'bg-zinc-100/90 border border-zinc-200'
          }`}>
            {(['narrow', 'medium', 'wide'] as const).map((w) => (
              <button
                key={w}
                onClick={() => setColumnWidth(w)}
                className={`px-2 py-0.5 rounded-lg capitalize font-medium text-[11px] transition ${
                  columnWidth === w
                    ? 'bg-amber-500 text-black font-bold shadow-xs'
                    : isDark
                    ? 'text-zinc-400 hover:text-white'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                {w}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              const next = columnWidth === 'narrow' ? 'medium' : columnWidth === 'medium' ? 'wide' : 'narrow'
              setColumnWidth(next)
            }}
            className={`md:hidden px-2 py-1 rounded-xl text-[11px] font-mono capitalize ${
              isDark ? 'bg-zinc-900/90 border border-zinc-800/90 text-zinc-300' : 'bg-zinc-100/90 border border-zinc-200 text-zinc-700'
            }`}
            title="Toggle Column Width"
          >
            {columnWidth}
          </button>

          {/* Sentence Highlight Toggle */}
          <button
            onClick={toggleHighlight}
            className={`p-1.5 sm:px-2.5 sm:py-1 rounded-xl border transition flex items-center space-x-1.5 text-xs font-semibold ${
              isHighlightEnabled
                ? isDark
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                  : 'bg-amber-100 border-amber-400 text-amber-900 shadow-xs'
                : isDark
                ? 'bg-zinc-900/90 border-zinc-800/90 text-zinc-400 hover:text-white'
                : 'bg-zinc-100/90 border-zinc-200 text-zinc-600 hover:text-zinc-900'
            }`}
            title="Toggle Sentence Highlight (H)"
          >
            <Highlighter className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden xl:inline text-[11px]">Highlight (H)</span>
          </button>

          {/* Minimap Outline Toggle */}
          <button
            onClick={() => setShowMinimap((prev) => !prev)}
            className={`p-1.5 sm:px-2.5 sm:py-1 rounded-xl border transition flex items-center space-x-1.5 text-xs font-semibold ${
              showMinimap
                ? isDark
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                  : 'bg-amber-100 border-amber-400 text-amber-900 shadow-xs'
                : isDark
                ? 'bg-zinc-900/90 border-zinc-800/90 text-zinc-400 hover:text-white'
                : 'bg-zinc-100/90 border-zinc-200 text-zinc-600 hover:text-zinc-900'
            }`}
            title="Toggle Minimap / Beats Jump View (M)"
          >
            <Navigation className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden xl:inline text-[11px]">Outline (M)</span>
          </button>

          {/* Scoped Teleprompter Theme Toggle (Light / Dark) */}
          <button
            onClick={toggleTheme}
            className={`p-1.5 sm:px-2.5 sm:py-1 rounded-xl border transition flex items-center space-x-1.5 text-xs font-semibold shrink-0 ${
              isDark
                ? 'bg-zinc-900/90 border-zinc-800/90 text-amber-300 hover:text-amber-200 hover:bg-zinc-800'
                : 'bg-zinc-100/90 border-zinc-200 text-zinc-700 hover:text-zinc-900 hover:bg-zinc-200'
            }`}
            title={isDark ? "Switch to Light Mode (T)" : "Switch to Dark Mode (T)"}
          >
            {isDark ? (
              <Sun className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            ) : (
              <Moon className="w-3.5 h-3.5 text-zinc-700 shrink-0" />
            )}
            <span className="hidden xl:inline text-[11px]">
              {isDark ? 'Light' : 'Dark'} (T)
            </span>
          </button>

          {/* Reset to Top */}
          <button
            onClick={resetToTop}
            className={`p-1.5 sm:p-2 rounded-xl transition shrink-0 ${
              isDark
                ? 'bg-zinc-900/90 border border-zinc-800/90 hover:bg-zinc-800 text-zinc-400 hover:text-white'
                : 'bg-zinc-100/90 border border-zinc-200 hover:bg-zinc-200 text-zinc-600 hover:text-zinc-900'
            }`}
            title="Reset to Top (Home)"
          >
            <RotateCcw className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>
        </div>
      </div>

      {/* Main Reading Viewport */}
      <div
        ref={scrollContainerRef}
        onScroll={handleContainerScroll}
        className="flex-1 overflow-y-auto px-4 sm:px-6 py-16 sm:py-20 flex justify-center no-scrollbar relative"
        style={{ scrollBehavior: isPlaying ? 'auto' : 'smooth' }}
      >
        <div className={`w-full ${widthClasses} transition-all duration-300 space-y-6 sm:space-y-8`}>
          {/* Eyeline Indicator Guide Line (Clean laser line, NO text collision in center on small/half screens) */}
          <div className="fixed top-[40%] left-0 right-0 pointer-events-none z-10 flex items-center">
            <div className={`w-4 h-4 -ml-0.5 ${isDark ? 'text-amber-400/50' : 'text-amber-600/70'}`}>
              <ChevronRight className="w-4 h-4" />
            </div>
            <div className={`flex-1 h-[1px] ${
              isDark
                ? 'bg-gradient-to-r from-amber-500/30 via-amber-400/20 to-amber-500/30'
                : 'bg-gradient-to-r from-amber-500/40 via-amber-500/60 to-amber-500/40'
            }`} />
            <span className={`hidden lg:inline-block absolute left-8 -top-3 text-[10px] tracking-wider uppercase font-mono px-2 py-0.5 rounded-full backdrop-blur-sm ${
              isDark
                ? 'text-amber-400/60 bg-zinc-950/90 border border-amber-500/20'
                : 'text-amber-800 bg-white/95 border border-amber-400/50 shadow-xs'
            }`}>
              Eyeline Guide
            </span>
            <div className={`w-4 h-4 -mr-0.5 ${isDark ? 'text-amber-400/50' : 'text-amber-600/70'}`}>
              <ChevronLeft className="w-4 h-4" />
            </div>
          </div>

          {/* Title Header */}
          <div className={`text-center pb-6 sm:pb-8 border-b ${isDark ? 'border-zinc-800' : 'border-zinc-200'}`}>
            <h1
              style={{ fontSize: `${Math.max(22, fontSize * 1.25)}px` }}
              className={`font-black tracking-tight leading-tight uppercase mb-3 ${
                isDark ? 'text-amber-400' : 'text-amber-600'
              }`}
            >
              {title}
            </h1>
            <p className={`text-xs sm:text-sm font-medium tracking-wide uppercase ${
              isDark ? 'text-zinc-500' : 'text-zinc-600'
            }`}>
              {displayDuration} MINUTE TARGET · {displayWordCount} WORDS
            </p>
          </div>

          {/* Structured Teleprompter Sections */}
          {sections.map((section, idx) => (
            <div
              key={idx}
              ref={(el) => {
                sectionRefs.current[idx] = el
              }}
              className="space-y-3 pt-2"
            >
              {section.header && !section.isJewel && (
                <div className={`py-1 border-b ${isDark ? 'border-zinc-800/80' : 'border-zinc-200'}`}>
                  <h2
                    style={{ fontSize: `${Math.max(16, fontSize * 1.05)}px` }}
                    className={`font-extrabold uppercase tracking-wide ${
                      isDark ? 'text-zinc-200' : 'text-zinc-900'
                    }`}
                  >
                    {section.header}
                  </h2>
                </div>
              )}

              {section.isJewel ? (
                <div className={`p-4 sm:p-6 rounded-2xl border-2 space-y-3 sm:space-y-4 ${
                  isDark
                    ? 'bg-amber-950/30 border-amber-500/50'
                    : 'bg-amber-50/90 border-amber-400 shadow-xs'
                }`}>
                  <div className={`flex items-center space-x-2 font-black tracking-widest text-xs sm:text-sm uppercase ${
                    isDark ? 'text-amber-400' : 'text-amber-800'
                  }`}>
                    <span>💎 JEWEL LESSON</span>
                  </div>
                  {/* Stack each `>` line on its own row (Claude-style). Do not join into one paragraph. */}
                  <div
                    style={{ fontSize: `${fontSize}px`, lineHeight: '1.65' }}
                    className={`font-bold space-y-1.5 ${isDark ? 'text-amber-200' : 'text-amber-950'}`}
                  >
                    {section.body.split('\n').map((rawLine, lIdx) => {
                      const clean = rawLine
                        .replace(/^>\s*/, '')
                        .replace(/\*\*/g, '')
                        .trim()
                      if (!clean) return null
                      const lineId = `sec-${idx}-jewel-${lIdx}`
                      const isActive = isHighlightEnabled && activeSentenceId === lineId
                      return (
                        <div
                          key={lineId}
                          ref={(el) => {
                            if (el) sentenceRefs.current.set(lineId, el)
                            else sentenceRefs.current.delete(lineId)
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleSentenceClick(lineId)
                          }}
                          className={`cursor-pointer rounded-md transition-all duration-200 ${
                            isActive
                              ? isDark
                                ? 'text-amber-200 font-black bg-amber-400/25 shadow-[0_0_25px_rgba(251,191,36,0.3)] ring-1 ring-amber-400/60 px-2 py-0.5 -mx-2 scale-[1.015] origin-left'
                                : 'text-zinc-950 font-black bg-amber-200/95 shadow-sm ring-1 ring-amber-400 px-2 py-0.5 -mx-2 scale-[1.015] origin-left'
                              : isDark
                              ? 'text-amber-300/85 hover:text-amber-100 hover:bg-amber-500/10'
                              : 'text-amber-900 hover:text-amber-950 hover:bg-amber-100/50'
                          }`}
                        >
                          {clean}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <SectionBodyRenderer
                  body={section.body}
                  sectionIdx={idx}
                  fontSize={fontSize}
                  isHighlightEnabled={isHighlightEnabled}
                  activeSentenceId={activeSentenceId}
                  sentenceRefs={sentenceRefs}
                  handleSentenceClick={handleSentenceClick}
                  isDark={isDark}
                />
              )}
            </div>
          ))}

          {/* Padding block so user can scroll past the bottom */}
          <div className={`h-[45vh] flex items-center justify-center text-xs sm:text-sm font-mono uppercase tracking-widest ${
            isDark ? 'text-zinc-600' : 'text-zinc-400'
          }`}>
            — End of Teleprompter Script —
          </div>
        </div>
      </div>

      {/* VS Code-style Minimap / Beat Jump Drawer */}
      {showMinimap && sections.length > 0 && (
        <aside
          className={`fixed right-2 sm:right-4 top-16 sm:top-20 bottom-24 w-48 sm:w-56 2xl:w-60 z-40 flex flex-col backdrop-blur-2xl rounded-2xl shadow-2xl overflow-hidden transition-all duration-300 ${
            isDark ? 'bg-zinc-950/90 border border-zinc-800/90' : 'bg-white/95 border border-zinc-200 text-zinc-800'
          } ${
            showControls ? 'opacity-100 translate-x-0' : 'opacity-40 hover:opacity-100'
          }`}
        >
          {/* Header */}
          <div className={`p-2.5 sm:p-3 border-b flex items-center justify-between shrink-0 ${
            isDark ? 'border-zinc-800/80 bg-zinc-900/60' : 'border-zinc-200 bg-zinc-50/80'
          }`}>
            <div className="flex items-center space-x-2 min-w-0">
              <Navigation className={`w-3.5 h-3.5 shrink-0 ${isDark ? 'text-amber-400' : 'text-amber-600'}`} />
              <span className={`text-[11px] font-bold uppercase tracking-wider truncate ${
                isDark ? 'text-zinc-300' : 'text-zinc-800'
              }`}>
                Jump Outline
              </span>
            </div>
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 ${
              isDark ? 'bg-zinc-800 text-zinc-400' : 'bg-zinc-200 text-zinc-700'
            }`}>
              {sections.length} Beats
            </span>
          </div>

          {/* Scrollable Section Tree / Minimap */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5 no-scrollbar">
            {sections.map((sec, idx) => {
              const isActive = activeSectionIdx === idx
              const isJewel = sec.isJewel || sec.header.toLowerCase().includes('jewel')
              const isColdOpen = sec.header.toLowerCase().includes('cold open') || sec.header.toLowerCase().includes('hook')
              const isQuestions = sec.isViralQuestions || sec.header.toLowerCase().includes('viral')
              const words = sec.body.split(/\s+/).filter(Boolean).length

              return (
                <button
                  key={idx}
                  onClick={() => jumpToSection(idx)}
                  className={`w-full text-left p-2 rounded-xl transition-all flex flex-col space-y-1 group relative ${
                    isActive
                      ? isDark
                        ? 'bg-amber-500/20 border border-amber-500/60 shadow-lg shadow-amber-500/10'
                        : 'bg-amber-100 border border-amber-400 text-amber-950 shadow-xs'
                      : isDark
                      ? 'hover:bg-zinc-800/60 border border-transparent text-zinc-400 hover:text-zinc-200'
                      : 'hover:bg-zinc-100 border border-transparent text-zinc-600 hover:text-zinc-900'
                  }`}
                >
                  {isActive && (
                    <div className={`absolute left-0 top-1 bottom-1 w-1 rounded-r-full ${
                      isDark ? 'bg-amber-400' : 'bg-amber-500'
                    }`} />
                  )}

                  <div className="flex items-center justify-between w-full pl-1">
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider truncate flex-1 ${
                        isActive
                          ? isDark ? 'text-amber-300 font-extrabold' : 'text-amber-950 font-black'
                          : isJewel
                          ? isDark ? 'text-amber-400/90' : 'text-amber-700 font-bold'
                          : isColdOpen
                          ? isDark ? 'text-indigo-300' : 'text-indigo-600 font-semibold'
                          : isQuestions
                          ? isDark ? 'text-cyan-300' : 'text-cyan-700 font-semibold'
                          : isDark ? 'text-zinc-300' : 'text-zinc-700 font-medium'
                      }`}
                    >
                      {sec.header || `Section ${idx + 1}`}
                    </span>
                    <span className={`text-[9px] font-mono shrink-0 ml-1 ${
                      isDark ? 'text-zinc-500' : 'text-zinc-500'
                    }`}>
                      {words}w
                    </span>
                  </div>

                  {/* Micro Visual Code-like Lines Preview */}
                  <div className="w-full pl-1 flex flex-col space-y-0.5 pointer-events-none opacity-40 group-hover:opacity-80 transition">
                    <div
                      className={`h-0.5 rounded-full ${
                        isActive ? (isDark ? 'bg-amber-400' : 'bg-amber-500') : isJewel ? (isDark ? 'bg-amber-500' : 'bg-amber-600') : (isDark ? 'bg-zinc-600' : 'bg-zinc-300')
                      } w-4/5`}
                    />
                    <div className={`h-0.5 rounded-full ${isDark ? 'bg-zinc-700' : 'bg-zinc-200'} w-3/5`} />
                  </div>
                </button>
              )
            })}
          </div>

          {/* Minimap Footer - Progress */}
          <div className={`p-2 border-t flex items-center justify-between text-[10px] shrink-0 ${
            isDark ? 'border-zinc-800/80 bg-zinc-900/60 text-zinc-400' : 'border-zinc-200 bg-zinc-50/80 text-zinc-600'
          }`}>
            <span className="font-mono">Progress</span>
            <span className={`font-bold font-mono ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>{progress}%</span>
          </div>
        </aside>
      )}

      {/* Elevated Floating Play/Pause Pill (Never hidden by Windows taskbar or OBS window) */}
      <div
        className={`fixed bottom-8 sm:bottom-10 md:bottom-12 left-1/2 -translate-x-1/2 z-30 transition-all duration-300 ${
          showControls ? 'opacity-100 translate-y-0' : 'opacity-40 hover:opacity-100 translate-y-0'
        } pointer-events-auto`}
      >
        <div className={`flex items-center backdrop-blur-2xl p-1.5 sm:p-2 rounded-full space-x-2 sm:space-x-3 ${
          isDark
            ? 'bg-zinc-950/90 border border-zinc-800/90 shadow-[0_12px_36px_rgba(0,0,0,0.85)]'
            : 'bg-white/95 border border-zinc-200 shadow-[0_12px_36px_rgba(0,0,0,0.12)]'
        }`}>
          {/* Quick Restart */}
          <button
            onClick={resetToTop}
            className={`p-2 rounded-full transition shrink-0 ${
              isDark ? 'hover:bg-zinc-800 text-zinc-400 hover:text-white' : 'hover:bg-zinc-100 text-zinc-500 hover:text-zinc-900'
            }`}
            title="Restart from Beginning (Home)"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {/* Main Play/Pause CTA */}
          <button
            onClick={() => setIsPlaying((prev) => !prev)}
            className={`px-5 py-2 sm:px-7 sm:py-2.5 rounded-full flex items-center space-x-2 text-xs sm:text-sm font-black uppercase tracking-wider transition-all transform active:scale-95 shadow-xl shrink-0 ${
              isPlaying
                ? isDark
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 hover:bg-amber-500/30 shadow-amber-500/10'
                  : 'bg-amber-100 text-amber-900 border border-amber-400 hover:bg-amber-200 shadow-xs'
                : 'bg-gradient-to-r from-amber-500 to-amber-400 text-black hover:brightness-110 shadow-amber-500/30'
            }`}
          >
            {isPlaying ? (
              <>
                <Pause className="w-4 h-4 fill-current" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current ml-0.5" />
                <span>Continue</span>
              </>
            )}
          </button>

          {/* Integrated Mini Stats / Progress */}
          <div className={`flex items-center space-x-2 px-2 py-1 text-[11px] font-mono border-l ${
            isDark ? 'text-zinc-400 border-zinc-800/80' : 'text-zinc-600 border-zinc-200'
          }`}>
            <span className={`font-bold ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>{progress}%</span>
            <span className={`hidden sm:inline ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>·</span>
            <span className="hidden sm:inline">{wpm} WPM</span>
          </div>
        </div>
      </div>
    </div>
  )
}
