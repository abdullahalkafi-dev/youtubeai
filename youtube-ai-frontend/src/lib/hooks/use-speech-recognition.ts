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

export function useSpeechRecognition(): SpeechRecognitionHook {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [finalTranscript, setFinalTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSupported, setIsSupported] = useState(false)

  const recognitionRef = useRef<any>(null)
  const isListeningRef = useRef(false)
  const accumulatedFinalRef = useRef('')
  const currentSessionFinalRef = useRef('')

  useEffect(() => {
    if (typeof window === 'undefined') return

    const SpeechRecognitionClass =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

    if (!SpeechRecognitionClass) {
      setIsSupported(false)
      return
    }

    setIsSupported(true)
    const recognition = new SpeechRecognitionClass()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onstart = () => {
      setIsListening(true)
      setError(null)
    }

    recognition.onresult = (event: any) => {
      let sessionFinal = ''
      let interim = ''

      for (let i = 0; i < event.results.length; i++) {
        const item = event.results[i]
        if (item.isFinal) {
          sessionFinal += (sessionFinal ? ' ' : '') + item[0].transcript.trim()
        } else {
          interim += (interim ? ' ' : '') + item[0].transcript.trim()
        }
      }

      currentSessionFinalRef.current = sessionFinal

      const totalFinal = accumulatedFinalRef.current
        ? (sessionFinal ? `${accumulatedFinalRef.current} ${sessionFinal}` : accumulatedFinalRef.current)
        : sessionFinal

      const fullTranscript = interim
        ? (totalFinal ? `${totalFinal} ${interim}` : interim)
        : totalFinal

      setInterimTranscript(interim)
      setFinalTranscript(totalFinal)
      setTranscript(fullTranscript)
    }

    recognition.onerror = (event: any) => {
      const err = event.error
      // Ignore normal silence timeouts or aborted actions during restarts
      if (err === 'no-speech' || err === 'aborted') {
        return
      }

      if (err === 'not-allowed' || err === 'service-not-allowed') {
        isListeningRef.current = false
        setIsListening(false)
        setError('Microphone access was denied. Please allow microphone permissions in your browser.')
        return
      }

      if (err === 'network') {
        setError('Speech recognition network error. Please check your internet connection.')
        return
      }

      if (err === 'audio-capture') {
        isListeningRef.current = false
        setIsListening(false)
        setError('No microphone was detected. Please verify your microphone connection.')
        return
      }

      setError(`Speech error: ${err}`)
    }

    recognition.onend = () => {
      // If user is still supposed to be listening (e.g. browser timed out after silence)
      if (isListeningRef.current) {
        // Roll over session final to accumulated
        if (currentSessionFinalRef.current) {
          accumulatedFinalRef.current = accumulatedFinalRef.current
            ? `${accumulatedFinalRef.current} ${currentSessionFinalRef.current}`
            : currentSessionFinalRef.current
          currentSessionFinalRef.current = ''
        }

        // Restart recognition cleanly
        try {
          recognition.start()
        } catch (e) {
          setTimeout(() => {
            if (isListeningRef.current && recognitionRef.current) {
              try {
                recognitionRef.current.start()
              } catch (e2) {}
            }
          }, 100)
        }
      } else {
        setIsListening(false)
      }
    }

    recognitionRef.current = recognition

    return () => {
      isListeningRef.current = false
      if (recognitionRef.current) {
        try {
          recognitionRef.current.onend = null
          recognitionRef.current.onerror = null
          recognitionRef.current.onresult = null
          recognitionRef.current.stop()
        } catch (e) {}
      }
    }
  }, [])

  const startListening = useCallback(() => {
    if (!recognitionRef.current) return
    isListeningRef.current = true
    accumulatedFinalRef.current = ''
    currentSessionFinalRef.current = ''
    setTranscript('')
    setInterimTranscript('')
    setFinalTranscript('')
    setError(null)

    try {
      recognitionRef.current.start()
      setIsListening(true)
    } catch (err) {
      // If recognition was already running or in transition, stop and restart
      try {
        recognitionRef.current.stop()
        setTimeout(() => {
          if (isListeningRef.current && recognitionRef.current) {
            try {
              recognitionRef.current.start()
              setIsListening(true)
            } catch (e) {}
          }
        }, 150)
      } catch (e) {}
    }
  }, [])

  const stopListening = useCallback(() => {
    isListeningRef.current = false
    if (currentSessionFinalRef.current) {
      accumulatedFinalRef.current = accumulatedFinalRef.current
        ? `${accumulatedFinalRef.current} ${currentSessionFinalRef.current}`
        : currentSessionFinalRef.current
      currentSessionFinalRef.current = ''
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch (e) {}
    }
    setIsListening(false)
  }, [])

  const resetTranscript = useCallback(() => {
    accumulatedFinalRef.current = ''
    currentSessionFinalRef.current = ''
    setTranscript('')
    setInterimTranscript('')
    setFinalTranscript('')
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
