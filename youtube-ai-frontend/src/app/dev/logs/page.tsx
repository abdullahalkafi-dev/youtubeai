'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Copy,
  Check,
  Download,
  Filter,
  Flame,
  Globe,
  HelpCircle,
  Lock,
  Play,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  SlidersHorizontal,
  Terminal,
  Trash2,
  User,
  X,
  Zap,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts'
import api from '@/lib/api'
import type {
  HttpLogItem,
  LogStatsResponse,
  LogQueryParams,
  TopErrorEndpoint,
} from '@/types/dev-log'

// Date preset options
const DATE_PRESETS = [
  { label: 'Last 1 Hour', value: '1h' },
  { label: 'Last 24 Hours', value: '24h' },
  { label: 'Last 3 Days', value: '3d' },
  { label: 'Last 7 Days', value: '7d' },
  { label: 'Last 14 Days', value: '14d' },
  { label: 'All Time', value: 'all' },
] as const

interface StatusChip {
  label: string
  level: 'all' | 'error' | 'warn' | 'info'
  statusCode: string
  icon: React.ComponentType<{ className?: string }>
  color: string
  minDuration?: number
}

// Quick status filter presets
const STATUS_CHIPS: StatusChip[] = [
  { label: 'All Logs', level: 'all', statusCode: 'all', icon: Activity, color: 'text-gray-400 border-gray-700' },
  { label: '500 Server Errors', level: 'all', statusCode: '5xx', icon: Flame, color: 'text-rose-400 border-rose-500/30 bg-rose-500/10' },
  { label: '4xx Client Errors', level: 'all', statusCode: '4xx', icon: AlertTriangle, color: 'text-amber-400 border-amber-500/30 bg-amber-500/10' },
  { label: '2xx Success', level: 'all', statusCode: '2xx', icon: CheckCircle2, color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
  { label: 'Slow (>1000ms)', level: 'all', statusCode: 'all', minDuration: 1000, icon: Zap, color: 'text-purple-400 border-purple-500/30 bg-purple-500/10' },
]

export default function DevLogsPage() {
  const router = useRouter()
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Auth state check
  const [hasToken, setHasToken] = useState<boolean | null>(null)

  // Log state
  const [logs, setLogs] = useState<HttpLogItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)
  const [loading, setLoading] = useState(true)
  const [statsLoading, setStatsLoading] = useState(true)
  const [stats, setStats] = useState<LogStatsResponse | null>(null)

  // Filter state
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [level, setLevel] = useState<'all' | 'error' | 'warn' | 'info'>('all')
  const [statusCode, setStatusCode] = useState<string>('all')
  const [method, setMethod] = useState<string>('all')
  const [datePreset, setDatePreset] = useState<string>('14d')
  const [minDuration, setMinDuration] = useState<number | undefined>(undefined)
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')

  // UI Interactive state
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(0) // 0 = off
  const [selectedLog, setSelectedLog] = useState<HttpLogItem | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [testingError, setTestingError] = useState(false)
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null)
  const [showClearModal, setShowClearModal] = useState(false)
  const [clearing, setClearing] = useState(false)

  // Toast auto-hide
  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToastMessage({ text, type })
    setTimeout(() => setToastMessage(null), 4000)
  }

  // Check token on mount
  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
    setHasToken(!!token)
  }, [])

  // Keyboard shortcut listener (/ to search, Esc to close modal)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== searchInputRef.current) {
        e.preventDefault()
        searchInputRef.current?.focus()
      } else if (e.key === 'Escape') {
        if (selectedLog) setSelectedLog(null)
        if (showClearModal) setShowClearModal(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedLog, showClearModal])

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 350)
    return () => clearTimeout(timer)
  }, [search])

  // Compute startDate based on datePreset
  const computedDateRange = useMemo(() => {
    if (datePreset === 'custom') {
      return {
        startDate: customStartDate ? new Date(customStartDate).toISOString() : undefined,
        endDate: customEndDate ? new Date(customEndDate).toISOString() : undefined,
      }
    }
    const now = Date.now()
    if (datePreset === '1h') return { startDate: new Date(now - 60 * 60 * 1000).toISOString() }
    if (datePreset === '24h') return { startDate: new Date(now - 24 * 60 * 60 * 1000).toISOString() }
    if (datePreset === '3d') return { startDate: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString() }
    if (datePreset === '7d') return { startDate: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString() }
    if (datePreset === '14d') return { startDate: new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString() }
    return { startDate: undefined, endDate: undefined }
  }, [datePreset, customStartDate, customEndDate])

  // Fetch Logs
  const fetchLogs = useCallback(
    async (silent = false) => {
      if (!hasToken) return
      if (!silent) setLoading(true)

      try {
        const queryParams: LogQueryParams = {
          page,
          limit,
          level,
          statusCode,
          method,
          search: debouncedSearch || undefined,
          startDate: computedDateRange.startDate,
          endDate: computedDateRange.endDate,
          minDuration,
          sort: 'desc',
        }

        const data = await api.getDevLogs(queryParams)
        setLogs(data.logs || [])
        setTotal(data.total || 0)
        setTotalPages(data.totalPages || 1)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        showToast(`Failed to load logs: ${msg}`, 'error')
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [hasToken, page, limit, level, statusCode, method, debouncedSearch, computedDateRange, minDuration],
  )

  // Fetch Stats
  const fetchStats = useCallback(
    async (silent = false) => {
      if (!hasToken) return
      if (!silent) setStatsLoading(true)

      try {
        const days = datePreset === '7d' ? 7 : datePreset === '3d' ? 3 : datePreset === '24h' ? 1 : 14
        const data = await api.getDevLogStats(days)
        setStats(data)
      } catch (err: unknown) {
        console.error('Failed to load stats:', err)
      } finally {
        if (!silent) setStatsLoading(false)
      }
    },
    [hasToken, datePreset],
  )

  // Initial and reactive trigger
  useEffect(() => {
    if (hasToken) {
      fetchLogs()
      fetchStats()
    }
  }, [fetchLogs, fetchStats, hasToken])

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefreshInterval || autoRefreshInterval <= 0 || !hasToken) return

    const intervalId = setInterval(() => {
      fetchLogs(true)
      fetchStats(true)
    }, autoRefreshInterval * 1000)

    return () => clearInterval(intervalId)
  }, [autoRefreshInterval, fetchLogs, fetchStats, hasToken])

  // Copy to clipboard helper
  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2500)
    showToast('Copied to clipboard!', 'success')
  }

  // Trigger test 500 error
  const handleTriggerTestError = async () => {
    setTestingError(true)
    try {
      await api.triggerTestError()
    } catch (err: any) {
      // Expected error: 500
      showToast('Simulated 500 Error triggered successfully! Refreshing log stream...', 'success')
      setTimeout(() => {
        fetchLogs(true)
        fetchStats(true)
      }, 500)
    } finally {
      setTestingError(false)
    }
  }

  // Clear logs handler
  const handleClearLogs = async (onlyErrors = false) => {
    setClearing(true)
    try {
      const res = await api.clearDevLogs({ onlyErrors })
      showToast(`Purged ${res.deletedCount || 0} log records.`, 'success')
      setShowClearModal(false)
      fetchLogs()
      fetchStats()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      showToast(`Failed to purge logs: ${msg}`, 'error')
    } finally {
      setClearing(false)
    }
  }

  // Export logs to JSON
  const handleExportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(logs, null, 2))
    const downloadAnchor = document.createElement('a')
    downloadAnchor.setAttribute('href', dataStr)
    downloadAnchor.setAttribute('download', `server-logs-${new Date().toISOString()}.json`)
    document.body.appendChild(downloadAnchor)
    downloadAnchor.click()
    downloadAnchor.remove()
    showToast('Exported logs as JSON', 'success')
  }

  // Status badge styling helper
  const getStatusBadge = (code: number) => {
    if (code >= 500) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-mono font-bold rounded-md bg-rose-500/15 text-rose-400 border border-rose-500/30">
          <Flame className="w-3.5 h-3.5" />
          {code}
        </span>
      )
    }
    if (code >= 400) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-mono font-bold rounded-md bg-amber-500/15 text-amber-400 border border-amber-500/30">
          <AlertTriangle className="w-3.5 h-3.5" />
          {code}
        </span>
      )
    }
    if (code >= 300) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-mono font-bold rounded-md bg-blue-500/15 text-blue-400 border border-blue-500/30">
          {code}
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-mono font-bold rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
        <CheckCircle2 className="w-3.5 h-3.5" />
        {code}
      </span>
    )
  }

  // Method badge styling helper
  const getMethodBadge = (m: string) => {
    const map: Record<string, string> = {
      GET: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
      POST: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
      PUT: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
      DELETE: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
      PATCH: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    }
    return (
      <span
        className={`px-2 py-0.5 text-[11px] font-mono font-bold rounded border ${
          map[m] || 'bg-gray-800 text-gray-400 border-gray-700'
        }`}
      >
        {m}
      </span>
    )
  }

  // Latency styling helper
  const getLatencyBadge = (ms: number) => {
    if (ms > 3000) {
      return <span className="font-mono text-xs font-bold text-rose-400">{ms}ms</span>
    }
    if (ms > 1000) {
      return <span className="font-mono text-xs font-bold text-amber-400">{ms}ms</span>
    }
    return <span className="font-mono text-xs text-gray-400">{ms}ms</span>
  }

  // Formatted date
  const formatTime = (isoString?: string) => {
    if (!isoString) return '-'
    const d = new Date(isoString)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  const formatFullDate = (isoString?: string) => {
    if (!isoString) return '-'
    const d = new Date(isoString)
    return d.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  // If token check fails
  if (hasToken === false) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center shadow-2xl space-y-6">
          <div className="w-16 h-16 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-center justify-center mx-auto text-rose-400">
            <Lock className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-bold text-white">Authentication Required</h1>
            <p className="text-sm text-slate-400">
              The developer diagnostics console is restricted. Please sign in to access server telemetry and logs.
            </p>
          </div>
          <div className="pt-2">
            <button
              onClick={() => router.push('/login')}
              className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-xl transition shadow-lg shadow-indigo-600/25"
            >
              Sign In to Continue
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#090D16] text-slate-100 font-sans selection:bg-indigo-500 selection:text-white">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-6 right-6 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
          <div
            className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-2xl backdrop-blur-xl ${
              toastMessage.type === 'error'
                ? 'bg-rose-950/90 border-rose-800 text-rose-200'
                : toastMessage.type === 'success'
                ? 'bg-emerald-950/90 border-emerald-800 text-emerald-200'
                : 'bg-slate-900/90 border-slate-800 text-slate-200'
            }`}
          >
            {toastMessage.type === 'error' ? (
              <AlertTriangle className="w-5 h-5 text-rose-400" />
            ) : toastMessage.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            ) : (
              <Activity className="w-5 h-5 text-indigo-400" />
            )}
            <span className="text-sm font-medium">{toastMessage.text}</span>
            <button
              onClick={() => setToastMessage(null)}
              className="p-1 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Top Header Bar */}
      <header className="sticky top-0 z-30 bg-[#090D16]/90 backdrop-blur-xl border-b border-slate-800/80 px-6 py-4">
        <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition"
              title="Return to Main App"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
                  <Terminal className="w-4 h-4 text-white" />
                </div>
                <h1 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                  Developer Server Diagnostics
                  <span className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded-md bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 font-semibold">
                    Live Stream
                  </span>
                </h1>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                <span>Direct Console (MeccaAudio / Dev)</span>
                <span>•</span>
                <span className="text-emerald-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Auto-retention: 14d Errors / 7d Success
                </span>
              </p>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center gap-2.5">
            {/* Auto-Refresh Select */}
            <div className="flex items-center bg-slate-900/90 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-300 gap-2">
              <RefreshCw
                className={`w-3.5 h-3.5 text-slate-400 ${autoRefreshInterval > 0 ? 'animate-spin' : ''}`}
                style={{ animationDuration: '4s' }}
              />
              <span className="text-slate-400">Poll:</span>
              <select
                value={autoRefreshInterval}
                onChange={(e) => setAutoRefreshInterval(Number(e.target.value))}
                className="bg-transparent text-white focus:outline-none cursor-pointer font-medium"
              >
                <option value={0} className="bg-slate-900 text-white">Manual</option>
                <option value={3} className="bg-slate-900 text-white">Every 3s</option>
                <option value={5} className="bg-slate-900 text-white">Every 5s</option>
                <option value={15} className="bg-slate-900 text-white">Every 15s</option>
                <option value={30} className="bg-slate-900 text-white">Every 30s</option>
              </select>
            </div>

            {/* Refresh Button */}
            <button
              onClick={() => {
                fetchLogs()
                fetchStats()
                showToast('Refreshed logs and statistics', 'info')
              }}
              disabled={loading}
              className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:border-slate-700 transition"
              title="Manual Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            {/* Test 500 Crash Button */}
            <button
              onClick={handleTriggerTestError}
              disabled={testingError}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 hover:bg-rose-500/25 hover:border-rose-500/50 transition text-xs font-semibold"
              title="Simulates a 500 Server Error to test logging instantly"
            >
              <Flame className={`w-3.5 h-3.5 ${testingError ? 'animate-bounce' : ''}`} />
              {testingError ? 'Simulating...' : 'Test 500 Crash'}
            </button>

            {/* Export JSON */}
            <button
              onClick={handleExportJson}
              disabled={logs.length === 0}
              className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:border-slate-700 transition"
              title="Export Current View as JSON"
            >
              <Download className="w-4 h-4" />
            </button>

            {/* Clear Logs */}
            <button
              onClick={() => setShowClearModal(true)}
              className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-rose-400 hover:border-rose-900/50 transition"
              title="Purge Logs"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-6 space-y-6">
        {/* KPI Metrics Row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {/* Total Requests */}
          <div className="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-4 relative overflow-hidden backdrop-blur-md">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
              <span>Total Requests</span>
              <Activity className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="text-2xl font-bold text-white font-mono mt-2">
              {statsLoading ? '...' : stats?.summary.totalRequests.toLocaleString() || '0'}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">In last {datePreset} window</div>
          </div>

          {/* 500 Server Crashes */}
          <div className="bg-rose-950/30 border border-rose-800/40 rounded-2xl p-4 relative overflow-hidden backdrop-blur-md">
            <div className="flex items-center justify-between text-rose-300 text-xs font-semibold">
              <span>500 Server Crashes</span>
              <Flame className="w-4 h-4 text-rose-400 animate-pulse" />
            </div>
            <div className="text-2xl font-bold text-rose-400 font-mono mt-2">
              {statsLoading ? '...' : stats?.summary.total500Errors || 0}
            </div>
            <div className="text-[11px] text-rose-400/80 mt-1 font-medium">14-Day Retention Active</div>
          </div>

          {/* 4xx Client Errors */}
          <div className="bg-amber-950/20 border border-amber-800/40 rounded-2xl p-4 relative overflow-hidden backdrop-blur-md">
            <div className="flex items-center justify-between text-amber-300 text-xs font-semibold">
              <span>4xx Client Errors</span>
              <AlertTriangle className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl font-bold text-amber-400 font-mono mt-2">
              {statsLoading
                ? '...'
                : (stats?.summary.totalErrors || 0) - (stats?.summary.total500Errors || 0)}
            </div>
            <div className="text-[11px] text-amber-400/80 mt-1">Bad requests & auth errors</div>
          </div>

          {/* Success Rate */}
          <div className="bg-emerald-950/20 border border-emerald-800/40 rounded-2xl p-4 relative overflow-hidden backdrop-blur-md">
            <div className="flex items-center justify-between text-emerald-300 text-xs font-semibold">
              <span>Success Rate</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold text-emerald-400 font-mono mt-2">
              {statsLoading
                ? '...'
                : `${(100 - (stats?.summary.errorRatePercentage || 0)).toFixed(1)}%`}
            </div>
            <div className="text-[11px] text-emerald-400/80 mt-1">
              {stats?.summary.totalSuccess || 0} successful hits
            </div>
          </div>

          {/* Avg Latency */}
          <div className="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-4 relative overflow-hidden backdrop-blur-md">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
              <span>Avg Latency</span>
              <Clock className="w-4 h-4 text-purple-400" />
            </div>
            <div className="text-2xl font-bold text-white font-mono mt-2">
              {statsLoading ? '...' : `${stats?.summary.avgResponseTimeMs || 0}ms`}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">Global response speed</div>
          </div>
        </div>

        {/* Visual Charts & Leaderboard Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 14-Day Timeline Chart */}
          <div className="lg:col-span-2 bg-slate-900/60 border border-slate-800 rounded-2xl p-5 backdrop-blur-md">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Activity className="w-4 h-4 text-indigo-400" />
                  Traffic & Error Timeline
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Daily breakdown of Success vs Client 4xx vs 500 Server Crashes
                </p>
              </div>
              <div className="flex gap-1.5">
                {DATE_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => {
                      setDatePreset(p.value)
                      setPage(1)
                    }}
                    className={`px-2.5 py-1 text-xs rounded-lg font-medium transition ${
                      datePreset === p.value
                        ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                        : 'bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-64 w-full">
              {stats?.dailyTimeline && stats.dailyTimeline.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={stats.dailyTimeline}
                    margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="colorSuccess" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10B981" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#10B981" stopOpacity={0.0} />
                      </linearGradient>
                      <linearGradient id="color500" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#F43F5E" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="#F43F5E" stopOpacity={0.1} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" vertical={false} />
                    <XAxis
                      dataKey="date"
                      stroke="#64748B"
                      fontSize={11}
                      tickFormatter={(val) => val.slice(5)}
                    />
                    <YAxis stroke="#64748B" fontSize={11} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0F172A',
                        borderColor: '#334155',
                        borderRadius: '12px',
                        fontSize: '12px',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                    <Area
                      type="monotone"
                      dataKey="success"
                      name="Success (2xx)"
                      stroke="#10B981"
                      fillOpacity={1}
                      fill="url(#colorSuccess)"
                    />
                    <Area
                      type="monotone"
                      dataKey="errors"
                      name="Errors (4xx)"
                      stroke="#F59E0B"
                      fill="#F59E0B"
                      fillOpacity={0.2}
                    />
                    <Area
                      type="monotone"
                      dataKey="serverErrors500"
                      name="500 Crashes"
                      stroke="#F43F5E"
                      fillOpacity={1}
                      fill="url(#color500)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs">
                  <Activity className="w-8 h-8 text-slate-700 mb-2" />
                  No traffic activity recorded in this date range.
                </div>
              )}
            </div>
          </div>

          {/* Top Failing Endpoints Leaderboard */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 backdrop-blur-md flex flex-col">
            <div className="mb-3">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <Flame className="w-4 h-4 text-rose-400" />
                Top Failing Endpoints
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">APIs producing errors or 500 crashes</p>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 max-h-64 pr-1 scrollbar-thin">
              {stats?.topErrorEndpoints && stats.topErrorEndpoints.length > 0 ? (
                stats.topErrorEndpoints.map((ep: TopErrorEndpoint, i: number) => (
                  <button
                    key={i}
                    onClick={() => {
                      setSearch(ep.path)
                      setStatusCode('all')
                    }}
                    className="w-full text-left p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 hover:bg-slate-900 transition flex items-center justify-between gap-3 group"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {getMethodBadge(ep.method)}
                        <span className="text-xs font-mono text-slate-200 truncate group-hover:text-indigo-400 transition">
                          {ep.path}
                        </span>
                      </div>
                      {ep.lastError && (
                        <p className="text-[11px] text-rose-400/90 truncate mt-1 font-mono">
                          {ep.lastError}
                        </p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className="px-2 py-0.5 text-xs font-mono font-bold rounded bg-rose-500/15 text-rose-400 border border-rose-500/30">
                        {ep.count} errs
                      </span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs py-8">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500/40 mb-2" />
                  Zero failing endpoints in this window!
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Enhanced Filter & Search Bar */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3 backdrop-blur-md">
          {/* Row 1: Search Input & Quick Controls */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[280px] relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search endpoints, error messages, stack trace, user email, IP... (Press '/' to focus)"
                className="w-full pl-10 pr-10 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition font-mono"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Method Select */}
            <div className="flex items-center gap-1 bg-slate-950/80 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs">
              <span className="text-slate-400 font-medium">Method:</span>
              <select
                value={method}
                onChange={(e) => {
                  setMethod(e.target.value)
                  setPage(1)
                }}
                className="bg-transparent text-white font-mono focus:outline-none cursor-pointer"
              >
                <option value="all" className="bg-slate-900 text-white">ALL</option>
                <option value="GET" className="bg-slate-900 text-white">GET</option>
                <option value="POST" className="bg-slate-900 text-white">POST</option>
                <option value="PUT" className="bg-slate-900 text-white">PUT</option>
                <option value="PATCH" className="bg-slate-900 text-white">PATCH</option>
                <option value="DELETE" className="bg-slate-900 text-white">DELETE</option>
              </select>
            </div>

            {/* Limit selector */}
            <div className="flex items-center gap-1 bg-slate-950/80 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs">
              <span className="text-slate-400 font-medium">Per Page:</span>
              <select
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value))
                  setPage(1)
                }}
                className="bg-transparent text-white font-mono focus:outline-none cursor-pointer"
              >
                <option value={25} className="bg-slate-900 text-white">25</option>
                <option value={50} className="bg-slate-900 text-white">50</option>
                <option value={100} className="bg-slate-900 text-white">100</option>
                <option value={200} className="bg-slate-900 text-white">200</option>
              </select>
            </div>
          </div>

          {/* Row 2: Status Quick Filter Chips */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-800/60">
            <div className="flex flex-wrap items-center gap-2">
              {STATUS_CHIPS.map((chip, idx) => {
                const isActive =
                  chip.statusCode === statusCode &&
                  chip.level === level &&
                  chip.minDuration === minDuration
                const IconComponent = chip.icon
                return (
                  <button
                    key={idx}
                    onClick={() => {
                      setStatusCode(chip.statusCode)
                      setLevel(chip.level)
                      setMinDuration(chip.minDuration)
                      setPage(1)
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl border transition ${
                      isActive
                        ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-600/30'
                        : `${chip.color} hover:bg-slate-800/80`
                    }`}
                  >
                    <IconComponent className="w-3.5 h-3.5" />
                    {chip.label}
                  </button>
                )
              })}
            </div>

            <div className="text-xs text-slate-400 font-mono">
              Found <strong className="text-white">{total.toLocaleString()}</strong> logs
            </div>
          </div>
        </div>

        {/* Log Stream Table */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden backdrop-blur-md shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase text-[11px] tracking-wider">
                <tr>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-3 py-3 font-semibold">Method</th>
                  <th className="px-4 py-3 font-semibold">Endpoint Path</th>
                  <th className="px-4 py-3 font-semibold">Latency</th>
                  <th className="px-4 py-3 font-semibold">Error Message / Diagnostic</th>
                  <th className="px-4 py-3 font-semibold">User / Client</th>
                  <th className="px-4 py-3 font-semibold text-right">Time</th>
                  <th className="px-3 py-3 font-semibold text-center">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="py-16 text-center text-slate-400">
                      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                      Loading log records from MongoDB...
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-16 text-center text-slate-500">
                      <HelpCircle className="w-10 h-10 mx-auto mb-3 text-slate-600" />
                      <p className="text-sm text-slate-300 font-sans font-medium">No logs found matching your filters.</p>
                      <p className="text-xs text-slate-500 mt-1">Try resetting the search terms or widening the date range.</p>
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => {
                    const is500 = log.statusCode >= 500
                    const isError = log.statusCode >= 400
                    return (
                      <tr
                        key={log.id || log._id}
                        onClick={() => setSelectedLog(log)}
                        className={`cursor-pointer transition hover:bg-slate-800/60 ${
                          is500
                            ? 'bg-rose-950/15 hover:bg-rose-950/30'
                            : isError
                            ? 'bg-amber-950/10 hover:bg-amber-950/20'
                            : ''
                        }`}
                      >
                        {/* Status Code */}
                        <td className="px-4 py-3 whitespace-nowrap">{getStatusBadge(log.statusCode)}</td>

                        {/* HTTP Method */}
                        <td className="px-3 py-3 whitespace-nowrap">{getMethodBadge(log.method)}</td>

                        {/* Path */}
                        <td className="px-4 py-3 whitespace-nowrap max-w-[280px] truncate text-slate-200 font-medium">
                          {log.path}
                        </td>

                        {/* Latency */}
                        <td className="px-4 py-3 whitespace-nowrap">{getLatencyBadge(log.responseTimeMs)}</td>

                        {/* Error Message */}
                        <td className="px-4 py-3 max-w-[320px] truncate text-slate-400">
                          {log.errorMessage ? (
                            <span className="text-rose-400 font-semibold truncate block">
                              {log.errorMessage}
                            </span>
                          ) : (
                            <span className="text-slate-600">-</span>
                          )}
                        </td>

                        {/* User / Client */}
                        <td className="px-4 py-3 whitespace-nowrap text-slate-400">
                          {log.userEmail ? (
                            <span className="text-indigo-300 font-sans">{log.userEmail}</span>
                          ) : log.ip ? (
                            <span className="text-slate-500">{log.ip}</span>
                          ) : (
                            <span className="text-slate-600">Anonymous</span>
                          )}
                        </td>

                        {/* Timestamp */}
                        <td className="px-4 py-3 whitespace-nowrap text-right text-slate-400" title={log.createdAt}>
                          {formatTime(log.createdAt)}
                        </td>

                        {/* Inspect action */}
                        <td className="px-3 py-3 text-center whitespace-nowrap">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedLog(log)
                            }}
                            className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white hover:bg-indigo-600 transition"
                            title="Inspect Diagnostics"
                          >
                            <Terminal className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <div className="bg-slate-950/80 border-t border-slate-800 px-6 py-3.5 flex items-center justify-between">
            <div className="text-xs text-slate-400 font-mono">
              Page <span className="text-white font-bold">{page}</span> of{' '}
              <span className="text-white font-bold">{totalPages}</span> ({total} total records)
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300 hover:text-white hover:border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300 hover:text-white hover:border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Deep Diagnostic Slide-Over Drawer / Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#0D1321] border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden font-mono">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div className="flex items-center gap-3">
                {getStatusBadge(selectedLog.statusCode)}
                {getMethodBadge(selectedLog.method)}
                <span className="text-sm font-bold text-white truncate max-w-lg">{selectedLog.path}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => copyToClipboard(JSON.stringify(selectedLog, null, 2), 'modal-full-json')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 text-xs text-slate-300 hover:text-white hover:bg-slate-700 transition"
                  title="Copy Full Log Object as JSON"
                >
                  {copiedKey === 'modal-full-json' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  Copy JSON
                </button>
                <button
                  onClick={() => setSelectedLog(null)}
                  className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
              {/* Meta info grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <div className="text-slate-500 text-[10px] uppercase">Timestamp</div>
                  <div className="text-white font-medium mt-1">{formatFullDate(selectedLog.createdAt)}</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <div className="text-slate-500 text-[10px] uppercase">Duration</div>
                  <div className="text-white font-medium mt-1">{selectedLog.responseTimeMs} ms</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <div className="text-slate-500 text-[10px] uppercase">Client IP</div>
                  <div className="text-white font-medium mt-1">{selectedLog.ip || 'Unknown'}</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                  <div className="text-slate-500 text-[10px] uppercase">Auto-Purge Date</div>
                  <div className="text-emerald-400 font-medium mt-1">
                    {formatFullDate(selectedLog.expiresAt)}
                  </div>
                </div>
              </div>

              {/* Error Stack Diagnostic Block (CRITICAL FOR 500s) */}
              {(selectedLog.errorMessage || selectedLog.errorStack) && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-rose-400 flex items-center gap-1.5 text-sm">
                      <Flame className="w-4 h-4" />
                      Exception Stack Trace
                    </span>
                    {selectedLog.errorStack && (
                      <button
                        onClick={() => copyToClipboard(selectedLog.errorStack!, 'stack-copy')}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 transition text-xs font-semibold"
                      >
                        {copiedKey === 'stack-copy' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        Copy Stack Trace
                      </button>
                    )}
                  </div>
                  <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-900/50 text-rose-200 overflow-x-auto whitespace-pre font-mono text-[11px] leading-relaxed shadow-inner">
                    <strong className="text-rose-400 text-xs block mb-2">{selectedLog.errorMessage}</strong>
                    {selectedLog.errorStack || 'No stack trace captured.'}
                  </div>
                </div>
              )}

              {/* Request Payload */}
              {selectedLog.requestBody && Object.keys(selectedLog.requestBody).length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-300">Request Body (Sanitized)</span>
                    <button
                      onClick={() =>
                        copyToClipboard(
                          typeof selectedLog.requestBody === 'string'
                            ? selectedLog.requestBody
                            : JSON.stringify(selectedLog.requestBody, null, 2),
                          'body-copy',
                        )
                      }
                      className="text-slate-400 hover:text-white flex items-center gap-1 text-[11px]"
                    >
                      {copiedKey === 'body-copy' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      Copy
                    </button>
                  </div>
                  <pre className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-indigo-300 overflow-x-auto whitespace-pre font-mono text-[11px]">
                    {typeof selectedLog.requestBody === 'string'
                      ? selectedLog.requestBody
                      : JSON.stringify(selectedLog.requestBody, null, 2)}
                  </pre>
                </div>
              )}

              {/* Request Query Parameters */}
              {selectedLog.requestQuery && Object.keys(selectedLog.requestQuery).length > 0 && (
                <div className="space-y-2">
                  <span className="font-semibold text-slate-300">Query Parameters</span>
                  <pre className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-sky-300 overflow-x-auto whitespace-pre font-mono text-[11px]">
                    {JSON.stringify(selectedLog.requestQuery, null, 2)}
                  </pre>
                </div>
              )}

              {/* Client & User Details */}
              <div className="space-y-2">
                <span className="font-semibold text-slate-300">Client Context</span>
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-slate-300 font-mono text-[11px]">
                  <div className="flex gap-2">
                    <span className="text-slate-500 w-24">User Email:</span>
                    <span className="text-white">{selectedLog.userEmail || 'Unauthenticated'}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-slate-500 w-24">User ID:</span>
                    <span className="text-white">{selectedLog.userId || 'N/A'}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-slate-500 w-24">User Agent:</span>
                    <span className="text-slate-400 break-all">{selectedLog.userAgent || 'Unknown'}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-slate-500 w-24">Full URL:</span>
                    <span className="text-indigo-400 break-all">{selectedLog.url}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div className="text-[11px] text-slate-500">
                Log ID: <span className="text-slate-400 font-mono">{selectedLog.id || selectedLog._id}</span>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition"
              >
                Close Diagnostic View
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear Logs Confirmation Modal */}
      {showClearModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#0D1321] border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-5">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Purge Developer Logs</h3>
                <p className="text-xs text-slate-400">Choose logs purge option</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Logs are automatically cleaned up by MongoDB (14 days for errors, 7 days for successes). You can manually purge records now if needed.
            </p>

            <div className="space-y-2">
              <button
                onClick={() => handleClearLogs(true)}
                disabled={clearing}
                className="w-full py-2.5 px-4 bg-amber-500/15 border border-amber-500/30 hover:bg-amber-500/25 text-amber-300 font-semibold rounded-xl text-xs transition flex items-center justify-center gap-2"
              >
                <AlertTriangle className="w-4 h-4" />
                Purge Only Error Logs (4xx & 5xx)
              </button>
              <button
                onClick={() => handleClearLogs(false)}
                disabled={clearing}
                className="w-full py-2.5 px-4 bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded-xl text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-rose-600/25"
              >
                <Trash2 className="w-4 h-4" />
                Purge All HTTP Logs
              </button>
            </div>

            <div className="pt-1">
              <button
                onClick={() => setShowClearModal(false)}
                className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-xl font-medium transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
