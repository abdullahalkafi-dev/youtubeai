'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronUp, RotateCcw, CheckCircle2, AlertCircle, ShieldAlert, Sparkles, Clock, Eye, ExternalLink } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import type { AutomationBatch } from '@/types/automation';

interface BatchCardProps {
  batch: AutomationBatch;
  onRetry?: (batchId: string) => void;
  retrying?: boolean;
}

export function BatchCard({ batch, onRetry, retrying }: BatchCardProps) {
  const [expanded, setExpanded] = useState(false);

  const batchId = batch.id || batch._id || 'unknown';
  const hasFailedItems = (batch.failedItems || 0) > 0;
  const isChildRetry = Boolean(batch.parentBatchId);
  const isRetried = Boolean(batch.isRetried || batch.retriedByBatchId);
  const canRetry = !isRetried && hasFailedItems && Boolean(onRetry) && batch.status !== 'generating' && batch.status !== 'pushing';

  return (
    <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 shadow-sm transition hover:border-gray-300 dark:hover:border-gray-700">
      <CardContent className="p-4 sm:p-5">
        {/* Header summary */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start sm:items-center gap-3">
            <div
              className={`p-2.5 rounded-xl shrink-0 ${
                batch.status === 'completed' || (batch.status === 'partial' && !hasFailedItems)
                  ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : batch.status === 'partial'
                  ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400'
              }`}
            >
              <Sparkles className="w-5 h-5" />
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-gray-900 dark:text-white font-heading text-sm sm:text-base">
                  Batch #{batchId.slice(-6).toUpperCase()}
                </span>

                <Badge
                  variant={
                    batch.source === 'auto_cron_batch'
                      ? 'purple'
                      : isChildRetry
                      ? 'yellow'
                      : 'blue'
                  }
                >
                  {batch.source === 'auto_cron_batch'
                    ? 'Daily 7:30 AM Cron'
                    : isChildRetry
                    ? `Retry Child of #${batch.parentBatchId?.slice(-6).toUpperCase()}`
                    : 'Manual Batch'}
                </Badge>

                {isRetried && batch.retriedByBatchId && (
                  <Badge variant="blue">
                    Retried in #{batch.retriedByBatchId.slice(-6).toUpperCase()}
                  </Badge>
                )}

                <Badge
                  variant={
                    batch.status === 'completed' || (batch.status === 'partial' && !hasFailedItems)
                      ? 'green'
                      : batch.status === 'partial'
                      ? 'yellow'
                      : 'red'
                  }
                >
                  {batch.status === 'completed' || (batch.status === 'partial' && !hasFailedItems)
                    ? 'Completed (All Live)'
                    : isRetried
                    ? 'Failed (Retried)'
                    : batch.status === 'partial'
                    ? 'Partial Success'
                    : batch.status}
                </Badge>
              </div>

              <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-gray-400">
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {formatDate(batch.startedAt || batch.createdAt)}
                </span>
                <span>•</span>
                <span>{batch.totalItems} total videos</span>
                <span>•</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                  {batch.successfulItems} pushed
                </span>
                {(batch.skippedItems || 0) > 0 && (
                  <>
                    <span>•</span>
                    <span className="text-amber-500 font-medium">
                      {batch.skippedItems} manual override
                    </span>
                  </>
                )}
                {hasFailedItems && (
                  <>
                    <span>•</span>
                    <span className="text-rose-500 font-medium">
                      {batch.failedItems} failed
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            {canRetry && onRetry && (
              <button
                onClick={() => onRetry(batchId)}
                disabled={retrying}
                className="text-xs px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/20 font-medium hover:bg-indigo-100 flex items-center gap-1 transition disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Retry {batch.failedItems} Failed
              </button>
            )}

            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
              aria-label={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Expandable Items List */}
        {expanded && (
          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
            <div className="space-y-3">
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
                    <div
                      key={idx}
                      className="p-3.5 rounded-xl border border-gray-100 dark:border-gray-800/80 bg-gray-50/50 dark:bg-gray-800/30 text-xs hover:border-gray-200 dark:hover:border-gray-700 transition"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-gray-400 w-5">#{idx + 1}</span>
                            {videoId ? (
                              <Link
                                href={`/videos/${videoId}`}
                                className="font-semibold text-gray-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 transition truncate"
                                title="Open Video Details"
                              >
                                {item.originalTitle}
                              </Link>
                            ) : (
                              <p className="font-semibold text-gray-900 dark:text-white truncate">
                                {item.originalTitle}
                              </p>
                            )}
                          </div>

                          {item.generatedTitle && (
                            <div className="mt-1.5 pl-7">
                              <span className="text-[11px] text-gray-400 block mb-0.5">AI Optimized Title:</span>
                              <p className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">
                                {item.generatedTitle}
                              </p>
                            </div>
                          )}

                          {item.generatedTags && item.generatedTags.length > 0 && (
                            <div className="mt-2 pl-7 flex flex-wrap gap-1">
                              {item.generatedTags.slice(0, 5).map((t, ti) => (
                                <span
                                  key={ti}
                                  className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-[10px] text-gray-600 dark:text-gray-300 font-mono"
                                >
                                  {t}
                                </span>
                              ))}
                              {item.generatedTags.length > 5 && (
                                <span className="text-[10px] text-gray-400 self-center">
                                  +{item.generatedTags.length - 5} more tags
                                </span>
                              )}
                            </div>
                          )}

                          {item.error && (
                            <p className="mt-1.5 pl-7 text-[11px] text-rose-500">
                              Error: {item.error}
                            </p>
                          )}
                        </div>

                        <div className="shrink-0 flex items-center gap-2 pl-7 sm:pl-0 sm:self-center">
                          {/* Quick Action Links: Details Page & YouTube */}
                          <div className="flex items-center gap-1.5">
                            {videoId && (
                              <Link
                                href={`/videos/${videoId}`}
                                className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:text-indigo-600 dark:hover:text-indigo-400 hover:border-indigo-300 dark:hover:border-indigo-500/30 flex items-center gap-1.5 text-[11px] font-medium transition shadow-xs"
                                title="Open Video Details"
                              >
                                <Eye className="w-3.5 h-3.5 text-indigo-500" />
                                <span>Details</span>
                              </Link>
                            )}

                            {youtubeUrl && (
                              <a
                                href={youtubeUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-2.5 py-1.5 rounded-lg border border-red-200 dark:border-red-500/20 bg-red-50/70 dark:bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 flex items-center gap-1.5 text-[11px] font-medium transition shadow-xs"
                                title="Watch on YouTube"
                              >
                                <ExternalLink className="w-3.5 h-3.5 text-red-500" />
                                <span>YouTube</span>
                              </a>
                            )}
                          </div>

                          {item.status === 'completed' && (
                            <Badge variant="green" className="flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-emerald-500" /> Pushed to YouTube
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
                          {item.status === 'staged' && (
                            <Badge variant="yellow">Staged in DB</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-center text-xs text-gray-400 py-2">No item details available</p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
