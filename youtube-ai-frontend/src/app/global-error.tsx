'use client'

import React from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-zinc-950 text-white p-6">
        <div className="text-center space-y-4 max-w-md">
          <h2 className="text-2xl font-bold text-zinc-100">Something went wrong</h2>
          <p className="text-sm text-zinc-400">
            {error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => reset()}
            className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-xl transition shadow-lg shadow-amber-500/20"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
