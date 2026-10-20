'use client'

import React, { useEffect, useState } from 'react'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import api from '@/lib/api'
import { OPENAI_BILLING_URL } from '@/lib/error-handler'

const POLL_MS = 60_000

/**
 * Shown while the backend reports that the OpenAI account is out of credits.
 * Auto-comments and the daily SEO batch pause by themselves and resume once credits are added.
 */
export function OpenAiCreditsBanner() {
  const [exhausted, setExhausted] = useState(false)

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const status = await api.getOpenAiStatus()
        if (!cancelled) setExhausted(Boolean(status?.exhausted))
      } catch {
        // Status is best-effort; never block the dashboard on it.
      }
    }
    check()
    const timer = setInterval(check, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  if (!exhausted) return null

  return (
    <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-900 dark:text-red-200">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-red-500/20 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0 mt-0.5">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold">No OpenAI credits available</h4>
            <p className="text-xs text-red-700/90 dark:text-red-300/90 mt-0.5">
              AI features are paused: script writing, SEO, thumbnails and automatic comment replies. Add credits on OpenAI and
              everything resumes by itself.
            </p>
          </div>
        </div>

        <a
          href={OPENAI_BILLING_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 w-full sm:w-auto px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 shadow-sm transition"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Add credits on OpenAI
        </a>
      </div>
    </div>
  )
}
