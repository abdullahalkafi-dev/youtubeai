'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAppSelector } from '@/store/hooks';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  MessageSquare,
  Sparkles,
  Shield,
  Clock,
  Zap,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  User,
  Bot,
  Flame,
  Check,
  XCircle,
  Loader2,
} from 'lucide-react';
import { api, formatAssetUrl } from '@/lib/api';
import { toast } from 'sonner';
import { showApiErrorToast } from '@/lib/error-handler';
import { cn } from '@/lib/utils';
import Link from 'next/link';

interface CommentStats {
  dailyCommentCap: number;
  todayAutoRepliesCount: number;
  remainingToday: number;
  maxActiveVideos: number;
  activeVideosCount: number;
  activeVideos: Array<{
    _id: string;
    id: string;
    title: string;
    youtubeId: string;
    thumbnailUrl?: string;
    publishedAt?: string;
    autoReplyLastRanAt?: string;
    autoReplyTotalCount?: number;
    viewCount?: number;
    commentCount?: number;
  }>;
  totalLifetimeReplies: number;
  totalBatches: number;
  scheduleInterval: string;
  channelName: string;
}

export function CommentAutomationTab() {
  const channelId = useAppSelector((s) => s.auth.activeChannelId);

  const [stats, setStats] = useState<CommentStats | null>(null);
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const hasInitializedExpandedRef = useRef(false);
  const [togglingVideoId, setTogglingVideoId] = useState<string | null>(null);

  const loadData = useCallback(async (isSilent = false) => {
    if (!channelId) return;
    try {
      if (!isSilent) setLoading(true);
      else setRefreshing(true);

      const [statsRes, batchesRes] = await Promise.all([
        api.getCommentAutomationStats(channelId),
        api.getCommentAutomationBatches(channelId, 20),
      ]);

      setStats(statsRes as CommentStats);
      setBatches(batchesRes || []);

      // Auto-expand first batch on initial mount only
      if (!hasInitializedExpandedRef.current && batchesRes && batchesRes.length > 0) {
        hasInitializedExpandedRef.current = true;
        setExpandedBatchId(batchesRes[0]._id || batchesRes[0].id);
      }
    } catch (err: any) {
      showApiErrorToast(err, 'Failed to load comment automation data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [channelId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-poll every 4s if any batch is currently in progress
  useEffect(() => {
    const hasActiveBatch = batches.some(
      (b) => b.status === 'generating' || b.status === 'pushing' || b.status === 'checking_quota',
    );
    if (!hasActiveBatch) return;

    const interval = setInterval(() => {
      loadData(true);
    }, 4000);

    return () => clearInterval(interval);
  }, [batches, loadData]);

  const handleToggleVideo = async (videoId: string, currentState: boolean) => {
    try {
      setTogglingVideoId(videoId);
      await api.toggleVideoAutoReply(videoId, !currentState);
      toast.success(
        !currentState
          ? 'Auto-Reply enabled for video (Active in 5-min round robin)'
          : 'Auto-Reply disabled for video',
      );
      await loadData(true);
    } catch (err: any) {
      showApiErrorToast(err, 'Failed to toggle auto-reply');
    } finally {
      setTogglingVideoId(null);
    }
  };

  const dailyCap = stats?.dailyCommentCap || 70;
  const todayUsed = stats?.todayAutoRepliesCount || 0;
  const capPercent = Math.min(100, Math.round((todayUsed / dailyCap) * 100));

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg lg:text-xl font-bold text-gray-900 dark:text-white font-heading flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-purple-500" />
              Comment Auto-Reply Automation Hub
            </h2>
            <Badge variant="purple" className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              5-Min Round Robin Active
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Autonomous 10-comment batch reply engine with Unique Mecca Audio street-wise persona & AI spam defense.
          </p>
        </div>

        <button
          onClick={() => loadData(true)}
          disabled={refreshing || loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition shadow-xs disabled:opacity-50"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', (refreshing || loading) && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Top KPI Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Daily Cap Progress */}
        <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Daily Auto-Replies</span>
              <div className="p-1.5 rounded-lg bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400">
                <Zap className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-black text-gray-900 dark:text-white font-heading">
                {todayUsed}
              </span>
              <span className="text-xs text-gray-400 font-medium">/ {dailyCap} max</span>
            </div>
            {/* Progress Bar */}
            <div className="w-full h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full mt-3 overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  capPercent >= 90 ? 'bg-red-500' : capPercent >= 70 ? 'bg-amber-500' : 'bg-purple-500',
                )}
                style={{ width: `${capPercent}%` }}
              />
            </div>
            <span className="text-[11px] text-gray-400 block mt-1.5">Resets at Midnight PT</span>
          </CardContent>
        </Card>

        {/* Active Auto-Reply Videos */}
        <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Active Auto-Reply Videos</span>
              <div className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                <Sparkles className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-black text-gray-900 dark:text-white font-heading">
                {stats?.activeVideosCount || 0}
              </span>
              <span className="text-xs text-gray-400 font-medium">/ {stats?.maxActiveVideos || 5} max</span>
            </div>
            <span className="text-[11px] text-gray-400 block mt-4">
              {5 - (stats?.activeVideosCount || 0)} video slots available
            </span>
          </CardContent>
        </Card>

        {/* Lifetime Comments Replied */}
        <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Lifetime Auto-Replies</span>
              <div className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-black text-gray-900 dark:text-white font-heading">
                {stats?.totalLifetimeReplies?.toLocaleString() || 0}
              </span>
              <span className="text-xs text-emerald-500 font-medium">posted</span>
            </div>
            <span className="text-[11px] text-gray-400 block mt-4">
              Across {stats?.totalBatches || 0} execution runs
            </span>
          </CardContent>
        </Card>

        {/* Schedule & Pacing */}
        <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Paced Polling Interval</span>
              <div className="p-1.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <Clock className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-black text-gray-900 dark:text-white font-heading">
                5 min
              </span>
              <span className="text-xs text-gray-400 font-medium">round robin</span>
            </div>
            <span className="text-[11px] text-gray-400 block mt-4">
              3s safety gap between replies
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Section 1: Active Auto-Reply Videos */}
      <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-500" />
              <h3 className="text-sm font-bold text-gray-900 dark:text-white font-heading">
                Active Auto-Reply Videos ({stats?.activeVideosCount || 0} / {stats?.maxActiveVideos || 5})
              </h3>
            </div>
            <span className="text-xs text-gray-400">
              Newest published videos get round-robin priority
            </span>
          </div>

          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-gray-400 space-y-2">
              <Loader2 className="w-6 h-6 animate-spin text-purple-500" />
              <span className="text-xs">Loading active videos...</span>
            </div>
          ) : stats?.activeVideos && stats.activeVideos.length > 0 ? (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {stats.activeVideos.map((video) => (
                <div key={video._id || video.id} className="py-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={formatAssetUrl(video.thumbnailUrl) || '/placeholder-thumb.png'}
                      alt={video.title}
                      className="w-16 h-10 object-cover rounded-lg bg-gray-100 dark:bg-gray-800 flex-shrink-0"
                    />
                    <div className="min-w-0">
                      <Link
                        href={`/videos/${video._id || video.id}`}
                        className="text-xs font-bold text-gray-900 dark:text-white hover:text-purple-600 dark:hover:text-purple-400 transition truncate block max-w-md"
                      >
                        {video.title}
                      </Link>
                      <div className="flex items-center gap-3 text-[11px] text-gray-400 mt-1">
                        <span>{video.autoReplyTotalCount || 0} auto-replies posted</span>
                        <span>•</span>
                        <span>
                          Last checked:{' '}
                          {video.autoReplyLastRanAt
                            ? new Date(video.autoReplyLastRanAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : 'Pending first check'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center">
                    <button
                      onClick={() => handleToggleVideo(video._id || video.id, true)}
                      disabled={togglingVideoId === (video._id || video.id)}
                      className="px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-800 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-100 transition disabled:opacity-50"
                    >
                      {togglingVideoId === (video._id || video.id) ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        'Disable Auto-Reply'
                      )}
                    </button>
                    <Link
                      href={`/videos/${video._id || video.id}`}
                      className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-500 transition"
                      title="Open Video Details"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 px-4 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-dashed border-gray-200 dark:border-gray-700 text-center">
              <MessageSquare className="w-8 h-8 text-gray-400 mx-auto mb-2" />
              <h4 className="text-xs font-bold text-gray-800 dark:text-gray-200">No Videos Currently Enabled</h4>
              <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm mx-auto mt-1 mb-3">
                Open any video in your library and flip the &quot;Auto-Reply&quot; toggle in the Comments header to activate AI community responses.
              </p>
              <Link
                href="/videos"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-600 text-white text-xs font-semibold hover:bg-purple-700 transition"
              >
                Browse Videos
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 2: Batch Execution History & Details */}
      <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-purple-500" />
              <h3 className="text-sm font-bold text-gray-900 dark:text-white font-heading">
                Auto-Reply Execution Batches & Detailed Activity
              </h3>
            </div>
            <span className="text-xs text-gray-400">
              Click any batch to inspect user comments and generated AI replies
            </span>
          </div>

          {batches.length === 0 ? (
            <div className="py-8 text-center text-gray-400 text-xs">
              No comment auto-reply batches executed yet.
            </div>
          ) : (
            <div className="space-y-3">
              {batches.map((batch) => {
                const batchId = batch._id || batch.id;
                const isExpanded = expandedBatchId === batchId;
                const dateFormatted = new Date(batch.createdAt || batch.startedAt).toLocaleString();

                return (
                  <div
                    key={batchId}
                    className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden bg-gray-50/50 dark:bg-gray-800/30 transition shadow-xs"
                  >
                    {/* Batch Accordion Header */}
                    <div
                      onClick={() => setExpandedBatchId(isExpanded ? null : batchId)}
                      className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-100/50 dark:hover:bg-gray-800/60 transition"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-950 text-purple-600 dark:text-purple-400 flex-shrink-0">
                          <Bot className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-gray-900 dark:text-white truncate">
                              {batch.items?.[0]?.originalTitle || 'Video Auto-Reply Run'}
                            </span>
                            <Badge
                              variant={batch.status === 'completed' ? 'green' : batch.status === 'partial' ? 'yellow' : 'blue'}
                              className="text-[10px]"
                            >
                              {batch.status}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-gray-400 mt-0.5">
                            <span>{dateFormatted}</span>
                            <span>•</span>
                            <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                              {batch.items?.filter((i: any) => i.status === 'completed').length || batch.successfulItems || 0} replies posted
                            </span>
                            {(batch.items?.filter((i: any) => i.status === 'handled_manually').length || 0) > 0 && (
                              <>
                                <span>•</span>
                                <span className="text-indigo-600 dark:text-indigo-400 font-medium">
                                  {batch.items.filter((i: any) => i.status === 'handled_manually').length} handled manually
                                </span>
                              </>
                            )}
                            {(batch.items?.filter((i: any) => i.status === 'skipped_spam').length || 0) > 0 && (
                              <>
                                <span>•</span>
                                <span className="text-amber-500 font-medium">
                                  {batch.items.filter((i: any) => i.status === 'skipped_spam').length} spam skipped
                                </span>
                              </>
                            )}
                            {(batch.items?.filter((i: any) => i.status === 'failed').length || 0) > 0 && (
                              <>
                                <span>•</span>
                                <span className="text-red-500 font-medium">
                                  {batch.items.filter((i: any) => i.status === 'failed').length} failed
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-gray-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-gray-400" />
                        )}
                      </div>
                    </div>

                    {/* Batch Items List */}
                    {isExpanded && (
                      <div className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-4">
                        {batch.items && batch.items.length > 0 ? (
                          batch.items.map((item: any, idx: number) => (
                            <div
                              key={item.commentId || idx}
                              className="p-3.5 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/40 space-y-2.5"
                            >
                              {/* Viewer Comment Header */}
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-300">
                                    <User className="w-3.5 h-3.5" />
                                  </div>
                                  <span className="text-xs font-bold text-gray-800 dark:text-gray-200">
                                    {item.authorName || 'Viewer'}
                                  </span>
                                </div>

                                <div className="flex items-center gap-1.5">
                                  {item.status === 'completed' ? (
                                    <Badge variant="green" className="text-[10px]">
                                      Posted to YouTube
                                    </Badge>
                                  ) : item.status === 'handled_manually' ? (
                                    <Badge variant="purple" className="text-[10px] bg-indigo-50 text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                                      Handled Manually
                                    </Badge>
                                  ) : item.status === 'skipped_spam' ? (
                                    <Badge variant="yellow" className="text-[10px]">
                                      Skipped (Spam / Scam)
                                    </Badge>
                                  ) : item.status === 'queued' ? (
                                    <Badge variant="blue" className="text-[10px]">
                                      Queued
                                    </Badge>
                                  ) : item.status === 'generating' || item.status === 'pushing' ? (
                                    <Badge variant="purple" className="text-[10px] flex items-center gap-1">
                                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                      Posting...
                                    </Badge>
                                  ) : (
                                    <Badge variant="red" className="text-[10px]">
                                      Failed
                                    </Badge>
                                  )}
                                  {item.tone && (
                                    <Badge variant="purple" className="text-[10px]">
                                      {item.tone}
                                    </Badge>
                                  )}
                                </div>
                              </div>

                              {/* Viewer Comment Text */}
                              <p className="text-xs text-gray-700 dark:text-gray-300 pl-8 leading-relaxed italic">
                                &quot;{item.commentText}&quot;
                              </p>

                              {/* AI Reply Callout */}
                              {item.generatedReply && (
                                <div className="ml-8 mt-2 p-3 rounded-lg bg-purple-50/80 dark:bg-purple-950/30 border border-purple-100 dark:border-purple-900/50">
                                  <div className="flex items-center gap-1.5 mb-1 text-[11px] font-bold text-purple-700 dark:text-purple-300">
                                    <Bot className="w-3.5 h-3.5" />
                                    <span>Unique Mecca Audio AI Response</span>
                                  </div>
                                  <p className="text-xs text-gray-800 dark:text-gray-200 leading-relaxed">
                                    {item.generatedReply}
                                  </p>
                                </div>
                              )}

                              {/* Creator Manual Reply Callout */}
                              {item.manualReplyText && (
                                <div className="ml-8 mt-2 p-3 rounded-lg bg-indigo-50/80 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/50">
                                  <div className="flex items-center gap-1.5 mb-1 text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
                                    <User className="w-3.5 h-3.5" />
                                    <span>Creator Manual Response</span>
                                  </div>
                                  <p className="text-xs text-gray-800 dark:text-gray-200 leading-relaxed">
                                    {item.manualReplyText}
                                  </p>
                                </div>
                              )}

                              {item.skipReason && item.status !== 'handled_manually' && (
                                <div className="ml-8 text-[11px] text-amber-600 dark:text-amber-400">
                                  Reason: {item.skipReason}
                                </div>
                              )}
                            </div>
                          ))
                        ) : (
                          <div className="text-xs text-gray-400 text-center py-2">No items recorded in batch</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
