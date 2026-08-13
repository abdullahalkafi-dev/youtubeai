'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Eye } from 'lucide-react'
import { useAppSelector, useAppDispatch } from '@/store/hooks'
import { fetchQuotaUsage } from '@/store/slices/quota-slice'
import { cn } from '@/lib/utils'

export default function SettingsPage() {
  const [showOpenAI, setShowOpenAI] = useState(false)
  const [showYoutube, setShowYoutube] = useState(false)
  const dispatch = useAppDispatch()
  const channelId = useAppSelector((s) => s.auth.activeChannelId)
  const { usage, loading: quotaLoading } = useAppSelector((s) => s.quota)

  useEffect(() => {
    if (channelId) {
      dispatch(fetchQuotaUsage(channelId))
    }
  }, [channelId, dispatch])

  const percentage = usage ? Math.round((usage.used / usage.limit) * 100) : 0

  return (
    <div className="p-4 lg:p-6 2xl:p-8 max-w-[1600px] mx-auto">
      <div className="mb-6">
        <h1 className="text-xl lg:text-2xl font-bold text-gray-900 dark:text-white font-heading">Settings</h1>
        <p className="text-sm lg:text-base text-gray-400 mt-0.5">Account, API keys, preferences</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-6">
        <Card>
          <CardContent className="p-5 lg:p-6">
            <h3 className="text-sm lg:text-base font-semibold text-gray-900 dark:text-white mb-4 font-heading">Account</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3 bg-gray-50 dark:bg-gray-800 rounded-xl p-3.5 border border-gray-200 dark:border-gray-700">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-400 to-indigo-600 flex items-center justify-center text-white font-bold text-sm shrink-0 shadow-sm">U</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">Unique Mecca Audio</p>
                  <p className="text-xs text-gray-400">@uniquemeccaaudionyc · 156K</p>
                </div>
                <Badge variant="green">Connected</Badge>
              </div>
              <div className="flex items-center gap-3 bg-gray-50 dark:bg-gray-800 rounded-xl p-3.5 border border-gray-200 dark:border-gray-700">
                <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-blue-500" viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/></svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">uniquemeccaaudio@gmail.com</p>
                  <p className="text-xs text-gray-400">OAuth 2.0 · Valid</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 lg:p-6">
            <h3 className="text-sm lg:text-base font-semibold text-gray-900 dark:text-white mb-4 font-heading">API Keys</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 font-medium block mb-1.5">OpenAI</label>
                <div className="flex gap-2">
                  <Input
                    type={showOpenAI ? 'text' : 'password'}
                    value="sk-xxxxxxxxxxxxxxxxxxxx"
                    readOnly
                    className="bg-gray-50 dark:bg-gray-800 text-sm flex-1"
                  />
                  <button onClick={() => setShowOpenAI(!showOpenAI)} className="text-gray-400 hover:text-gray-600 p-2">
                    <Eye className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium block mb-1.5">YouTube Data API</label>
                <div className="flex gap-2">
                  <Input
                    type={showYoutube ? 'text' : 'password'}
                    value="AIzaSyxxxxxxxxxxxxxxxxxxx"
                    readOnly
                    className="bg-gray-50 dark:bg-gray-800 text-sm flex-1"
                  />
                  <button onClick={() => setShowYoutube(!showYoutube)} className="text-gray-400 hover:text-gray-600 p-2">
                    <Eye className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20 rounded-lg p-3">
                <p className="text-xs text-amber-700 dark:text-amber-400">API keys stored on backend only. Never exposed to frontend.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 lg:p-6">
            <h3 className="text-sm lg:text-base font-semibold text-gray-900 dark:text-white mb-4 font-heading">Quota Manager</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 font-medium block mb-1.5">Daily Update Cap</label>
                <Input type="number" defaultValue={120} className="bg-gray-50 dark:bg-gray-800 text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium block mb-1.5">Cron Interval</label>
                <select className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg py-2 px-3 text-sm text-gray-500">
                  <option>Every 5 min</option>
                  <option>Every 10 min</option>
                  <option>Every 15 min</option>
                </select>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm text-gray-700 dark:text-gray-300 font-medium">Auto-pause at limit</Label>
                  <p className="text-xs text-gray-400">Stop when daily cap reached</p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm text-gray-700 dark:text-gray-300 font-medium">Auto-resume midnight</Label>
                  <p className="text-xs text-gray-400">Reset quota at 12:00 AM EST</p>
                </div>
                <Switch defaultChecked />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* YouTube API Quota */}
        <Card>
          <CardContent className="p-5 lg:p-6">
            <h3 className="text-sm lg:text-base font-semibold text-gray-900 dark:text-white mb-4 font-heading">
              YouTube API Quota
            </h3>
            {quotaLoading && !usage ? (
              <div className="space-y-2 animate-pulse">
                <div className="h-2 bg-gray-200 dark:bg-gray-800 rounded-full" />
                <div className="h-2 bg-gray-200 dark:bg-gray-800 rounded w-1/2" />
              </div>
            ) : usage ? (
              <div className="space-y-4">
                {/* Progress Bar */}
                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      {usage.used.toLocaleString()} / {usage.limit.toLocaleString()} units
                    </span>
                    <span className={cn(
                      'font-semibold',
                      percentage > 80 ? 'text-red-500' : percentage > 60 ? 'text-amber-500' : 'text-indigo-500',
                    )}>
                      {percentage}%
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2">
                    <div
                      className={cn(
                        'h-2 rounded-full transition-all',
                        percentage > 80 ? 'bg-red-500' : percentage > 60 ? 'bg-amber-500' : 'bg-indigo-500',
                      )}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">Resets at midnight Pacific Time</p>
                </div>

                {/* Breakdown by Endpoint */}
                {Object.keys(usage.breakdown).length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Usage by Endpoint</p>
                    <div className="space-y-1.5">
                      {Object.entries(usage.breakdown)
                        .sort(([, a], [, b]) => b - a)
                        .map(([endpoint, units]) => (
                          <div key={endpoint} className="flex justify-between text-xs">
                            <span className="text-gray-500 dark:text-gray-400 font-mono">{endpoint}</span>
                            <span className="font-medium text-gray-700 dark:text-gray-300">{units} units</span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {Object.keys(usage.breakdown).length === 0 && (
                  <p className="text-xs text-gray-400 italic">No API calls recorded today</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-400">Unable to load quota data</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
