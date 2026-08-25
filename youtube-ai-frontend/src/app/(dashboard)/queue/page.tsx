'use client';

import React, { useState } from 'react';
import { VideoAutomationTab } from '@/components/automation/video-automation-tab';
import { CommentAutomationTab } from '@/components/automation/comment-automation-tab';
import { Sparkles, MessageSquare, Video } from 'lucide-react';

export default function AutomationHubPage() {
  const [activeTab, setActiveTab] = useState<'video_seo' | 'comment_reply'>('video_seo');

  return (
    <div className="p-4 lg:p-6 2xl:p-8 max-w-[1600px] mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-gray-900 dark:text-white font-heading flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-md shadow-indigo-500/20">
              <Sparkles className="w-5 h-5" />
            </span>
            Automation Center
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Autonomous daily AI optimization engine with DB-first staging & verified YouTube publishing
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex p-1 bg-gray-100 dark:bg-gray-800/80 rounded-xl border border-gray-200/80 dark:border-gray-700/60 shadow-inner">
          <button
            onClick={() => setActiveTab('video_seo')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition ${
              activeTab === 'video_seo'
                ? 'bg-white dark:bg-gray-900 text-indigo-600 dark:text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            <Video className="w-4 h-4" />
            Video SEO
          </button>

          <button
            onClick={() => setActiveTab('comment_reply')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition ${
              activeTab === 'comment_reply'
                ? 'bg-white dark:bg-gray-900 text-indigo-600 dark:text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            Comments
          </button>
        </div>
      </div>

      {/* Tab Contents */}
      {activeTab === 'video_seo' ? (
        <VideoAutomationTab />
      ) : (
        <CommentAutomationTab />
      )}
    </div>
  );
}
