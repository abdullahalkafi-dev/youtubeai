'use client'

import { StatCards } from '@/components/dashboard/stat-cards'
import { RecentUpdates } from '@/components/dashboard/recent-updates'
import { TrendingIdeas } from '@/components/dashboard/trending-ideas'
import { ReconnectBanner } from '@/components/dashboard/reconnect-banner'

export default function DashboardPage() {
  return (
    <div className="p-4 lg:p-6 2xl:p-8 max-w-[1600px] mx-auto">
      <div className="mb-6">
        <h1 className="text-xl lg:text-2xl font-bold text-gray-900 dark:text-white font-heading">Dashboard</h1>
        <p className="text-sm lg:text-base text-gray-400 dark:text-gray-500 mt-0.5">What to do today</p>
      </div>

      <ReconnectBanner />

      <StatCards />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-6">
        <TrendingIdeas />
        <RecentUpdates />
      </div>
    </div>
  )
}
