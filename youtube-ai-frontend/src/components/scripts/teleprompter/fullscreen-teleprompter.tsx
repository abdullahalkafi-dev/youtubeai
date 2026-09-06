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
} from 'lucide-react'
import { parseScriptSections, calculateTeleprompterStats } from '@/lib/teleprompter-parser'

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
  const [fontSize, setFontSize] = useState(26) // Responsive default
  const [columnWidth, setColumnWidth] = useState<'narrow' | 'medium' | 'wide'>('medium')
  const [progress, setProgress] = useState(0)
  const [showControls, setShowControls] = useState(true)
  const [showMinimap, setShowMinimap] = useState(false) // Auto-collapsed on compact/half-screen
  const [activeSectionIdx, setActiveSectionIdx] = useState(0)
  const [activeSentenceId, setActiveSentenceId] = useState<string | null>(null)
  const [isHighlightEnabled, setIsHighlightEnabled] = useState<boolean>(true)
  const isHighlightEnabledRef = useRef<boolean>(true)

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
      className="fixed inset-0 z-[100] bg-black text-white flex flex-col select-none overflow-hidden"
    >
      {/* Top Floating Responsive Control Bar */}
      <div
        className={`absolute top-0 left-0 right-0 z-20 transition-all duration-300 ${
          showControls ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'
        } bg-gradient-to-b from-black/95 via-black/80 to-transparent p-2.5 sm:p-4 flex items-center justify-between border-b border-zinc-800/60 backdrop-blur-md gap-2`}
      >
        {/* Left: Close + Title */}
        <div className="flex items-center space-x-2 sm:space-x-3 min-w-0 max-w-[40%]">
          <button
            onClick={onClose}
            className="p-1.5 sm:p-2 rounded-xl bg-zinc-900/80 hover:bg-zinc-800 text-zinc-400 hover:text-white transition shrink-0"
            title="Exit Teleprompter (Esc)"
          >
            <X className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
          <div className="truncate min-w-0">
            <h2 className="text-xs sm:text-sm font-bold text-zinc-100 truncate">{title}</h2>
            <p className="hidden md:block text-[11px] text-zinc-400 truncate">
              {displayDuration}m read · {displayWordCount} words · Space to Play · H to Highlight
            </p>
          </div>
        </div>

        {/* Right: Responsive Controls */}
        <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
          {/* Speed Stepper / Slider */}
          <div className="flex items-center space-x-1 sm:space-x-1.5 bg-zinc-900/90 border border-zinc-800/90 px-2 py-1 rounded-xl">
            <Gauge className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <button
              onClick={() => setWpm((p) => Math.max(50, p - 5))}
              className="p-0.5 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
              title="Decrease Speed (-5 WPM)"
            >
              <Minus className="w-3 h-3" />
            </button>
            <span className="text-[11px] sm:text-xs font-semibold text-zinc-200 min-w-[3.5rem] text-center font-mono">
              {wpm} WPM
            </span>
            <button
              onClick={() => setWpm((p) => Math.min(1000, p + 5))}
              className="p-0.5 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
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
              className="hidden lg:block w-20 accent-amber-500 cursor-pointer h-1 bg-zinc-700 rounded-lg ml-1"
            />
          </div>

          {/* Font Size Stepper */}
          <div className="flex items-center space-x-1 bg-zinc-900/90 border border-zinc-800/90 px-1.5 sm:px-2 py-1 rounded-xl">
            <button
              onClick={() => setFontSize((prev) => Math.max(16, prev - 2))}
              className="px-1.5 py-0.5 text-xs font-bold text-zinc-400 hover:text-white rounded"
              title="Decrease Font Size"
            >
              A-
            </button>
            <span className="text-[11px] sm:text-xs text-zinc-400 px-0.5 font-mono">{fontSize}px</span>
            <button
              onClick={() => setFontSize((prev) => Math.min(48, prev + 2))}
              className="px-1.5 py-0.5 text-xs font-bold text-zinc-400 hover:text-white rounded"
              title="Increase Font Size"
            >
              A+
            </button>
          </div>

          {/* Column Width Selector (Compact cycle toggle on < md, full segmented on >= md) */}
          <div className="hidden md:flex items-center space-x-1 bg-zinc-900/90 border border-zinc-800/90 p-0.5 rounded-xl text-xs">
            {(['narrow', 'medium', 'wide'] as const).map((w) => (
              <button
                key={w}
                onClick={() => setColumnWidth(w)}
                className={`px-2 py-0.5 rounded-lg capitalize font-medium text-[11px] transition ${
                  columnWidth === w ? 'bg-amber-500 text-black font-bold' : 'text-zinc-400 hover:text-white'
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
            className="md:hidden px-2 py-1 bg-zinc-900/90 border border-zinc-800/90 rounded-xl text-[11px] font-mono text-zinc-300 capitalize"
            title="Toggle Column Width"
          >
            {columnWidth}
          </button>

          {/* Sentence Highlight Toggle */}
          <button
            onClick={toggleHighlight}
            className={`p-1.5 sm:px-2.5 sm:py-1 rounded-xl border transition flex items-center space-x-1.5 text-xs font-semibold ${
              isHighlightEnabled
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                : 'bg-zinc-900/90 border-zinc-800/90 text-zinc-400 hover:text-white'
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
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                : 'bg-zinc-900/90 border-zinc-800/90 text-zinc-400 hover:text-white'
            }`}
            title="Toggle Minimap / Beats Jump View (M)"
          >
            <Navigation className="w-3.5 h-3.5" />
            <span className="hidden xl:inline text-[11px]">Outline (M)</span>
          </button>

          {/* Reset to Top */}
          <button
            onClick={resetToTop}
            className="p-1.5 sm:p-2 rounded-xl bg-zinc-900/90 border border-zinc-800/90 hover:bg-zinc-800 text-zinc-400 hover:text-white transition shrink-0"
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
        className="flex-1 overflow-y-auto px-4 sm:px-6 py-20 sm:py-28 lg:py-32 flex justify-center no-scrollbar relative"
        style={{ scrollBehavior: isPlaying ? 'auto' : 'smooth' }}
      >
        <div className={`w-full ${widthClasses} transition-all duration-300 space-y-8 sm:space-y-12`}>
          {/* Eyeline Indicator Guide Line (Clean laser line, NO text collision in center on small/half screens) */}
          <div className="fixed top-[40%] left-0 right-0 pointer-events-none z-10 flex items-center">
            <div className="w-4 h-4 text-amber-400/50 -ml-0.5">
              <ChevronRight className="w-4 h-4" />
            </div>
            <div className="flex-1 h-[1px] bg-gradient-to-r from-amber-500/30 via-amber-400/20 to-amber-500/30" />
            <span className="hidden lg:inline-block absolute left-8 -top-3 text-[10px] tracking-wider uppercase font-mono text-amber-400/60 bg-zinc-950/90 border border-amber-500/20 px-2 py-0.5 rounded-full backdrop-blur-sm">
              Eyeline Guide
            </span>
            <div className="w-4 h-4 text-amber-400/50 -mr-0.5">
              <ChevronLeft className="w-4 h-4" />
            </div>
          </div>

          {/* Title Header */}
          <div className="text-center pb-6 sm:pb-8 border-b border-zinc-800">
            <h1
              style={{ fontSize: `${Math.max(22, fontSize * 1.25)}px` }}
              className="font-black text-amber-400 tracking-tight leading-tight uppercase mb-3"
            >
              {title}
            </h1>
            <p className="text-xs sm:text-sm font-medium text-zinc-500 tracking-wide uppercase">
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
              className="space-y-5 pt-3"
            >
              {section.header && (
                <div className="py-1.5 border-b border-zinc-800/80">
                  <h2
                    style={{ fontSize: `${Math.max(14, fontSize * 0.75)}px` }}
                    className="font-bold text-zinc-400 uppercase tracking-wider"
                  >
                    {section.header}
                  </h2>
                </div>
              )}

              {section.isJewel ? (
                <div className="p-4 sm:p-6 rounded-2xl bg-amber-950/30 border-2 border-amber-500/50 space-y-3 sm:space-y-4">
                  <div className="flex items-center space-x-2 text-amber-400 font-black tracking-widest text-xs sm:text-sm uppercase">
                    <span>💎 JEWEL LESSON</span>
                  </div>
                  <div
                    style={{ fontSize: `${fontSize}px`, lineHeight: '1.65' }}
                    className="font-bold text-amber-200"
                  >
                    {parseSentencesFromText(section.body).map((sent, sIdx) => {
                      const sentenceId = `sec-${idx}-jewel-${sIdx}`
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
                              ? 'text-amber-200 font-black bg-amber-400/25 shadow-[0_0_25px_rgba(251,191,36,0.3)] ring-1 ring-amber-400/60 px-1.5 py-0.5 -mx-1 scale-[1.015] inline-block origin-left'
                              : 'text-amber-300/85 hover:text-amber-100 hover:bg-amber-500/10'
                          }`}
                        >
                          {sent}{' '}
                        </span>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <div className="space-y-5 sm:space-y-6">
                  {section.body.split('\n').map((line, lIdx) => {
                    const trimmed = line.trim()
                    if (!trimmed) return null

                    if (trimmed.startsWith('[BEAT]') || trimmed.startsWith('[PAUSE]')) {
                      return (
                        <div key={lIdx} className="py-2 flex items-center justify-center">
                          <span className="px-3 sm:px-4 py-1 rounded-full text-[11px] sm:text-xs font-mono font-black uppercase tracking-widest bg-zinc-800 text-amber-400 border border-zinc-700 shadow-inner">
                            {trimmed}
                          </span>
                        </div>
                      )
                    }

                    if (trimmed.startsWith('•') || trimmed.startsWith('**•') || trimmed.startsWith('**➤')) {
                      const bulletId = `sec-${idx}-bullet-${lIdx}`
                      const isBulletActive = isHighlightEnabled && activeSentenceId === bulletId
                      return (
                        <div
                          key={lIdx}
                          ref={(el) => {
                            if (el) sentenceRefs.current.set(bulletId, el)
                            else sentenceRefs.current.delete(bulletId)
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleSentenceClick(bulletId)
                          }}
                          style={{ fontSize: `${fontSize * 1.05}px`, lineHeight: '1.5' }}
                          className={`font-extrabold tracking-tight pt-2 cursor-pointer rounded-lg px-2 -mx-2 transition-all duration-200 ${
                            isBulletActive
                              ? 'text-amber-300 bg-amber-500/15 shadow-[0_0_25px_rgba(245,158,11,0.25)] ring-1 ring-amber-400/40 scale-[1.015] origin-left'
                              : 'text-white hover:text-amber-200'
                          }`}
                        >
                          {trimmed.replace(/\*\*/g, '')}
                        </div>
                      )
                    }

                    // Split standard paragraph into interactive sentences
                    const sentences = parseSentencesFromText(trimmed)
                    return (
                      <div
                        key={lIdx}
                        style={{ fontSize: `${fontSize}px`, lineHeight: '1.7' }}
                        className="font-medium text-zinc-300 pl-3 sm:pl-4 border-l-2 border-amber-500/30 transition-colors"
                      >
                        {sentences.map((sent, sIdx) => {
                          const sentenceId = `sec-${idx}-p-${lIdx}-s-${sIdx}`
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
                                  ? 'text-amber-300 font-bold bg-amber-400/15 shadow-[0_0_20px_rgba(251,191,36,0.22)] ring-1 ring-amber-400/40 px-1.5 py-0.5 -mx-1 scale-[1.015] inline-block origin-left'
                                  : 'text-zinc-300 hover:text-white hover:bg-zinc-800/40'
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
              )}
            </div>
          ))}

          {/* Padding block so user can scroll past the bottom */}
          <div className="h-[45vh] flex items-center justify-center text-zinc-600 text-xs sm:text-sm font-mono uppercase tracking-widest">
            — End of Teleprompter Script —
          </div>
        </div>
      </div>

      {/* VS Code-style Minimap / Beat Jump Drawer */}
      {showMinimap && sections.length > 0 && (
        <aside
          className={`fixed right-2 sm:right-4 top-16 sm:top-20 bottom-24 w-48 sm:w-56 2xl:w-60 z-40 flex flex-col bg-zinc-950/90 backdrop-blur-2xl border border-zinc-800/90 rounded-2xl shadow-2xl overflow-hidden transition-all duration-300 ${
            showControls ? 'opacity-100 translate-x-0' : 'opacity-40 hover:opacity-100'
          }`}
        >
          {/* Header */}
          <div className="p-2.5 sm:p-3 border-b border-zinc-800/80 flex items-center justify-between shrink-0 bg-zinc-900/60">
            <div className="flex items-center space-x-2 min-w-0">
              <Navigation className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-300 truncate">
                Jump Outline
              </span>
            </div>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 shrink-0">
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
                      ? 'bg-amber-500/20 border border-amber-500/60 shadow-lg shadow-amber-500/10'
                      : 'hover:bg-zinc-800/60 border border-transparent text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {isActive && (
                    <div className="absolute left-0 top-1 bottom-1 w-1 bg-amber-400 rounded-r-full" />
                  )}

                  <div className="flex items-center justify-between w-full pl-1">
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider truncate flex-1 ${
                        isActive
                          ? 'text-amber-300 font-extrabold'
                          : isJewel
                          ? 'text-amber-400/90'
                          : isColdOpen
                          ? 'text-indigo-300'
                          : isQuestions
                          ? 'text-cyan-300'
                          : 'text-zinc-300'
                      }`}
                    >
                      {sec.header || `Section ${idx + 1}`}
                    </span>
                    <span className="text-[9px] font-mono text-zinc-500 shrink-0 ml-1">
                      {words}w
                    </span>
                  </div>

                  {/* Micro Visual Code-like Lines Preview */}
                  <div className="w-full pl-1 flex flex-col space-y-0.5 pointer-events-none opacity-40 group-hover:opacity-80 transition">
                    <div
                      className={`h-0.5 rounded-full ${
                        isActive ? 'bg-amber-400' : isJewel ? 'bg-amber-500' : 'bg-zinc-600'
                      } w-4/5`}
                    />
                    <div className="h-0.5 rounded-full bg-zinc-700 w-3/5" />
                  </div>
                </button>
              )
            })}
          </div>

          {/* Minimap Footer - Progress */}
          <div className="p-2 border-t border-zinc-800/80 bg-zinc-900/60 flex items-center justify-between text-[10px] text-zinc-400 shrink-0">
            <span className="font-mono">Progress</span>
            <span className="font-bold text-amber-400 font-mono">{progress}%</span>
          </div>
        </aside>
      )}

      {/* Elevated Floating Play/Pause Pill (Never hidden by Windows taskbar or OBS window) */}
      <div
        className={`fixed bottom-8 sm:bottom-10 md:bottom-12 left-1/2 -translate-x-1/2 z-30 transition-all duration-300 ${
          showControls ? 'opacity-100 translate-y-0' : 'opacity-40 hover:opacity-100 translate-y-0'
        } pointer-events-auto`}
      >
        <div className="flex items-center bg-zinc-950/90 backdrop-blur-2xl border border-zinc-800/90 p-1.5 sm:p-2 rounded-full shadow-[0_12px_36px_rgba(0,0,0,0.85)] space-x-2 sm:space-x-3">
          {/* Quick Restart */}
          <button
            onClick={resetToTop}
            className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white transition shrink-0"
            title="Restart from Beginning (Home)"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {/* Main Play/Pause CTA */}
          <button
            onClick={() => setIsPlaying((prev) => !prev)}
            className={`px-5 py-2 sm:px-7 sm:py-2.5 rounded-full flex items-center space-x-2 text-xs sm:text-sm font-black uppercase tracking-wider transition-all transform active:scale-95 shadow-xl shrink-0 ${
              isPlaying
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 hover:bg-amber-500/30 shadow-amber-500/10'
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
          <div className="flex items-center space-x-2 px-2 py-1 text-[11px] font-mono text-zinc-400 border-l border-zinc-800/80">
            <span className="text-amber-400 font-bold">{progress}%</span>
            <span className="text-zinc-600 hidden sm:inline">·</span>
            <span className="hidden sm:inline">{wpm} WPM</span>
          </div>
        </div>
      </div>
    </div>
  )
}
