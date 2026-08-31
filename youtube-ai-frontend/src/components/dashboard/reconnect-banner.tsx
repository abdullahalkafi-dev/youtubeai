'use client'

import React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useAppSelector } from '@/store/hooks'
import api from '@/lib/api'

export function ReconnectBanner() {
  const user = useAppSelector((s) => s.auth.user)
  const channels = useAppSelector((s) => s.auth.channels)
  const activeChannelId = useAppSelector((s) => s.auth.activeChannelId)

  const activeChannel = channels.find(
    (c) => c.id === activeChannelId || (c as any)._id === activeChannelId,
  )

  // Show banner if user has no Google token or if token is marked expired
  const needsReconnect = user && (!user.hasGoogleToken || user.isGoogleTokenExpired)

  if (!needsReconnect) return null

  const handleReconnect = () => {
    window.location.href = api.getGoogleAuthUrl()
  }

  return (
    <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-900 dark:text-amber-200">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold flex items-center gap-2">
              YouTube Authorization Required
              {activeChannel?.name && (
                <span className="text-xs font-normal text-amber-700 dark:text-amber-300">
                  for &quot;{activeChannel.name}&quot;
                </span>
              )}
            </h4>
            <p className="text-xs text-amber-700/90 dark:text-amber-300/90 mt-0.5">
              Your Google/YouTube connection has expired or is disconnected. Reconnect with Google to restore automated sync, AI SEO optimization, and live publishing.
            </p>
          </div>
        </div>

        <button
          onClick={handleReconnect}
          className="shrink-0 w-full sm:w-auto px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 shadow-sm transition"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Reconnect with Google
        </button>
      </div>
    </div>
  )
}
