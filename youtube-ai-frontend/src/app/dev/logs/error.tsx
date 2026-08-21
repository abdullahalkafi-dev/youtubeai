'use client'

import React, { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, RefreshCw, ArrowLeft, Terminal } from 'lucide-react'

export default function DevLogsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Dev Logs Route Error:', error)
  }, [error])

  return (
    <div className="min-h-screen bg-[#070B14] text-slate-100 flex items-center justify-center p-6 font-mono">
      <div className="max-w-lg w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl space-y-6">
        <div className="flex items-center gap-3 text-rose-400">
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white">Diagnostics Console Error</h1>
            <p className="text-xs text-slate-400">An unexpected client exception occurred</p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-rose-950/20 border border-rose-900/40 text-rose-300 text-xs overflow-x-auto whitespace-pre-wrap">
          {error?.message || 'Unknown runtime error in dev logs'}
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => reset()}
            className="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/25"
          >
            <RefreshCw className="w-4 h-4" />
            Retry Loading Logs
          </button>
          <Link
            href="/dashboard"
            className="py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl text-xs transition flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
