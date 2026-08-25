'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MessageSquare, Sparkles, Shield, Clock, Zap, CheckCircle2 } from 'lucide-react';

export function CommentAutomationTab() {
  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg lg:text-xl font-bold text-gray-900 dark:text-white font-heading flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-indigo-500" />
              Comment Auto-Reply & Moderation Automation
            </h2>
            <Badge variant="purple">Phase 2 · In Development</Badge>
          </div>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Automated batch reply generation, sentiment analysis, and smart response scheduling
          </p>
        </div>
      </div>

      {/* Feature Preview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
          <CardContent className="p-5">
            <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 w-fit mb-3">
              <Sparkles className="w-5 h-5" />
            </div>
            <h4 className="text-sm font-bold text-gray-900 dark:text-white font-heading">
              AI Smart Auto-Reply Batches
            </h4>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Processes top incoming unreplied comments daily, drafts contextual replies in channel tone, and stages them for approval.
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
          <CardContent className="p-5">
            <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 w-fit mb-3">
              <Shield className="w-5 h-5" />
            </div>
            <h4 className="text-sm font-bold text-gray-900 dark:text-white font-heading">
              Sentiment & Spam Filter
            </h4>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Categorizes questions, praise, and feedback while automatically flagging spam or promotional bot links.
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
          <CardContent className="p-5">
            <div className="p-2.5 rounded-xl bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 w-fit mb-3">
              <Clock className="w-5 h-5" />
            </div>
            <h4 className="text-sm font-bold text-gray-900 dark:text-white font-heading">
              Paced YouTube Posting
            </h4>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Shares the same robust 5-second burst smoothing engine to safely publish replies via official YouTube Data API.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Architecture Readiness Box */}
      <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <h3 className="text-sm font-bold text-gray-900 dark:text-white font-heading">
              Backend Architecture Ready
            </h3>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4 leading-relaxed">
            The batch execution pipeline (`AutomationBatch` schema with `type: 'comment_reply'`), Socket.IO live flow visualizer, and rate-limited scheduler are built to support Comment Automation seamlessly as soon as comment reply policies are configured.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
              <span className="text-gray-400 block text-[11px]">Supported Type</span>
              <span className="font-semibold text-gray-800 dark:text-gray-200 font-mono">type: 'comment_reply'</span>
            </div>
            <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
              <span className="text-gray-400 block text-[11px]">Real-time Socket</span>
              <span className="font-semibold text-gray-800 dark:text-gray-200">Socket.IO Gateway</span>
            </div>
            <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
              <span className="text-gray-400 block text-[11px]">Rate Pacing</span>
              <span className="font-semibold text-gray-800 dark:text-gray-200">5s Safety Gap</span>
            </div>
            <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
              <span className="text-gray-400 block text-[11px]">Status</span>
              <span className="font-semibold text-indigo-600 dark:text-indigo-400">Ready for Activation</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
