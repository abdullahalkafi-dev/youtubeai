'use client';

import React from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sparkles, ArrowRight, CheckCircle2, AlertCircle, ShieldAlert, XCircle, Loader2, Eye, ExternalLink } from 'lucide-react';
import type { AutomationBatch } from '@/types/automation';

interface BatchLiveProgressProps {
  batch: AutomationBatch;
  onCancel?: (batchId: string) => void;
}

export function BatchLiveProgress({ batch, onCancel }: BatchLiveProgressProps) {
  const total = batch.totalItems || 1;
  const successful = batch.successfulItems || 0;
  const failed = batch.failedItems || 0;
  const skipped = batch.skippedItems || 0;
  const processed = successful + failed + skipped;
  const progressPercent = Math.min(Math.round((processed / total) * 100), 100);

  const isGenerating = batch.status === 'generating';
  const isPushing = batch.status === 'pushing';
  const isCompleted = batch.status === 'completed' || batch.status === 'partial' || batch.status === 'failed';

  return (
    <Card className="mb-6 border-indigo-500/30 bg-gradient-to-br from-indigo-500/5 via-transparent to-purple-500/5 dark:bg-gray-900/90 shadow-md relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-1 bg-gray-100 dark:bg-gray-800">
        <div
          className="h-full bg-gradient-to-r from-indigo-500 to-purple-600 transition-all duration-500"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <CardContent className="p-5 lg:p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500"></span>
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-gray-900 dark:text-white font-heading">
                  Active Automation Batch #{batch.id?.slice(-6) || batch._id?.slice(-6) || 'RUNNING'}
                </h3>
                <Badge variant={batch.source === 'auto_cron_batch' ? 'purple' : 'blue'}>
                  {batch.source === 'auto_cron_batch' ? 'Daily 7:30 AM Cron' : 'Manual Run'}
                </Badge>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                Staging in DB first, then pushing to YouTube with 5-second safety spacing
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-gray-900 dark:text-white font-heading">
              {processed} / {total} Videos ({progressPercent}%)
            </span>
            {onCancel && !isCompleted && (
              <button
                onClick={() => onCancel(batch.id || batch._id || '')}
                className="text-xs px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-500/30 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 font-medium transition"
              >
                Cancel Batch
              </button>
            )}
          </div>
        </div>

        {/* 5-Step Pipeline Flow Indicator */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2.5 mb-6 text-xs">
          {/* Step 1: Quota Checked */}
          <div className="p-2.5 rounded-xl border border-emerald-200 dark:border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-500/10 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <div>
              <p className="font-semibold text-emerald-700 dark:text-emerald-300">1. Quota Pre-Check</p>
              <p className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80">Verified &lt; 9,000 Cap</p>
            </div>
          </div>

          {/* Step 2: AI Generating */}
          <div
            className={`p-2.5 rounded-xl border transition flex items-center gap-2 ${
              isGenerating
                ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-500/20 animate-pulse'
                : processed > 0
                ? 'border-emerald-200 dark:border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-500/10'
                : 'border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 text-gray-400'
            }`}
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 text-indigo-500 animate-spin shrink-0" />
            ) : processed > 0 ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            ) : (
              <Sparkles className="w-4 h-4 text-gray-400 shrink-0" />
            )}
            <div>
              <p className="font-semibold text-gray-900 dark:text-white">2. AI SEO Generation</p>
              <p className="text-[10px] text-gray-500">OpenAI + Transcript</p>
            </div>
          </div>

          {/* Step 3: DB Staged */}
          <div
            className={`p-2.5 rounded-xl border transition flex items-center gap-2 ${
              isPushing || isCompleted
                ? 'border-emerald-200 dark:border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-500/10'
                : isGenerating
                ? 'border-indigo-200 dark:border-indigo-500/20 bg-indigo-50/30 dark:bg-indigo-500/10 text-indigo-500'
                : 'border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 text-gray-400'
            }`}
          >
            {isPushing || isCompleted ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-gray-400 shrink-0" />
            )}
            <div>
              <p className="font-semibold text-gray-900 dark:text-white">3. DB Staging</p>
              <p className="text-[10px] text-gray-500">Atomic MongoDB Save</p>
            </div>
          </div>

          {/* Step 4: YouTube Pushing */}
          <div
            className={`p-2.5 rounded-xl border transition flex items-center gap-2 ${
              isPushing
                ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-500/20 animate-pulse'
                : isCompleted
                ? 'border-emerald-200 dark:border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-500/10'
                : 'border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 text-gray-400'
            }`}
          >
            {isPushing ? (
              <Loader2 className="w-4 h-4 text-indigo-500 animate-spin shrink-0" />
            ) : isCompleted ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            ) : (
              <ArrowRight className="w-4 h-4 text-gray-400 shrink-0" />
            )}
            <div>
              <p className="font-semibold text-gray-900 dark:text-white">4. YouTube Push</p>
              <p className="text-[10px] text-gray-500">5s Pacing + Retries</p>
            </div>
          </div>

          {/* Step 5: Completed */}
          <div
            className={`p-2.5 rounded-xl border transition flex items-center gap-2 col-span-2 sm:col-span-1 ${
              isCompleted
                ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                : 'border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 text-gray-400'
            }`}
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <div>
              <p className="font-semibold">5. Live & Verified</p>
              <p className="text-[10px] text-gray-500">Rollback Preserved</p>
            </div>
          </div>
        </div>

        {/* Live Items Table */}
        <div className="bg-white/80 dark:bg-gray-900/80 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50/60 dark:bg-gray-800/40 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between text-xs text-gray-500 font-medium">
            <span>Video Item ({batch.items?.length || 0})</span>
            <span>Live Stage / Status</span>
          </div>

          <div className="max-h-72 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800/60">
            {batch.items && batch.items.length > 0 ? (
              batch.items.map((item, idx) => {
                const rawVid = item.videoId as any;
                const videoId = typeof rawVid === 'string'
                  ? rawVid
                  : typeof rawVid === 'object' && rawVid !== null
                  ? (rawVid._id?.toString() || rawVid.id?.toString() || rawVid.$oid?.toString() || (typeof rawVid.toString === 'function' && rawVid.toString() !== '[object Object]' ? rawVid.toString() : ''))
                  : (rawVid ? String(rawVid) : ((item as any)._id ? String((item as any)._id) : ''));
                const youtubeUrl = item.youtubeId ? `https://www.youtube.com/watch?v=${item.youtubeId}` : null;

                return (
                  <div key={idx} className="p-3 flex items-center justify-between gap-3 text-xs hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-gray-400 w-5">#{idx + 1}</span>
                        {videoId ? (
                          <Link
                            href={`/videos/${videoId}`}
                            className="font-medium text-gray-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 transition truncate"
                            title="Open Video Details"
                          >
                            {item.originalTitle}
                          </Link>
                        ) : (
                          <p className="font-medium text-gray-900 dark:text-white truncate">
                            {item.originalTitle}
                          </p>
                        )}
                      </div>
                      {item.generatedTitle && item.status !== 'queued' && (
                        <p className="text-[11px] text-indigo-600 dark:text-indigo-400 truncate pl-7 mt-0.5">
                          ➜ {item.generatedTitle}
                        </p>
                      )}
                    </div>

                    <div className="shrink-0 flex items-center gap-2">
                      {/* Quick Action Links */}
                      {(videoId || youtubeUrl) && (
                        <div className="flex items-center gap-1 mr-1">
                          {videoId && (
                            <Link
                              href={`/videos/${videoId}`}
                              className="px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center gap-1 text-[11px] font-medium transition shadow-2xs"
                              title="Open Video Details"
                            >
                              <Eye className="w-3 h-3 text-indigo-500" />
                              <span>Details</span>
                            </Link>
                          )}
                          {youtubeUrl && (
                            <a
                              href={youtubeUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-2 py-1 rounded-md border border-red-200 dark:border-red-500/20 bg-red-50/70 dark:bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 flex items-center gap-1 text-[11px] font-medium transition shadow-2xs"
                              title="Watch on YouTube"
                            >
                              <ExternalLink className="w-3 h-3 text-red-500" />
                              <span>YouTube</span>
                            </a>
                          )}
                        </div>
                      )}

                      {item.status === 'queued' && (
                        <Badge variant="gray">Queued</Badge>
                      )}
                      {item.status === 'generating' && (
                        <Badge variant="blue" className="flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> Generating...
                        </Badge>
                      )}
                      {item.status === 'staged' && (
                        <Badge variant="yellow">Staged in DB</Badge>
                      )}
                      {item.status === 'pushing' && (
                        <Badge variant="purple" className="flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> Pushing YouTube (5s)...
                        </Badge>
                      )}
                      {item.status === 'completed' && (
                        <Badge variant="green" className="flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-500" /> Live on YouTube
                        </Badge>
                      )}
                      {item.status === 'skipped_manual_override' && (
                        <Badge variant="gray" className="flex items-center gap-1 text-amber-500 border-amber-500/30">
                          <ShieldAlert className="w-3 h-3 text-amber-500" /> Manual Override
                        </Badge>
                      )}
                      {item.status === 'failed' && (
                        <Badge variant="red" className="flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 text-rose-500" /> Failed
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-6 text-center text-xs text-gray-400">
                Initializing batch items...
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
