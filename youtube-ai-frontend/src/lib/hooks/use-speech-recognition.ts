'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

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

export function useSpeechRecognition(): SpeechRecognitionHook {
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

  const spawnRecognition = useCallback(() => {
    if (typeof window === 'undefined') return null
    if (isExplicitlyStoppedRef.current || !isListeningRef.current) return null

    const SpeechRecognitionClass =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

    if (!SpeechRecognitionClass) {
      setIsSupported(false)
      return null
    }

    // Clean up any lingering prior instance before spawning a fresh one
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

      const totalFinal = joinTexts(committedTextRef.current, sessionFinal)
      const fullText = joinTexts(committedTextRef.current, sessionFinal, sessionInterim)

      setInterimTranscript(sessionInterim)
      setFinalTranscript(totalFinal)
      setTranscript(fullText)
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
        setError('Microphone permission was denied. Please allow microphone access in your browser settings.')
        return
      }

      if (err === 'audio-capture') {
        isExplicitlyStoppedRef.current = true
        isListeningRef.current = false
        cleanupInstance(recognition)
        recognitionRef.current = null
        setIsListening(false)
        setError('No microphone was detected. Please check your microphone hardware.')
        return
      }

      if (err === 'network') {
        setError('Speech recognition network error. Please check your internet connection.')
        return
      }

      setError(`Speech recognition error: ${err}`)
    }

    recognition.onend = () => {
      // Commit whatever final text was recognized in this completed session
      if (currentSessionFinalRef.current) {
        committedTextRef.current = joinTexts(committedTextRef.current, currentSessionFinalRef.current)
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
      committedTextRef.current = joinTexts(committedTextRef.current, currentSessionFinalRef.current)
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
