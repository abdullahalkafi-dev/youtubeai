'use client'

import { useEffect, useRef, useState } from 'react'

export interface UseAudioVisualizerOptions {
  isActive: boolean
  barCount?: number
}

export function useAudioVisualizer({ isActive, barCount = 8 }: UseAudioVisualizerOptions) {
  const [frequencies, setFrequencies] = useState<number[]>(() => new Array(barCount).fill(0))
  const [hasPermission, setHasPermission] = useState<boolean | null>(null)

  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const animFrameRef = useRef<number | null>(null)
  const prevFreqsRef = useRef<number[]>(new Array(barCount).fill(0))

  useEffect(() => {
    if (!isActive) {
      // Cleanup audio stream and analyzer
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current)
        animFrameRef.current = null
      }
      if (sourceRef.current) {
        try {
          sourceRef.current.disconnect()
        } catch {}
        sourceRef.current = null
      }
      if (analyserRef.current) {
        try {
          analyserRef.current.disconnect()
        } catch {}
        analyserRef.current = null
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
        streamRef.current = null
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        try {
          audioContextRef.current.close()
        } catch {}
        audioContextRef.current = null
      }
      setFrequencies(new Array(barCount).fill(0))
      prevFreqsRef.current = new Array(barCount).fill(0)
      return
    }

    let isMounted = true

    const startAudioAnalysis = async () => {
      try {
        if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
          return
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })

        if (!isMounted) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }

        streamRef.current = stream
        setHasPermission(true)

        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
        const audioCtx = new AudioContextClass()
        audioContextRef.current = audioCtx

        if (audioCtx.state === 'suspended') {
          await audioCtx.resume()
        }

        const analyser = audioCtx.createAnalyser()
        analyser.fftSize = 64 // 32 data points
        analyser.smoothingTimeConstant = 0.65 // Smooth response
        analyserRef.current = analyser

        const source = audioCtx.createMediaStreamSource(stream)
        sourceRef.current = source
        source.connect(analyser)

        const bufferLength = analyser.frequencyBinCount
        const dataArray = new Uint8Array(bufferLength)

        const sampleAndAnimate = () => {
          if (!isMounted || !analyserRef.current) return

          analyserRef.current.getByteFrequencyData(dataArray)

          // Distribute the frequency bins into the desired barCount buckets
          const newFreqs: number[] = []
          const step = Math.max(1, Math.floor(bufferLength / barCount))

          for (let i = 0; i < barCount; i++) {
            const startIdx = Math.min(i * step, bufferLength - 1)
            const endIdx = Math.min((i + 1) * step, bufferLength)
            let sum = 0
            let count = 0

            for (let j = startIdx; j < endIdx; j++) {
              sum += dataArray[j] || 0
              count++
            }

            const rawAvg = count > 0 ? sum / count : 0
            // Smooth decay / momentum
            const prev = prevFreqsRef.current[i] || 0
            const smoothed = rawAvg > prev ? rawAvg : prev * 0.82 + rawAvg * 0.18
            prevFreqsRef.current[i] = smoothed
            newFreqs.push(Math.round(smoothed))
          }

          setFrequencies(newFreqs)
          animFrameRef.current = requestAnimationFrame(sampleAndAnimate)
        }

        animFrameRef.current = requestAnimationFrame(sampleAndAnimate)
      } catch (err) {
        if (isMounted) {
          setHasPermission(false)
        }
      }
    }

    startAudioAnalysis()

    return () => {
      isMounted = false
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current)
      }
      if (sourceRef.current) {
        try {
          sourceRef.current.disconnect()
        } catch {}
      }
      if (analyserRef.current) {
        try {
          analyserRef.current.disconnect()
        } catch {}
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        try {
          audioContextRef.current.close()
        } catch {}
      }
    }
  }, [isActive, barCount])

  return {
    frequencies,
    hasPermission,
  }
}
