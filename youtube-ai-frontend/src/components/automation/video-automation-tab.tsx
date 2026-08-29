'use client';

import React, { useEffect, useState } from 'react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import {
  fetchAutomationStats,
  fetchAutomationBatches,
  fetchActiveBatch,
  runBatchAsync,
  retryBatchAsync,
  cancelBatchAsync,
  onBatchStarted,
  onItemProgress,
  onBatchCompleted,
  onStatsUpdated,
} from '@/store/slices/automation-slice';
import { AutomationMetrics } from './automation-metrics';
import { BatchLiveProgress } from './batch-live-progress';
import { BatchCard } from './batch-card';
import { Card, CardContent } from '@/components/ui/card';
import { Play, Sparkles, RefreshCw, AlertCircle, History } from 'lucide-react';
import { toast } from 'sonner';
import { getAutomationSocket, joinChannelAutomation, leaveChannelAutomation } from '@/lib/socket';

export function VideoAutomationTab() {
  const dispatch = useAppDispatch();
  const channelId = useAppSelector((s) => s.auth.activeChannelId);
  const { stats, activeBatch, batches, totalBatches, currentPage, totalPages, loading, triggering } =
    useAppSelector((s) => s.automation);

  const [retryingId, setRetryingId] = useState<string | null>(null);

  // 1. Fetch initial data and setup Socket.IO connection
  useEffect(() => {
    if (!channelId) return;

    dispatch(fetchAutomationStats(channelId));
    dispatch(fetchActiveBatch(channelId));
    dispatch(fetchAutomationBatches({ channelId, page: 1, limit: 10 }));

    // Socket.IO channel room setup
    joinChannelAutomation(channelId);
    const socket = getAutomationSocket();

    const handleBatchStarted = (data: any) => {
      dispatch(onBatchStarted(data));
      dispatch(fetchActiveBatch(channelId));
      toast.info(`Automation Batch #${data.batchId?.slice(-6)} started!`);
    };

    const handleItemProgress = (data: any) => {
      dispatch(onItemProgress(data));
    };

    const handleBatchCompleted = (data: any) => {
      dispatch(onBatchCompleted(data));
      dispatch(fetchAutomationStats(channelId));
      dispatch(fetchAutomationBatches({ channelId, page: 1, limit: 10 }));
      if (data.status === 'completed') {
        toast.success(`Batch #${data.batchId?.slice(-6)} completed successfully! All videos pushed to YouTube.`);
      } else if (data.status === 'partial') {
        toast.warning(`Batch #${data.batchId?.slice(-6)} finished with partial success (${data.successful} pushed, ${data.failed} failed).`);
      } else {
        toast.error(`Batch #${data.batchId?.slice(-6)} encountered errors.`);
      }
    };

    const handleStatsUpdated = (data: any) => {
      dispatch(onStatsUpdated(data));
    };

    socket.on('automation:batch_started', handleBatchStarted);
    socket.on('automation:item_progress', handleItemProgress);
    socket.on('automation:batch_completed', handleBatchCompleted);
    socket.on('automation:stats_updated', handleStatsUpdated);

    return () => {
      socket.off('automation:batch_started', handleBatchStarted);
      socket.off('automation:item_progress', handleItemProgress);
      socket.off('automation:batch_completed', handleBatchCompleted);
      socket.off('automation:stats_updated', handleStatsUpdated);
      leaveChannelAutomation(channelId);
    };
  }, [channelId, dispatch]);

  // Handle manual trigger
  const handleRunManualBatch = async () => {
    if (!channelId) return;
    try {
      const batchSize = stats?.dailyBatchSize || 50;
      const res = await dispatch(runBatchAsync({ channelId, batchSize, source: 'manual_ui_batch' })).unwrap();
      toast.success(res.message || 'Batch dispatched successfully!');
      dispatch(fetchActiveBatch(channelId));
    } catch (err: any) {
      toast.error(err.message || 'Failed to start batch.');
    }
  };

  // Handle child retry
  const handleRetryBatch = async (batchId: string) => {
    setRetryingId(batchId);
    try {
      const res = await dispatch(retryBatchAsync(batchId)).unwrap();
      toast.success(res.message || 'Retry child batch dispatched!');
      if (channelId) {
        dispatch(fetchActiveBatch(channelId));
        dispatch(fetchAutomationBatches({ channelId, page: 1, limit: 10 }));
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to retry batch.');
    } finally {
      setRetryingId(null);
    }
  };

  // Handle cancel
  const handleCancelBatch = async (batchId: string) => {
    try {
      await dispatch(cancelBatchAsync(batchId)).unwrap();
      toast.info('Batch cancelled.');
      if (channelId) {
        dispatch(fetchAutomationStats(channelId));
        dispatch(fetchAutomationBatches({ channelId, page: 1, limit: 10 }));
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to cancel batch.');
    }
  };

  const isBatchRunning = stats?.isBatchRunning || activeBatch?.status === 'generating' || activeBatch?.status === 'pushing';
  const hasInsufficientQuota = (stats?.quotaUsed || 0) + (stats?.quotaCostPerBatch || 1020) > (stats?.quotaSafetyCap || 9000);
  const noVideosLeft = (stats?.remainingUnoptimized || 0) === 0;

  return (
    <div>
      {/* Action Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-lg lg:text-xl font-bold text-gray-900 dark:text-white font-heading flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-500" />
            Video SEO Daily Automation Pipeline
          </h2>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Automated daily {stats?.dailyBatchSize || 50}-video batches with DB staging, conflict safety, and paced YouTube publishing
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => channelId && dispatch(fetchAutomationStats(channelId))}
            disabled={loading}
            className="p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 hover:text-gray-900 dark:hover:text-white transition shadow-sm"
            title="Refresh Stats"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={handleRunManualBatch}
            disabled={isBatchRunning || triggering || hasInsufficientQuota || noVideosLeft}
            className="bg-gradient-to-r from-indigo-500 via-indigo-600 to-purple-600 text-white font-semibold text-xs sm:text-sm px-4 py-2.5 rounded-xl hover:from-indigo-600 hover:to-purple-700 transition shadow-lg shadow-indigo-500/25 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {triggering ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Dispatching...
              </>
            ) : isBatchRunning ? (
              <>
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Batch in Progress
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-white" />
                Run {stats?.dailyBatchSize || 50} Video Batch Now
              </>
            )}
          </button>
        </div>
      </div>

      {/* Quota or Empty State Warnings */}
      {hasInsufficientQuota && (
        <div className="mb-6 p-4 rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50/70 dark:bg-amber-500/10 flex items-center gap-3 text-xs text-amber-800 dark:text-amber-300">
          <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
          <p>
            YouTube daily quota limit reached ({stats?.quotaUsed?.toLocaleString()} / {stats?.quotaSafetyCap?.toLocaleString()} units). Manual batch runs are paused until midnight UTC quota reset.
          </p>
        </div>
      )}

      {/* Top 4 KPI Metrics */}
      <AutomationMetrics stats={stats} loading={loading} />

      {/* Live Active Batch Tracker (when running) */}
      {activeBatch && (activeBatch.status === 'generating' || activeBatch.status === 'pushing' || activeBatch.status === 'checking_quota') && (
        <BatchLiveProgress batch={activeBatch} onCancel={handleCancelBatch} />
      )}

      {/* Historical Batches Section */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-gray-400" />
            <h3 className="text-sm lg:text-base font-bold text-gray-900 dark:text-white font-heading">
              Automation Batch History ({totalBatches})
            </h3>
          </div>
        </div>

        {batches.length > 0 ? (
          <div className="space-y-3.5">
            {batches.map((b) => (
              <BatchCard
                key={b.id || b._id}
                batch={b}
                onRetry={handleRetryBatch}
                retrying={retryingId === (b.id || b._id)}
              />
            ))}
          </div>
        ) : (
          <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
            <CardContent className="p-8 text-center">
              <Sparkles className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p className="text-sm font-semibold text-gray-900 dark:text-white">No batches executed yet</p>
              <p className="text-xs text-gray-400 mt-1 max-w-md mx-auto">
                Daily scheduled automation runs every morning at 7:30 AM New York time, or you can trigger an on-demand batch above.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
