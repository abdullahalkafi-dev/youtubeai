'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Play,
  Pause,
  X,
  Maximize2,
  Minimize2,
  Type,
  Gauge,
  RotateCcw,
  Volume2,
  Settings,
  ChevronUp,
  ChevronDown,
} from 'lucide-react'
import { parseScriptSections } from '@/lib/teleprompter-parser'

interface FullscreenTeleprompterProps {
  isOpen: boolean
  onClose: () => void
  title: string
  content: string
  wordCount?: number
  estimatedDurationMinutes?: number
}

export function FullscreenTeleprompter({
  isOpen,
  onClose,
  title,
  content,
  wordCount = 0,
  estimatedDurationMinutes = 0,
}: FullscreenTeleprompterProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [wpm, setWpm] = useState(140)
  const [fontSize, setFontSize] = useState(28) // in px
  const [columnWidth, setColumnWidth] = useState<'narrow' | 'medium' | 'wide'>('medium')
  const [progress, setProgress] = useState(0)
  const [showControls, setShowControls] = useState(true)

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const animFrameRef = useRef<number | null>(null)
  const lastTimeRef = useRef<number | null>(null)
  const hideControlsTimerRef = useRef<NodeJS.Timeout | null>(null)

  const sections = parseScriptSections(content)

  // Scroll width classes
  const widthClasses = {
    narrow: 'max-w-xl',
    medium: 'max-w-3xl',
    wide: 'max-w-5xl',
  }[columnWidth]

  // Pixels per second based on WPM (approx. 5 words per line, line height ~fontSize * 1.6)
  // WPM / 60 = words per sec. lines per sec = (WPM / 60) / 4. px per sec = lines per sec * (fontSize * 1.6)
  const getScrollSpeedPxPerSec = useCallback(() => {
    const wordsPerSecond = wpm / 60
    const wordsPerLine = columnWidth === 'narrow' ? 4 : columnWidth === 'medium' ? 6 : 8
    const lineHeight = fontSize * 1.6
    return (wordsPerSecond / wordsPerLine) * lineHeight
  }, [wpm, fontSize, columnWidth])

  // Animation Frame Loop for 60fps auto-scroll
  useEffect(() => {
    if (!isPlaying) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      lastTimeRef.current = null
      return
    }

    const scrollStep = (timestamp: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = timestamp
      const deltaTime = (timestamp - lastTimeRef.current) / 1000 // in seconds
      lastTimeRef.current = timestamp

      if (scrollContainerRef.current) {
        const container = scrollContainerRef.current
        const speed = getScrollSpeedPxPerSec()
        container.scrollTop += speed * deltaTime

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
  }, [isPlaying, getScrollSpeedPxPerSec])

  // Keyboard Shortcuts
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Toggle play/pause on Space
      if (e.code === 'Space') {
        e.preventDefault()
        setIsPlaying((prev) => !prev)
      } else if (e.code === 'ArrowUp') {
        e.preventDefault()
        setWpm((prev) => Math.min(350, prev + 10))
      } else if (e.code === 'ArrowDown') {
        e.preventDefault()
        setWpm((prev) => Math.max(50, prev - 10))
      } else if (e.code === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.code === 'Home') {
        e.preventDefault()
        if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0
      } else if (e.code === 'End') {
        e.preventDefault()
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

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

  const resetToTop = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0
      setProgress(0)
    }
  }

  if (!isOpen) return null

  return (
    <div
      onMouseMove={handleMouseMove}
      className="fixed inset-0 z-[100] bg-black text-white flex flex-col select-none overflow-hidden"
    >
      {/* Top Floating Control Bar */}
      <div
        className={`absolute top-0 left-0 right-0 z-20 transition-all duration-300 ${
          showControls ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'
        } bg-gradient-to-b from-black/90 via-black/60 to-transparent p-4 flex items-center justify-between border-b border-zinc-800/60 backdrop-blur-md`}
      >
        <div className="flex items-center space-x-3 max-w-[40%]">
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-zinc-900/80 hover:bg-zinc-800 text-zinc-400 hover:text-white transition"
            title="Exit Teleprompter (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="truncate">
            <h2 className="text-sm font-bold text-zinc-100 truncate">{title}</h2>
            <p className="text-xs text-zinc-400">
              {estimatedDurationMinutes}m read · {wordCount} words · Space to Play/Pause
            </p>
          </div>
        </div>

        {/* Speed & Display Controls */}
        <div className="flex items-center space-x-4">
          {/* Speed Controller */}
          <div className="flex items-center space-x-2 bg-zinc-900/80 border border-zinc-800 px-3 py-1.5 rounded-xl">
            <Gauge className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-semibold text-zinc-300 w-14">{wpm} WPM</span>
            <input
              type="range"
              min={50}
              max={350}
              step={5}
              value={wpm}
              onChange={(e) => setWpm(Number(e.target.value))}
              className="w-24 accent-amber-500 cursor-pointer h-1.5 bg-zinc-700 rounded-lg"
            />
          </div>

          {/* Font Size Stepper */}
          <div className="flex items-center space-x-1 bg-zinc-900/80 border border-zinc-800 px-2 py-1 rounded-xl">
            <button
              onClick={() => setFontSize((prev) => Math.max(18, prev - 2))}
              className="px-2 py-1 text-xs font-bold text-zinc-400 hover:text-white rounded"
              title="Decrease Font Size"
            >
              A-
            </button>
            <span className="text-xs text-zinc-400 px-1 font-mono">{fontSize}px</span>
            <button
              onClick={() => setFontSize((prev) => Math.min(48, prev + 2))}
              className="px-2 py-1 text-xs font-bold text-zinc-400 hover:text-white rounded"
              title="Increase Font Size"
            >
              A+
            </button>
          </div>

          {/* Column Width Selector */}
          <div className="flex items-center space-x-1 bg-zinc-900/80 border border-zinc-800 p-1 rounded-xl text-xs">
            {(['narrow', 'medium', 'wide'] as const).map((w) => (
              <button
                key={w}
                onClick={() => setColumnWidth(w)}
                className={`px-2.5 py-1 rounded-lg capitalize font-medium transition ${
                  columnWidth === w ? 'bg-amber-500 text-black font-bold' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {w}
              </button>
            ))}
          </div>

          {/* Reset to Top */}
          <button
            onClick={resetToTop}
            className="p-2 rounded-xl bg-zinc-900/80 hover:bg-zinc-800 text-zinc-400 hover:text-white transition"
            title="Reset to Top"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Reading Viewport with Vignette Overlay */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-6 py-32 flex justify-center scroll-smooth no-scrollbar"
        style={{ scrollBehavior: isPlaying ? 'auto' : 'smooth' }}
      >
        <div className={`w-full ${widthClasses} transition-all duration-300 space-y-12`}>
          {/* Eyeline Indicator Guide Line in Center */}
          <div className="fixed top-1/2 left-0 right-0 pointer-events-none border-b border-amber-500/20 z-10">
            <span className="absolute left-6 -top-3 text-[10px] tracking-wider uppercase font-mono text-amber-500/50 bg-black/60 px-2 py-0.5 rounded">
              Eyeline Guide
            </span>
          </div>

          {/* Title Header */}
          <div className="text-center pb-8 border-b border-zinc-800">
            <h1
              style={{ fontSize: `${fontSize * 1.3}px` }}
              className="font-black text-amber-400 tracking-tight leading-tight uppercase mb-4"
            >
              {title}
            </h1>
            <p className="text-sm font-medium text-zinc-500 tracking-wide uppercase">
              {estimatedDurationMinutes} MINUTE TARGET · {wordCount} WORDS
            </p>
          </div>

          {/* Structured Teleprompter Sections */}
          {sections.map((section, idx) => (
            <div key={idx} className="space-y-6 pt-4">
              {section.header && (
                <div className="py-2 border-b border-zinc-800/80">
                  <h2
                    style={{ fontSize: `${fontSize * 0.85}px` }}
                    className="font-bold text-zinc-400 uppercase tracking-wider"
                  >
                    {section.header}
                  </h2>
                </div>
              )}

              {section.isJewel ? (
                <div className="p-6 rounded-2xl bg-amber-950/30 border-2 border-amber-500/50 space-y-4">
                  <div className="flex items-center space-x-2 text-amber-400 font-black tracking-widest text-sm uppercase">
                    <span>💎 JEWEL LESSON</span>
                  </div>
                  <div
                    style={{ fontSize: `${fontSize}px`, lineHeight: '1.6' }}
                    className="font-bold text-amber-200"
                  >
                    {section.body.replace(/^>\s*/gm, '').replace(/\*\*/g, '')}
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {section.body.split('\n').map((line, lIdx) => {
                    const trimmed = line.trim()
                    if (!trimmed) return null

                    if (trimmed.startsWith('[BEAT]') || trimmed.startsWith('[PAUSE]')) {
                      return (
                        <div key={lIdx} className="py-2 flex items-center justify-center">
                          <span className="px-4 py-1.5 rounded-full text-xs font-mono font-black uppercase tracking-widest bg-zinc-800 text-amber-400 border border-zinc-700 shadow-inner">
                            {trimmed}
                          </span>
                        </div>
                      )
                    }

                    if (trimmed.startsWith('•') || trimmed.startsWith('**•') || trimmed.startsWith('**➤')) {
                      return (
                        <div
                          key={lIdx}
                          style={{ fontSize: `${fontSize * 1.05}px`, lineHeight: '1.5' }}
                          className="font-extrabold text-white tracking-tight pt-3"
                        >
                          {trimmed.replace(/\*\*/g, '')}
                        </div>
                      )
                    }

                    return (
                      <div
                        key={lIdx}
                        style={{ fontSize: `${fontSize}px`, lineHeight: '1.65' }}
                        className="font-medium text-zinc-300 pl-4 border-l-2 border-amber-500/40"
                      >
                        {trimmed.replace(/^>\s*/, '').replace(/\*\*/g, '')}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}

          {/* Padding block so user can scroll past the bottom */}
          <div className="h-[50vh] flex items-center justify-center text-zinc-600 text-sm font-mono uppercase tracking-widest">
            — End of Teleprompter Script —
          </div>
        </div>
      </div>

      {/* Bottom Floating Playbar */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-20 transition-all duration-300 ${
          showControls ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
        } bg-gradient-to-t from-black/95 via-black/70 to-transparent p-6 flex flex-col items-center space-y-3 backdrop-blur-sm`}
      >
        {/* Progress bar */}
        <div className="w-full max-w-xl flex items-center space-x-3 text-xs font-mono text-zinc-400">
          <span>{progress}%</span>
          <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 transition-all duration-150"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span>{estimatedDurationMinutes}m</span>
        </div>

        {/* Play/Pause Button */}
        <div className="flex items-center space-x-4">
          <button
            onClick={() => setIsPlaying((prev) => !prev)}
            className={`px-8 py-3 rounded-full flex items-center space-x-3 text-sm font-black uppercase tracking-wider transition-all transform active:scale-95 shadow-xl ${
              isPlaying
                ? 'bg-zinc-800 text-amber-400 border border-amber-500/40 hover:bg-zinc-700'
                : 'bg-amber-500 text-black hover:bg-amber-400'
            }`}
          >
            {isPlaying ? (
              <>
                <Pause className="w-5 h-5 fill-current" />
                <span>Pause (Space)</span>
              </>
            ) : (
              <>
                <Play className="w-5 h-5 fill-current" />
                <span>Start Scroll (Space)</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
