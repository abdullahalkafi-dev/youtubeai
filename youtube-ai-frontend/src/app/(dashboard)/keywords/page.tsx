'use client'

import { useState } from 'react'
import { useAppSelector } from '@/store/hooks'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Search, TrendingUp, Target, ChevronRight, Zap, BarChart3, Lightbulb, ExternalLink } from 'lucide-react'

interface KeywordResult {
  keyword: string
  suggestions: string[]
  expanded: string[]
  searchDemand: number
  competition: number
  overallScore: number
  topVideos: Array<{ title: string; views: number; channel: string; tags: string[] }>
}

export default function KeywordsPage() {
  const channelId = useAppSelector((s) => s.auth.activeChannelId)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<KeywordResult | null>(null)
  const [related, setRelated] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const handleResearch = async () => {
    if (!query.trim() || !channelId) return
    setLoading(true)
    setError(null)
    setResult(null)
    setRelated([])

    try {
      const [researchResult, relatedResult] = await Promise.all([
        api.researchKeyword(channelId, query.trim()),
        api.getRelatedKeywords(channelId, query.trim()),
      ])
      setResult(researchResult)
      setRelated(relatedResult)
    } catch (err: any) {
      setError(err.message || 'Failed to research keyword')
    } finally {
      setLoading(false)
    }
  }

  const handleRelatedClick = (keyword: string) => {
    setQuery(keyword)
    setTimeout(() => {
      const btn = document.getElementById('research-btn')
      btn?.click()
    }, 100)
  }

  const getScoreColor = (score: number) => {
    if (score >= 70) return { text: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-500/10', border: 'border-emerald-200 dark:border-emerald-500/20', gradient: 'from-emerald-500 to-green-400' }
    if (score >= 40) return { text: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-500/10', border: 'border-amber-200 dark:border-amber-500/20', gradient: 'from-amber-500 to-yellow-400' }
    return { text: 'text-red-600', bg: 'bg-red-50 dark:bg-red-500/10', border: 'border-red-200 dark:border-red-500/20', gradient: 'from-red-500 to-rose-400' }
  }

  const getScoreLabel = (score: number) => {
    if (score >= 70) return 'GREENLIGHT'
    if (score >= 40) return 'HOLD'
    return 'PASS'
  }

  const formatViews = (views: number) => {
    if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M`
    if (views >= 1000) return `${(views / 1000).toFixed(1)}K`
    return views.toLocaleString()
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Search className="w-6 h-6 text-indigo-500" />
          Keyword Research
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Research keywords before writing scripts — see real search demand and competition
        </p>
      </div>

      {/* Search Bar */}
      <Card className="border-0 shadow-lg bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-500/10 dark:to-purple-500/10">
        <CardContent className="pt-6">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleResearch()}
                placeholder="Enter a keyword to research (e.g., 'young thug trial', 'federal prison')..."
                className="w-full pl-10 pr-4 py-3 text-sm border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent shadow-sm"
              />
            </div>
            <button
              id="research-btn"
              onClick={handleResearch}
              disabled={loading || !query.trim()}
              className="px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-medium rounded-xl hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-500/25"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                  Researching...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Zap className="w-4 h-4" />
                  Research
                </span>
              )}
            </button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Overall Score - Big Gauge */}
          <Card className="border-0 shadow-lg overflow-hidden">
            <div className={`h-2 bg-gradient-to-r ${getScoreColor(result.overallScore).gradient}`} />
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-indigo-500" />
                Overall Score
              </CardTitle>
            </CardHeader>
            <CardContent className="text-center pb-6">
              {/* SVG Circular Gauge */}
              <div className="relative inline-block">
                <svg width="140" height="140" viewBox="0 0 140 140" className="transform -rotate-90">
                  {/* Background circle */}
                  <circle
                    cx="70" cy="70" r="60"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="8"
                    className="text-gray-100 dark:text-gray-800"
                  />
                  {/* Progress circle */}
                  <circle
                    cx="70" cy="70" r="60"
                    fill="none"
                    stroke="url(#scoreGradient)"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={`${(result.overallScore / 100) * 377} 377`}
                    className="transition-all duration-1000 ease-out"
                  />
                  <defs>
                    <linearGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" className={`${result.overallScore >= 70 ? 'stop-color-emerald-500' : result.overallScore >= 40 ? 'stop-color-amber-500' : 'stop-color-red-500'}`} />
                      <stop offset="100%" className={`${result.overallScore >= 70 ? 'stop-color-green-400' : result.overallScore >= 40 ? 'stop-color-yellow-400' : 'stop-color-rose-400'}`} />
                    </linearGradient>
                  </defs>
                </svg>
                {/* Score text in center */}
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className={`text-4xl font-bold ${getScoreColor(result.overallScore).text}`}>
                    {result.overallScore}
                  </span>
                  <span className={`text-[10px] font-semibold uppercase tracking-wider ${getScoreColor(result.overallScore).text}`}>
                    {getScoreLabel(result.overallScore)}
                  </span>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-4">Based on search demand + competition</p>
            </CardContent>
          </Card>

          {/* Search Demand */}
          <Card className="border-0 shadow-lg">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-500" />
                Search Demand
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Demand bar */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-500">How many people search for this</span>
                    <span className={`text-lg font-bold ${result.searchDemand >= 70 ? 'text-emerald-600' : result.searchDemand >= 40 ? 'text-amber-600' : 'text-red-600'}`}>
                      {result.searchDemand}%
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-4 overflow-hidden">
                    <div
                      className={`h-4 rounded-full transition-all duration-1000 ease-out bg-gradient-to-r ${result.searchDemand >= 70 ? 'from-emerald-500 to-green-400' : result.searchDemand >= 40 ? 'from-amber-500 to-yellow-400' : 'from-red-500 to-rose-400'}`}
                      style={{ width: `${result.searchDemand}%` }}
                    />
                  </div>
                </div>

                {/* Autocomplete Suggestions */}
                {result.suggestions.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                      <Lightbulb className="w-3 h-3" />
                      Autocomplete Suggestions
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {result.suggestions.slice(0, 8).map((s, i) => (
                        <span key={i} className="px-2.5 py-1 text-[11px] bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-700 text-gray-700 dark:text-gray-300 rounded-lg border border-gray-200 dark:border-gray-600 hover:shadow-sm transition cursor-default">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Competition */}
          <Card className="border-0 shadow-lg">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Target className="w-4 h-4 text-rose-500" />
                Competition
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Competition bar */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-500">How hard to rank</span>
                    <span className={`text-lg font-bold ${result.competition < 30 ? 'text-emerald-600' : result.competition < 60 ? 'text-amber-600' : 'text-red-600'}`}>
                      {result.competition}%
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-4 overflow-hidden">
                    <div
                      className={`h-4 rounded-full transition-all duration-1000 ease-out bg-gradient-to-r ${result.competition < 30 ? 'from-emerald-500 to-green-400' : result.competition < 60 ? 'from-amber-500 to-yellow-400' : 'from-red-500 to-rose-400'}`}
                      style={{ width: `${result.competition}%` }}
                    />
                  </div>
                </div>

                {/* Competition label */}
                <div className={`p-3 rounded-lg ${result.competition < 30 ? 'bg-emerald-50 dark:bg-emerald-500/10' : result.competition < 60 ? 'bg-amber-50 dark:bg-amber-500/10' : 'bg-red-50 dark:bg-red-500/10'}`}>
                  <p className={`text-xs font-medium ${result.competition < 30 ? 'text-emerald-700 dark:text-emerald-400' : result.competition < 60 ? 'text-amber-700 dark:text-amber-400' : 'text-red-700 dark:text-red-400'}`}>
                    {result.competition < 30 ? '🎯 Low competition — good opportunity' :
                     result.competition < 60 ? '⚡ Medium competition — needs strong angle' :
                     '🔥 High competition — needs unique differentiation'}
                  </p>
                </div>

                {/* Expanded keywords */}
                {result.expanded.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Related Searches</p>
                    <div className="flex flex-wrap gap-1.5">
                      {result.expanded.slice(0, 6).map((s, i) => (
                        <span key={i} className="px-2 py-1 text-[10px] bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 rounded-md">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Top Videos */}
          <Card className="lg:col-span-2 border-0 shadow-lg">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <ExternalLink className="w-4 h-4 text-violet-500" />
                Top Videos for &quot;{result.keyword}&quot;
              </CardTitle>
            </CardHeader>
            <CardContent>
              {result.topVideos.length === 0 ? (
                <p className="text-sm text-gray-400 py-8 text-center">No videos found</p>
              ) : (
                <div className="space-y-2">
                  {result.topVideos.map((video, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50 transition group">
                      <span className="flex-shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-[11px] font-bold text-white">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition line-clamp-2">
                          {video.title}
                        </p>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs text-gray-500">{video.channel}</span>
                          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                            {formatViews(video.views)} views
                          </span>
                        </div>
                        {video.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {video.tags.slice(0, 5).map((tag, j) => (
                              <span key={j} className="px-2 py-0.5 text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-md border border-gray-200 dark:border-gray-600">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Related Keywords */}
          <Card className="border-0 shadow-lg">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-amber-500" />
                Related Keywords
              </CardTitle>
            </CardHeader>
            <CardContent>
              {related.length === 0 ? (
                <p className="text-sm text-gray-400 py-8 text-center">No related keywords found</p>
              ) : (
                <div className="space-y-1">
                  {related.slice(0, 15).map((kw, i) => (
                    <button
                      key={i}
                      onClick={() => handleRelatedClick(kw)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-lg transition text-left group"
                    >
                      <Search className="w-3 h-3 text-gray-400 group-hover:text-indigo-500 shrink-0 transition" />
                      <span className="truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition">{kw}</span>
                      <ChevronRight className="w-3 h-3 text-gray-300 group-hover:text-indigo-400 ml-auto shrink-0 transition" />
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
