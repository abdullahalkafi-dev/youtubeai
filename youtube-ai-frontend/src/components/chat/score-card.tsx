'use client'

import { cn } from '@/lib/utils'
import type { IdeaScore } from '@/lib/content-detector'

interface ScoreCardProps {
  score: IdeaScore
}

function getStatusColor(status: string): { bg: string; text: string; ring: string; badge: string } {
  switch (status) {
    case 'greenlight':
      return {
        bg: 'bg-emerald-50 dark:bg-emerald-500/10',
        text: 'text-emerald-600 dark:text-emerald-400',
        ring: 'border-emerald-400',
        badge: 'bg-emerald-500',
      }
    case 'hold':
      return {
        bg: 'bg-amber-50 dark:bg-amber-500/10',
        text: 'text-amber-600 dark:text-amber-400',
        ring: 'border-amber-400',
        badge: 'bg-amber-500',
      }
    default:
      return {
        bg: 'bg-gray-50 dark:bg-gray-500/10',
        text: 'text-gray-600 dark:text-gray-400',
        ring: 'border-gray-300',
        badge: 'bg-gray-500',
      }
  }
}

function getCriteriaBarWidth(scoreStr: string): number {
  const num = parseFloat(scoreStr)
  return isNaN(num) ? 0 : (num / 10) * 100
}

export function ScoreCard({ score }: ScoreCardProps) {
  const colors = getStatusColor(score.status)
  const numericScore = parseFloat(score.score) || 0

  return (
    <div className="space-y-5">
      {/* Score Circle + Status */}
      <div className="flex items-center gap-5">
        <div className={cn('w-20 h-20 rounded-full border-[3px] flex flex-col items-center justify-center', colors.ring)}>
          <span className={cn('text-2xl font-bold', colors.text)}>{score.score}</span>
          <span className="text-[10px] text-gray-400">/10</span>
        </div>
        <div>
          <span className={cn('inline-block px-3 py-1 rounded-full text-white text-xs font-bold uppercase tracking-wider', colors.badge)}>
            {score.status}
          </span>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
            {score.status === 'greenlight' && 'Strong opportunity — go for it'}
            {score.status === 'hold' && 'Decent potential — needs improvement'}
            {score.status === 'pass' && 'Low potential — reconsider or rework'}
          </p>
        </div>
      </div>

      {/* Criteria Bars */}
      {score.criteria.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Criteria Breakdown</h4>
          <div className="space-y-2.5">
            {score.criteria.map((c, idx) => {
              const width = getCriteriaBarWidth(c.score)
              return (
                <div key={idx}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{c.name}</span>
                    <span className={cn('text-xs font-bold', colors.text)}>{c.score}</span>
                  </div>
                  <div className="h-2 bg-gray-100 dark:bg-gray-700/50 rounded-full overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all duration-700', colors.badge)}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                  {c.reason && (
                    <p className="text-[10px] text-gray-400 mt-0.5">{c.reason}</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Improvements */}
      {score.improvements.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Improvements</h4>
          <ul className="space-y-1.5">
            {score.improvements.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2 text-xs text-gray-700 dark:text-gray-300">
                <span className={cn('w-4 h-4 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[10px] text-white font-bold', colors.badge)}>
                  {idx + 1}
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
