'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useAppSelector, useAppDispatch } from '@/store/hooks'
import { createThread } from '@/store/slices/chat-slice'
import { fetchTrends } from '@/store/slices/trends-slice'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { formatDate } from '@/lib/utils'
import { Play, AlertCircle } from 'lucide-react'

export function TrendingIdeas() {
  const dispatch = useAppDispatch()
  const router = useRouter()
  const channelId = useAppSelector(s => s.auth.activeChannelId)
  const { topics } = useAppSelector(s => s.trends)

  useEffect(() => {
    if (channelId) {
      dispatch(fetchTrends({ channelId }))
    }
  }, [channelId, dispatch])

  const handleStartThread = (title: string, e: React.MouseEvent) => {
    e.preventDefault()
    if (!channelId) return
    dispatch(createThread({
      channelId,
      title,
      type: 'standalone',
    }))
    toast.success('Thread created', { description: title })
    router.push('/chat')
  }

  const displayTopics = topics.slice(0, 3)

  if (displayTopics.length === 0) {
    return (
      <Card className="hover:shadow-md transition-shadow">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white font-heading">Trending Ideas</h3>
          </div>
          <p className="text-xs text-gray-400">No trending topics yet. Visit the Trends page to discover stories.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white font-heading">Trending Ideas</h3>
          <Badge variant="green">Live</Badge>
        </div>
        <div className="space-y-2.5">
          {displayTopics.map((topic) => (
            <div key={topic.id} className="p-3 rounded-lg border border-gray-100 dark:border-gray-800 hover:border-indigo-200 dark:hover:border-indigo-800 hover:bg-indigo-50/30 dark:hover:bg-indigo-500/5 transition group">
              <div className="flex items-center justify-between mb-1.5">
                {topic.youtubeVideoId ? (
                  <div className="flex items-center gap-1 text-[10px] text-green-600 dark:text-green-400">
                    <Play className="w-2.5 h-2.5 fill-green-600 dark:fill-green-400" />
                    <span className="font-medium">Video found</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                    <AlertCircle className="w-2.5 h-2.5" />
                    <span className="font-medium">Open opportunity</span>
                  </div>
                )}
                <button
                  onClick={(e) => handleStartThread(topic.title, e)}
                  className="text-xs text-gray-400 hover:text-indigo-500 transition font-medium"
                >
                  Start Thread →
                </button>
              </div>
              <p className="text-sm text-gray-900 dark:text-white font-semibold">{topic.title}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 line-clamp-1">{topic.summary}</p>
              {topic.youtubeChannelTitle && (
                <p className="text-[10px] text-green-600 dark:text-green-400 mt-1">
                  Covered by {topic.youtubeChannelTitle}
                </p>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
