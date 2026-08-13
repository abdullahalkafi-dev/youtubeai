'use client'

import { TrendingUp, AlertCircle, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TrendItem } from '@/lib/content-detector'

interface TrendsCardProps {
  trends: TrendItem[]
}

function getRecommendationColor(rec: string): string {
  const lower = rec.toLowerCase()
  if (lower.includes('greenlight')) return 'bg-emerald-500 text-white'
  if (lower.includes('hold')) return 'bg-amber-500 text-white'
  return 'bg-gray-500 text-white'
}

function getScoreColor(score: string): string {
  const num = parseInt(score)
  if (num >= 70) return 'text-emerald-600 dark:text-emerald-400'
  if (num >= 50) return 'text-amber-600 dark:text-amber-400'
  return 'text-gray-500'
}

export function TrendsCard({ trends }: TrendsCardProps) {
  if (!trends || trends.length === 0) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <TrendingUp className="w-4 h-4 text-cyan-500" />
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          Trending Topics ({trends.length})
        </span>
      </div>

      {trends.map((trend, idx) => (
        <div
          key={idx}
          className="bg-cyan-50 dark:bg-cyan-500/10 border border-cyan-200 dark:border-cyan-500/20 rounded-xl p-4 space-y-2.5"
        >
          {/* Title + Score */}
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white leading-snug flex-1">
              {trend.title}
            </h4>
            {trend.opportunityScore && (
              <span className={cn('text-lg font-bold shrink-0', getScoreColor(trend.opportunityScore))}>
                {trend.opportunityScore}
              </span>
            )}
          </div>

          {/* Summary */}
          {trend.summary && (
            <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{trend.summary}</p>
          )}

          {/* Recommendation Badge */}
          {trend.recommendation && (
            <span className={cn('inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider', getRecommendationColor(trend.recommendation))}>
              {trend.recommendation}
            </span>
          )}

          {/* Content Angle */}
          {trend.contentAngle && (
            <div>
              <label className="text-[10px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wider">Content Angle</label>
              <p className="text-xs text-gray-700 dark:text-gray-300 mt-0.5">{trend.contentAngle}</p>
            </div>
          )}

          {/* Why Now */}
          {trend.whyNow && (
            <div className="flex items-start gap-1.5">
              <AlertCircle className="w-3 h-3 text-cyan-500 shrink-0 mt-0.5" />
              <p className="text-[10px] text-gray-500 dark:text-gray-400">{trend.whyNow}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
