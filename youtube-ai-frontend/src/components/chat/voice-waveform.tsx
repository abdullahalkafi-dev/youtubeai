'use client'

import { cn } from '@/lib/utils'

interface VoiceWaveformProps {
  frequencies: number[]
  isActive?: boolean
  className?: string
}

export function VoiceWaveform({ frequencies, isActive = true, className }: VoiceWaveformProps) {
  // Ensure we always have 8 frequency values
  const bars = frequencies.length >= 8 ? frequencies.slice(0, 8) : [...frequencies, ...new Array(8 - frequencies.length).fill(0)]

  // Calculate overall volume to determine if user is actively speaking vs silent pause
  const totalEnergy = bars.reduce((acc, v) => acc + v, 0)
  const isSpeaking = totalEnergy > 15

  return (
    <div className={cn('flex items-center justify-center gap-1.5 h-9 px-3', className)}>
      {bars.map((value, idx) => {
        // Dynamic height between 5px and 30px
        const normalizedHeight = Math.max(5, Math.min(32, Math.round((value / 255) * 30) + 5))

        // Center-weighted visual curve (bars in middle are naturally taller like audio waves)
        const centerMultiplier = idx === 3 || idx === 4 ? 1.15 : idx === 2 || idx === 5 ? 1.05 : 0.95
        const finalHeight = Math.min(32, Math.round(normalizedHeight * centerMultiplier))

        return (
          <div
            key={idx}
            className="flex items-center justify-center w-1.5 h-8"
          >
            <span
              style={{ height: `${isActive ? finalHeight : 5}px` }}
              className={cn(
                'w-1.5 rounded-full transition-all duration-75 ease-out shadow-xs',
                isSpeaking
                  ? 'bg-gradient-to-t from-indigo-600 via-purple-500 to-pink-500 shadow-indigo-500/40'
                  : 'bg-gradient-to-t from-indigo-400 to-purple-400 opacity-60'
              )}
            />
          </div>
        )
      })}
    </div>
  )
}
