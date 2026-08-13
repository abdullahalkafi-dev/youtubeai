'use client'

import { useEffect } from 'react'

export function useKeyboard(shortcuts: Record<string, () => void>) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const key = [
        e.metaKey || e.ctrlKey ? 'Mod' : '',
        e.shiftKey ? 'Shift' : '',
        e.altKey ? 'Alt' : '',
        e.key,
      ].filter(Boolean).join('+')

      if (shortcuts[key]) {
        e.preventDefault()
        shortcuts[key]()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [shortcuts])
}
