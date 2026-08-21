'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

export interface UseSpeechRecognitionOptions {
  onTranscript?: (transcript: string) => void
  onError?: (error: string) => void
}

export interface SpeechRecognitionHook {
  isListening: boolean
  transcript: string
  interimTranscript: string
  finalTranscript: string
  isSupported: boolean
  error: string | null
  startListening: () => void
  stopListening: () => void
  resetTranscript: () => void
}

function joinTexts(...parts: (string | undefined | null)[]): string {
  return parts
    .map(p => (p || '').trim())
    .filter(Boolean)
    .join(' ')
}

/**
 * Merges committed transcript and newly incoming session transcript,
 * removing any duplicate boundary words caused by microphone audio buffer overlap.
 */
function mergeTranscriptsWithoutOverlap(committed: string, incoming: string): string {
  const c = (committed || '').trim()
  const inc = (incoming || '').trim()

  if (!c) return inc
  if (!inc) return c

  const committedWords = c.split(/\s+/)
  const incomingWords = inc.split(/\s+/)

  // Check for overlap of up to min(5, len) words between the end of committed and start of incoming
  const maxOverlap = Math.min(committedWords.length, incomingWords.length, 5)
  let overlapCount = 0

  for (let len = maxOverlap; len >= 1; len--) {
    const committedSuffix = committedWords.slice(-len).map(w => w.toLowerCase().replace(/[^\w]/g, '')).join(' ')
    const incomingPrefix = incomingWords.slice(0, len).map(w => w.toLowerCase().replace(/[^\w]/g, '')).join(' ')
    if (committedSuffix && committedSuffix === incomingPrefix) {
      overlapCount = len
      break
    }
  }

  if (overlapCount > 0) {
    const nonOverlappingIncoming = incomingWords.slice(overlapCount).join(' ')
    return nonOverlappingIncoming ? `${c} ${nonOverlappingIncoming}` : c
  }

  return `${c} ${inc}`
}

function cleanupInstance(instance: any) {
  if (!instance) return
  instance.onstart = null
  instance.onresult = null
  instance.onerror = null
  instance.onend = null
  try {
    instance.abort()
  } catch {}
}

export function useSpeechRecognition(options?: UseSpeechRecognitionOptions): SpeechRecognitionHook {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [finalTranscript, setFinalTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSupported, setIsSupported] = useState(false)

  const recognitionRef = useRef<any>(null)
  const isListeningRef = useRef(false)
  const isExplicitlyStoppedRef = useRef(true)
  const restartTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const committedTextRef = useRef('')
  const currentSessionFinalRef = useRef('')
  const currentSessionInterimRef = useRef('')

  const optionsRef = useRef(options)
  optionsRef.current = options

  const spawnRecognition = useCallback(() => {
    if (typeof window === 'undefined') return null
    if (isExplicitlyStoppedRef.current || !isListeningRef.current) return null

    const SpeechRecognitionClass =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

    if (!SpeechRecognitionClass) {
      setIsSupported(false)
      return null
    }

    // Clean up any lingering instance before spawning a fresh one
    if (recognitionRef.current) {
      cleanupInstance(recognitionRef.current)
      recognitionRef.current = null
    }

    const recognition = new SpeechRecognitionClass()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onstart = () => {
      // Rapid toggle race guard: if user stopped while start was initializing, abort immediately
      if (isExplicitlyStoppedRef.current) {
        cleanupInstance(recognition)
        setIsListening(false)
        return
      }
      setIsListening(true)
      setError(null)
    }

    recognition.onresult = (event: any) => {
      if (isExplicitlyStoppedRef.current) return

      let sessionFinal = ''
      let sessionInterim = ''

      for (let i = 0; i < event.results.length; i++) {
        const item = event.results[i]
        const text = item[0]?.transcript || ''
        if (item.isFinal) {
          sessionFinal = joinTexts(sessionFinal, text)
        } else {
          sessionInterim = joinTexts(sessionInterim, text)
        }
      }

      currentSessionFinalRef.current = sessionFinal
      currentSessionInterimRef.current = sessionInterim

      const sessionTotal = joinTexts(sessionFinal, sessionInterim)
      const fullText = mergeTranscriptsWithoutOverlap(committedTextRef.current, sessionTotal)
      const totalFinal = mergeTranscriptsWithoutOverlap(committedTextRef.current, sessionFinal)

      setInterimTranscript(sessionInterim)
      setFinalTranscript(totalFinal)
      setTranscript(fullText)

      // Directly notify listener with deduplicated spoken text
      if (optionsRef.current?.onTranscript) {
        optionsRef.current.onTranscript(fullText)
      }
    }

    recognition.onerror = (event: any) => {
      const err = event.error
      // 'no-speech' and 'aborted' are normal silence/lifecycle events in Chromium, ignore safely
      if (err === 'no-speech' || err === 'aborted') {
        return
      }

      if (err === 'not-allowed' || err === 'service-not-allowed') {
        isExplicitlyStoppedRef.current = true
        isListeningRef.current = false
        cleanupInstance(recognition)
        recognitionRef.current = null
        setIsListening(false)
        const msg = 'Microphone permission was denied. Please allow microphone access in your browser settings.'
        setError(msg)
        optionsRef.current?.onError?.(msg)
        return
      }

      if (err === 'audio-capture') {
        isExplicitlyStoppedRef.current = true
        isListeningRef.current = false
        cleanupInstance(recognition)
        recognitionRef.current = null
        setIsListening(false)
        const msg = 'No microphone was detected. Please check your microphone hardware.'
        setError(msg)
        optionsRef.current?.onError?.(msg)
        return
      }

      if (err === 'network') {
        const msg = 'Speech recognition network error. Please check your internet connection.'
        setError(msg)
        optionsRef.current?.onError?.(msg)
        return
      }

      const msg = `Speech recognition error: ${err}`
      setError(msg)
      optionsRef.current?.onError?.(msg)
    }

    recognition.onend = () => {
      // Commit whatever final text was recognized in this completed session
      if (currentSessionFinalRef.current) {
        committedTextRef.current = mergeTranscriptsWithoutOverlap(
          committedTextRef.current,
          currentSessionFinalRef.current
        )
        currentSessionFinalRef.current = ''
        currentSessionInterimRef.current = ''
      }

      // Detach listeners from this ended instance before creating any new one
      cleanupInstance(recognition)
      recognitionRef.current = null

      // If user still intends to listen and has not explicitly stopped
      if (!isExplicitlyStoppedRef.current && isListeningRef.current) {
        if (restartTimeoutRef.current) {
          clearTimeout(restartTimeoutRef.current)
        }

        // Micro-delay (100ms) ensures Chromium has fully released audio hardware
        restartTimeoutRef.current = setTimeout(() => {
          if (!isExplicitlyStoppedRef.current && isListeningRef.current) {
            spawnRecognition()
          }
        }, 100)
      } else {
        setIsListening(false)
      }
    }

    recognitionRef.current = recognition

    try {
      recognition.start()
    } catch (err) {
      if (!isExplicitlyStoppedRef.current && isListeningRef.current) {
        if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current)
        restartTimeoutRef.current = setTimeout(() => {
          if (!isExplicitlyStoppedRef.current && isListeningRef.current) {
            spawnRecognition()
          }
        }, 150)
      } else {
        setIsListening(false)
      }
    }

    return recognition
  }, [])

  const startListening = useCallback(() => {
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current)
      restartTimeoutRef.current = null
    }

    isExplicitlyStoppedRef.current = false
    isListeningRef.current = true
    committedTextRef.current = ''
    currentSessionFinalRef.current = ''
    currentSessionInterimRef.current = ''
    setTranscript('')
    setInterimTranscript('')
    setFinalTranscript('')
    setError(null)

    spawnRecognition()
  }, [spawnRecognition])

  const stopListening = useCallback(() => {
    isExplicitlyStoppedRef.current = true
    isListeningRef.current = false

    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current)
      restartTimeoutRef.current = null
    }

    if (currentSessionFinalRef.current) {
      committedTextRef.current = mergeTranscriptsWithoutOverlap(
        committedTextRef.current,
        currentSessionFinalRef.current
      )
      currentSessionFinalRef.current = ''
      currentSessionInterimRef.current = ''
    }

    if (recognitionRef.current) {
      cleanupInstance(recognitionRef.current)
      recognitionRef.current = null
    }

    setIsListening(false)
  }, [])

  const resetTranscript = useCallback(() => {
    committedTextRef.current = ''
    currentSessionFinalRef.current = ''
    currentSessionInterimRef.current = ''
    setTranscript('')
    setInterimTranscript('')
    setFinalTranscript('')
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognitionClass =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      setIsSupported(Boolean(SpeechRecognitionClass))
    }

    return () => {
      isExplicitlyStoppedRef.current = true
      isListeningRef.current = false
      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current)
        restartTimeoutRef.current = null
      }
      if (recognitionRef.current) {
        cleanupInstance(recognitionRef.current)
        recognitionRef.current = null
      }
    }
  }, [])

  return {
    isListening,
    transcript,
    interimTranscript,
    finalTranscript,
    isSupported,
    error,
    startListening,
    stopListening,
    resetTranscript,
  }
}
