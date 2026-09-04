'use client'

import React, { useState, useEffect } from 'react'
import { X, History, RotateCcw, Clock, User, Check, AlertCircle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import api from '@/lib/api'
import type { ScriptVersionItem } from '@/types/script'

interface VersionHistoryModalProps {
  isOpen: boolean
  onClose: () => void
  channelId: string
  scriptId: string
  currentVersion: number
  onRestored: (restoredScript?: any) => void
}

export function VersionHistoryModal({
  isOpen,
  onClose,
  channelId,
  scriptId,
  currentVersion,
  onRestored,
}: VersionHistoryModalProps) {
  const [currentVer, setCurrentVer] = useState(currentVersion)
  const [versions, setVersions] = useState<ScriptVersionItem[]>([])
  const [loading, setLoading] = useState(false)
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null)
  const [selectedVersion, setSelectedVersion] = useState<ScriptVersionItem | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (currentVersion) setCurrentVer(currentVersion)
  }, [currentVersion])

  useEffect(() => {
    if (!isOpen || !scriptId) return

    async function loadVersions() {
      setLoading(true)
      setError(null)
      try {
        const [data, scriptDoc] = await Promise.all([
          api.getScriptVersions(channelId, scriptId),
          api.getScript(channelId, scriptId).catch(() => null),
        ])
        setVersions(data)
        if (scriptDoc?.currentVersion) {
          setCurrentVer(scriptDoc.currentVersion)
        } else if (data.length > 0) {
          const maxVer = Math.max(...data.map((v) => v.versionNumber))
          if (maxVer > currentVer) {
            setCurrentVer(maxVer)
          }
        }
        if (data.length > 0) {
          setSelectedVersion(data[0])
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load version history')
      } finally {
        setLoading(false)
      }
    }

    loadVersions()
  }, [isOpen, channelId, scriptId])

  const handleRestore = async (versionNumber: number) => {
    if (!confirm(`Are you sure you want to restore Version ${versionNumber}? This will create a new version snapshot based on Version ${versionNumber}.`)) {
      return
    }

    setRestoringVersion(versionNumber)
    try {
      const restored = await api.restoreScriptVersion(channelId, scriptId, versionNumber, currentVer)
      toast.success(`Successfully restored Version ${versionNumber}!`)
      onRestored(restored)
      onClose()
    } catch (err: any) {
      toast.error(`Restore failed: ${err.message}`)
    } finally {
      setRestoringVersion(null)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <History className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
              Version History
            </h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 font-semibold">
              Current: v{currentVer}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Version List Sidebar */}
          <div className="w-1/3 border-r border-zinc-200 dark:border-zinc-800 overflow-y-auto p-3 space-y-2">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-zinc-400 text-sm">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                Loading versions...
              </div>
            ) : error ? (
              <div className="p-4 text-xs text-red-500 flex items-center space-x-2">
                <AlertCircle className="w-4 h-4" />
                <span>{error}</span>
              </div>
            ) : versions.length === 0 ? (
              <div className="text-center py-8 text-xs text-zinc-400">
                No versions recorded yet.
              </div>
            ) : (
              versions.map((ver) => {
                const isSelected = selectedVersion?.versionNumber === ver.versionNumber
                const isCurrent = ver.versionNumber === currentVer

                return (
                  <div
                    key={ver.versionNumber}
                    onClick={() => setSelectedVersion(ver)}
                    className={`p-3 rounded-xl cursor-pointer border transition-all ${
                      isSelected
                        ? 'border-amber-500 bg-amber-500/10 dark:bg-amber-500/5 shadow-sm'
                        : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                          v{ver.versionNumber}
                        </span>
                        {isCurrent && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold uppercase">
                            Current
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-zinc-400 font-mono">
                        {ver.wordCount} words
                      </span>
                    </div>

                    <p className="text-xs text-zinc-600 dark:text-zinc-400 truncate mb-1">
                      {ver.changeDescription || ver.title}
                    </p>

                    <div className="flex items-center justify-between text-[10px] text-zinc-400">
                      <span className="flex items-center space-x-1">
                        <Clock className="w-3 h-3" />
                        <span>{new Date(ver.createdAt).toLocaleDateString()}</span>
                      </span>
                      <span className="capitalize">{ver.createdBy.replace('_', ' ')}</span>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Preview Panel */}
          <div className="w-2/3 flex flex-col bg-zinc-50 dark:bg-zinc-950/50 overflow-hidden">
            {selectedVersion ? (
              <>
                <div className="px-6 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-white dark:bg-zinc-900">
                  <div>
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                      Version {selectedVersion.versionNumber} Preview
                    </h3>
                    <p className="text-xs text-zinc-500">
                      {selectedVersion.estimatedDurationMinutes} min read · {selectedVersion.wordCount} words · Created {new Date(selectedVersion.createdAt).toLocaleString()}
                    </p>
                  </div>

                  {selectedVersion.versionNumber !== currentVersion && (
                    <button
                      onClick={() => handleRestore(selectedVersion.versionNumber)}
                      disabled={restoringVersion !== null}
                      className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-black font-bold text-xs flex items-center space-x-1.5 transition active:scale-95 disabled:opacity-50"
                    >
                      {restoringVersion === selectedVersion.versionNumber ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="w-3.5 h-3.5" />
                      )}
                      <span>Restore this Version</span>
                    </button>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto p-6 text-xs font-mono leading-relaxed text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap select-text">
                  {selectedVersion.content}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-zinc-400">
                Select a version from the left to preview
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
