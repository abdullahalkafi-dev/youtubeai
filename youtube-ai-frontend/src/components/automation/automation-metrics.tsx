'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Sparkles, Calendar, Zap, CheckCircle2, Clock } from 'lucide-react';
import type { AutomationStats } from '@/types/automation';

interface AutomationMetricsProps {
  stats: AutomationStats | null;
  loading?: boolean;
}

export function AutomationMetrics({ stats, loading }: AutomationMetricsProps) {
  if (loading && !stats) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="animate-pulse bg-gray-100 dark:bg-gray-800/40 border-gray-200 dark:border-gray-800 h-28" />
        ))}
      </div>
    );
  }

  const total = stats?.totalVideos || 0;
  const optimized = stats?.optimizedVideos || 0;
  const remaining = stats?.remainingUnoptimized || 0;
  const daysRemaining = stats?.estimatedDaysRemaining || 0;
  const percentOptimized = total > 0 ? Math.round((optimized / total) * 100) : 0;
  const quotaUsed = stats?.quotaUsed || 0;
  const quotaLimit = stats?.quotaLimit || 10000;
  const quotaSafety = stats?.quotaSafetyCap || 9000;
  const quotaPercent = Math.min(Math.round((quotaUsed / quotaLimit) * 100), 100);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {/* 1. Overall Optimization Progress */}
      <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 shadow-sm relative overflow-hidden">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Library SEO Progress
            </span>
            <span className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <Sparkles className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-gray-900 dark:text-white font-heading">
              {percentOptimized}%
            </span>
            <span className="text-xs text-gray-400">
              ({optimized} / {total} videos)
            </span>
          </div>
          <div className="mt-3 w-full bg-gray-100 dark:bg-gray-800 h-2 rounded-full overflow-hidden">
            <div
              className="bg-gradient-to-r from-indigo-500 to-indigo-600 h-full rounded-full transition-all duration-500"
              style={{ width: `${percentOptimized}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {/* 2. Remaining & Est. Time */}
      <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 shadow-sm">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Forecast Pace
            </span>
            <span className="p-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Clock className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-gray-900 dark:text-white font-heading">
              ~{daysRemaining} {daysRemaining === 1 ? 'Day' : 'Days'}
            </span>
            <span className="text-xs text-gray-400">remaining</span>
          </div>
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400 truncate">
            <span className="font-semibold text-gray-700 dark:text-gray-300">{remaining}</span> unoptimized · 30 videos/day
          </p>
        </CardContent>
      </Card>

      {/* 3. Next Daily Run */}
      <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 shadow-sm">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Daily Automation
            </span>
            <span className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Calendar className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-gray-900 dark:text-white font-heading">
              7:30 AM
            </span>
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              EST / NY Time
            </span>
          </div>
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            Scheduled 30-Video Batch
          </p>
        </CardContent>
      </Card>

      {/* 4. YouTube Quota Meter */}
      <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 shadow-sm">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              YouTube Daily Quota
            </span>
            <span className="p-2 rounded-xl bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400">
              <Zap className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-gray-900 dark:text-white font-heading">
              {quotaUsed.toLocaleString()}
            </span>
            <span className="text-xs text-gray-400">
              / {quotaSafety.toLocaleString()} cap
            </span>
          </div>
          <div className="mt-3 w-full bg-gray-100 dark:bg-gray-800 h-2 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                quotaPercent > 80
                  ? 'bg-rose-500'
                  : quotaPercent > 50
                  ? 'bg-amber-500'
                  : 'bg-gradient-to-r from-purple-500 to-indigo-500'
              }`}
              style={{ width: `${quotaPercent}%` }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
