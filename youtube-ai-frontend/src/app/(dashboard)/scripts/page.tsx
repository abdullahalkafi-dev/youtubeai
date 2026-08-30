'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  FileText,
  Search,
  Plus,
  Clock,
  BookOpen,
  Filter,
  Sparkles,
  Loader2,
  RefreshCw,
  Star,
  Layers,
} from 'lucide-react'
import { useAppSelector } from '@/store/hooks'
import { toast } from 'sonner'
import api from '@/lib/api'
import { ScriptCard } from '@/components/scripts/script-card'
import { AddScriptModal } from '@/components/scripts/add-script-modal'
import { TeleprompterEditorModal } from '@/components/scripts/editor/teleprompter-editor-modal'
import { VersionHistoryModal } from '@/components/scripts/version-history-modal'
import { FullscreenTeleprompter } from '@/components/scripts/teleprompter/fullscreen-teleprompter'
import type { ScriptItem, ScriptStats } from '@/types/script'

export default function ScriptsPage() {
  const channelId = useAppSelector((state) => state.auth.activeChannelId) || ''

  const [scripts, setScripts] = useState<ScriptItem[]>([])
  const [stats, setStats] = useState<ScriptStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [timeFilter, setTimeFilter] = useState<'all' | 'today' | 'week' | 'month'>('all')
  const [sortBy, setSortBy] = useState<'recent' | 'duration' | 'title'>('recent')
  const [favoriteOnly, setFavoriteOnly] = useState(false)

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false)
  const [activeTeleprompterScript, setActiveTeleprompterScript] = useState<ScriptItem | null>(null)
  const [activeEditorScript, setActiveEditorScript] = useState<ScriptItem | null>(null)
  const [activeHistoryScript, setActiveHistoryScript] = useState<ScriptItem | null>(null)

  // 300ms Search Debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const loadData = useCallback(async () => {
    if (!channelId) return
    setLoading(true)
    try {
      if (debouncedQuery.trim()) {
        const searchRes = await api.searchScripts(channelId, debouncedQuery.trim())
        setScripts(searchRes.items || [])
      } else {
        const [listRes, statsRes] = await Promise.all([
          api.getScripts(channelId, {
            source: sourceFilter !== 'all' ? sourceFilter : undefined,
            timeFilter: timeFilter !== 'all' ? timeFilter : undefined,
            sortBy,
            favoriteOnly: favoriteOnly ? 'true' : undefined,
            limit: 50,
          }),
          api.getScriptStats(channelId).catch(() => null),
        ])
        setScripts(listRes.items || [])
        if (statsRes) setStats(statsRes)
      }
    } catch (err: any) {
      console.error('Failed to load scripts:', err)
    } finally {
      setLoading(false)
    }
  }, [channelId, debouncedQuery, sourceFilter, timeFilter, sortBy, favoriteOnly])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this script and its version history?')) return
    try {
      await api.deleteScript(channelId, id)
      setScripts((prev) => prev.filter((s) => (s.id || s._id) !== id))
      toast.success('Script deleted successfully')
    } catch (err: any) {
      toast.error(`Delete failed: ${err.message}`)
    }
  }

  const handleToggleFavorite = async (id: string) => {
    try {
      const updated = await api.toggleFavoriteScript(channelId, id)
      setScripts((prev) =>
        prev.map((s) => ((s.id || s._id) === id ? { ...s, isFavorite: updated.isFavorite } : s))
      )
      toast.success(updated.isFavorite ? 'Added to favorites' : 'Removed from favorites')
    } catch (err: any) {
      toast.error(`Favorite toggle failed: ${err.message}`)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Top Header & Analytics */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-amber-500/10 text-amber-500">
              <FileText className="w-6 h-6" />
            </span>
            <span>Scripts & Teleprompter Studio</span>
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Manage, edit, format, and broadcast your teleprompter scripts with RRF hybrid search and version tracking.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm flex items-center space-x-2 transition active:scale-95 shadow-md"
          >
            <Plus className="w-4 h-4" />
            <span>Add Script</span>
          </button>
        </div>
      </div>

      {/* Stats Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 flex items-center space-x-4 shadow-sm">
          <div className="p-3 rounded-xl bg-amber-500/10 text-amber-500">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Total Scripts</p>
            <p className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
              {stats?.totalScripts || scripts.length}
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 flex items-center space-x-4 shadow-sm">
          <div className="p-3 rounded-xl bg-indigo-500/10 text-indigo-500">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Spoken Hours</p>
            <p className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
              {stats?.totalSpokenHours || 0} hrs
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 flex items-center space-x-4 shadow-sm">
          <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-500">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Avg Word Count</p>
            <p className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
              {stats?.averageWordCount?.toLocaleString() || 0} words
            </p>
          </div>
        </div>
      </div>

      {/* Filter & Hybrid Search Bar */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 space-y-3 shadow-sm">
        <div className="flex flex-col md:flex-row items-center gap-3">
          {/* Hybrid Search Input */}
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search scripts via semantic vector search & text matching (e.g. 'plea deal durk')..."
              className="w-full pl-10 pr-4 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-sm focus:outline-none focus:border-amber-500 dark:text-zinc-100 placeholder:text-zinc-400"
            />
          </div>

          {/* Quick Filters */}
          <div className="flex items-center gap-2 flex-wrap w-full md:w-auto">
            {/* Time Filter */}
            <select
              value={timeFilter}
              onChange={(e) => setTimeFilter(e.target.value as any)}
              className="px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-xs font-medium focus:outline-none focus:border-amber-500 dark:text-zinc-200"
            >
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
            </select>

            {/* Source Filter */}
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-xs font-medium focus:outline-none focus:border-amber-500 dark:text-zinc-200"
            >
              <option value="all">All Sources</option>
              <option value="ai_chat">AI Chat Generated</option>
              <option value="manual_import">Manual Import</option>
              <option value="ai_beautified">AI Beautified</option>
            </select>

            {/* Sort Selector */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-xs font-medium focus:outline-none focus:border-amber-500 dark:text-zinc-200"
            >
              <option value="recent">Most Recent</option>
              <option value="duration">Longest Read Time</option>
              <option value="title">Title (A-Z)</option>
            </select>

            {/* Favorite Filter Toggle */}
            <button
              onClick={() => setFavoriteOnly((prev) => !prev)}
              className={`px-3 py-2 rounded-xl border text-xs font-bold flex items-center space-x-1.5 transition ${
                favoriteOnly
                  ? 'bg-amber-500/10 border-amber-500 text-amber-500'
                  : 'bg-zinc-50 dark:bg-zinc-800/60 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:text-amber-500'
              }`}
            >
              <Star className={`w-3.5 h-3.5 ${favoriteOnly ? 'fill-current' : ''}`} />
              <span>Favorites</span>
            </button>
          </div>
        </div>
      </div>

      {/* Script Grid List */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500 mb-3" />
          <p className="text-sm">Loading scripts library...</p>
        </div>
      ) : scripts.length === 0 ? (
        <div className="text-center py-20 bg-white dark:bg-zinc-900 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-3xl p-8 space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center mx-auto">
            <FileText className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
              No scripts found
            </h3>
            <p className="text-xs text-zinc-500 max-w-sm mx-auto mt-1">
              Generate a script from AI Content Chat and click &ldquo;Save to Library&rdquo;, or create one manually using the button above.
            </p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs inline-flex items-center space-x-1.5 transition active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create First Script</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {scripts.map((script) => (
            <ScriptCard
              key={script.id || script._id}
              script={script}
              channelId={channelId}
              onDelete={handleDelete}
              onToggleFavorite={handleToggleFavorite}
              onOpenTeleprompter={(s) => setActiveTeleprompterScript(s)}
              onOpenEditor={(s) => setActiveEditorScript(s)}
              onOpenHistory={(s) => setActiveHistoryScript(s)}
            />
          ))}
        </div>
      )}

      {/* Add Script Modal */}
      <AddScriptModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        channelId={channelId}
        onScriptCreated={(newScript) => {
          setScripts((prev) => [newScript, ...prev])
          loadData()
        }}
      />

      {/* Visual Editor Modal */}
      {activeEditorScript && (
        <TeleprompterEditorModal
          isOpen={!!activeEditorScript}
          onClose={() => setActiveEditorScript(null)}
          channelId={channelId}
          script={activeEditorScript}
          onSaved={(updated) => {
            setScripts((prev) =>
              prev.map((s) => ((s.id || s._id) === (updated.id || updated._id) ? updated : s))
            )
            setActiveEditorScript(null)
          }}
        />
      )}

      {/* Version History Modal */}
      {activeHistoryScript && (
        <VersionHistoryModal
          isOpen={!!activeHistoryScript}
          onClose={() => setActiveHistoryScript(null)}
          channelId={channelId}
          scriptId={activeHistoryScript.id || activeHistoryScript._id || ''}
          currentVersion={activeHistoryScript.currentVersion || 1}
          onRestored={() => {
            loadData()
            setActiveHistoryScript(null)
          }}
        />
      )}

      {/* Fullscreen Teleprompter Studio Overlay */}
      {activeTeleprompterScript && (
        <FullscreenTeleprompter
          isOpen={!!activeTeleprompterScript}
          onClose={() => setActiveTeleprompterScript(null)}
          title={activeTeleprompterScript.title}
          content={activeTeleprompterScript.content}
          wordCount={activeTeleprompterScript.wordCount}
          estimatedDurationMinutes={activeTeleprompterScript.estimatedDurationMinutes}
        />
      )}
    </div>
  )
}
