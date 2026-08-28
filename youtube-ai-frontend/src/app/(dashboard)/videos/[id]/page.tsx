'use client'

import { use, useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAppSelector, useAppDispatch } from '@/store/hooks'
import { fetchVideoById, clearSelectedVideo, updateSelectedVideo } from '@/store/slices/videos-slice'
import { createThread, selectThread } from '@/store/slices/chat-slice'
import { generateSeo, approveSeoAsync } from '@/store/slices/seo-slice'
import { api, formatAssetUrl } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { formatNumber, formatDate } from '@/lib/utils'
import { ArrowLeft, Check, Clock, RotateCcw, MessageSquare, Sparkles, Loader2, Copy, ExternalLink, Eye, X } from 'lucide-react'
import { toast } from 'sonner'
import type { VideoVersion } from '@/types/video'
import { CommentsSection } from '@/components/comments/comments-section'
import { FormattedDescription } from '@/components/shared/formatted-description'

export default function VideoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const dispatch = useAppDispatch()
  const channelId = useAppSelector(s => s.auth.activeChannelId)
  const video = useAppSelector(s => s.videos.selectedVideo)
  const [regenerateOpen, setRegenerateOpen] = useState(false)
  const [regenerateNotes, setRegenerateNotes] = useState('')
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [hoveredVersion, setHoveredVersion] = useState<VideoVersion | null>(null)
  const [selectedVersionForModal, setSelectedVersionForModal] = useState<VideoVersion | null>(null)
  const [versions, setVersions] = useState<VideoVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [approving, setApproving] = useState(false)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [versionsKey, setVersionsKey] = useState(0)

  const handleOpenChat = async () => {
    if (!video) return
    if (channelId) {
      try {
        const existing = await api.findThreadByVideoId(channelId, video.id).catch(() => null)
        if (existing?.id) {
          dispatch(selectThread(existing.id))
        } else {
          const newThread = await dispatch(createThread({
            channelId,
            type: 'video',
            videoId: video.id,
            title: video.title || video.youtubeTitle || undefined,
          })).unwrap().catch(() => null)
          if (newThread?.id) {
            dispatch(selectThread(newThread.id))
          }
        }
      } catch { /* proceed to navigation */ }
    }
    router.push(`/chat?videoId=${video.id}&videoTitle=${encodeURIComponent(video.title || video.youtubeTitle || '')}`)
  }

  useEffect(() => {
    dispatch(fetchVideoById(id))
    return () => { dispatch(clearSelectedVideo()) }
  }, [id, dispatch])

  useEffect(() => {
    if (video) {
      setVersionsLoading(true)
      api.getSeoVersions(video.id)
        .then(setVersions)
        .catch(() => setVersions([]))
        .finally(() => setVersionsLoading(false))
    }
  }, [video?.id, versionsKey])

  // Lazy-load analytics if not yet synced (useRef guard prevents infinite loop)
  const analyticsFetched = useRef(false)
  useEffect(() => {
    analyticsFetched.current = false
  }, [id])
  useEffect(() => {
    if (video && !video.lastAnalyticsSync && !analyticsFetched.current) {
      analyticsFetched.current = true
      setAnalyticsLoading(true)
      api.fetchVideoAnalytics(video.id)
        .then((updated) => {
          if (updated) dispatch(updateSelectedVideo(updated))
        })
        .catch(() => { analyticsFetched.current = false })
        .finally(() => setAnalyticsLoading(false))
    }
  }, [video, dispatch])

  if (!video) {
    return (
      <div className="p-6 text-center">
        <div className="w-6 h-6 border-[3px] border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-400">Loading video...</p>
        <Link href="/videos" className="text-indigo-500 text-sm mt-2 inline-block">Back to Library</Link>
      </div>
    )
  }

  const handleApprove = async () => {
    if (!video.suggestedSeo || approving) return
    setApproving(true)
    try {
      // Find the pending suggestion for this video
      const suggestions = await api.getSeoSuggestions(video.channelId)
      // s.videoId may be populated (object) or a string — handle both
      const pending = suggestions.find(s => {
        const sVideoId = typeof s.videoId === 'object' && s.videoId !== null ? (s.videoId as any).id || (s.videoId as any)._id : s.videoId
        return sVideoId === video.id && s.status === 'pending'
      })
      if (pending) {
        const result = await dispatch(approveSeoAsync(pending.id)).unwrap()
        if (result.youtubePushed) {
          toast.success("SEO approved & pushed to YouTube!", { description: "Video updated on YouTube" })
        } else {
          toast.success("SEO approved!", { description: "Saved in system (YouTube push skipped)" })
        }
        dispatch(fetchVideoById(id))
        setVersionsKey(k => k + 1)
      } else {
        toast.error("No pending SEO suggestion found")
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to approve SEO")
    } finally {
      setApproving(false)
    }
  }

  const handleRegenerate = async () => {
    if (isRegenerating) return
    setIsRegenerating(true)
    try {
      await dispatch(generateSeo({ videoId: video.id, customInstructions: regenerateNotes })).unwrap()
      await dispatch(fetchVideoById(id)).unwrap()
      setVersionsKey(k => k + 1)
      toast.success("SEO regenerated successfully!", { description: regenerateNotes || "Updated AI suggestions" })
    } catch (err: any) {
      toast.error(err.message || "Failed to regenerate SEO")
    } finally {
      setIsRegenerating(false)
      setRegenerateOpen(false)
      setRegenerateNotes('')
    }
  }

  const handleRollback = async (versionId: string) => {
    try {
      await api.rollbackSeoVersion(versionId)
      dispatch(fetchVideoById(id))
      setVersionsKey(k => k + 1)
      toast.success("Rolled back successfully!")
    } catch (err: any) {
      toast.error(err?.message || "Failed to rollback")
    }
  }

  const handlePullFromYoutube = async () => {
    try {
      await api.pullFromYoutube(id)
      dispatch(fetchVideoById(id))
      toast.success("Updated DB metadata to match YouTube!")
    } catch (err: any) {
      toast.error(err?.message || "Failed to update from YouTube")
    }
  }

  const handleCopyField = async (text: string, fieldName: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${fieldName} copied to clipboard!`)
    } catch {
      toast.error('Failed to copy')
    }
  }

  return (
    <div className="p-4 lg:p-6 2xl:p-8 max-w-[1600px] mx-auto space-y-6">
      {/* Top Header */}
      <div>
        <Link href="/videos" className="text-xs text-gray-400 hover:text-indigo-500 flex items-center gap-1 mb-3 transition font-medium">
          <ArrowLeft className="w-3.5 h-3.5" />Back to Video Library
        </Link>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 shadow-sm">
          <div className="flex items-start gap-4">
            {video.thumbnailUrl && (
              <img src={formatAssetUrl(video.thumbnailUrl)} alt="" className="w-36 h-20 object-cover rounded-xl shrink-0 border border-gray-100 dark:border-gray-800 shadow-sm" />
            )}
            <div>
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h1 className="text-lg lg:text-xl font-bold text-gray-900 dark:text-white font-heading leading-tight">{video.title}</h1>
                {video.privacyStatus && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase ${
                    video.privacyStatus === 'public' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400' :
                    video.privacyStatus === 'unlisted' ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400' :
                    'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400'
                  }`}>
                    {video.privacyStatus}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400">
                Published {video.publishedAt ? formatDate(video.publishedAt) : 'Unknown'} &middot; {formatNumber(video.viewCount)} views &middot; ID: <code className="text-[10px] bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">{video.youtubeId || video.id}</code>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
            {video.youtubeId && (
              <a
                href={`https://www.youtube.com/watch?v=${video.youtubeId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-xs font-semibold px-4 py-2.5 rounded-xl border border-red-100 dark:border-red-500/20 hover:bg-red-100 dark:hover:bg-red-500/20 transition flex items-center justify-center gap-1.5 shadow-sm"
              >
                <ExternalLink className="w-4 h-4 text-red-500" />Open in YouTube
              </a>
            )}
            <button
              onClick={handleOpenChat}
              className="bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-xs font-semibold px-4 py-2.5 rounded-xl border border-indigo-100 dark:border-indigo-500/20 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition flex items-center justify-center gap-1.5 shadow-sm"
            >
              <MessageSquare className="w-4 h-4" />Open in AI Chat
            </button>
          </div>
        </div>
      </div>

      {video.deletedFromYoutube && (
        <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-xl p-4">
          <p className="text-sm font-semibold text-rose-700 dark:text-rose-400">
            This video has been deleted from YouTube
          </p>
          <p className="text-xs text-rose-600 dark:text-rose-500 mt-1">
            SEO and chat features are disabled. The video data is preserved for history.
          </p>
        </div>
      )}

      {video.youtubeTitle && video.title !== video.youtubeTitle && !video.deletedFromYoutube && (
        <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-sm">
          <div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              Title differs from YouTube Studio
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-1 leading-relaxed">
              <strong>DB:</strong> &quot;{video.title}&quot; &middot; <strong>YouTube Live:</strong> &quot;{video.youtubeTitle}&quot;
            </p>
          </div>
          <button
            onClick={handlePullFromYoutube}
            className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition shadow-sm"
          >
            Update DB to Match YouTube
          </button>
        </div>
      )}

      {/* Analytics Metric Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
          <CardContent className="p-4">
            <span className="text-xs font-medium text-gray-400">Views</span>
            <p className="text-xl font-bold text-gray-900 dark:text-white mt-1 font-heading">{formatNumber(video.viewCount)}</p>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
          <CardContent className="p-4">
            <span className="text-xs font-medium text-gray-400">Avg Watch</span>
            <p className="text-xl font-bold text-gray-900 dark:text-white mt-1 font-heading">
              {video.lastAnalyticsSync ? `${video.avgWatchTime ?? 0} min` : '—'}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
          <CardContent className="p-4">
            <span className="text-xs font-medium text-gray-400">Retention</span>
            <p className="text-xl font-bold text-gray-900 dark:text-white mt-1 font-heading">
              {video.lastAnalyticsSync ? `${video.retentionPercent ?? 0}%` : '—'}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
          <CardContent className="p-4">
            <span className="text-xs font-medium text-gray-400">Revenue</span>
            <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 font-heading">
              {video.lastAnalyticsSync ? `$${video.estimatedRevenue.toFixed(2)}` : '—'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* FULL-WIDTH Before vs After SEO Card */}
      <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 shadow-sm">
        <CardContent className="p-5 lg:p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-base font-bold text-gray-900 dark:text-white font-heading">Before vs After</h3>
            {video.lastAnalyticsSync && (
              <span className="text-[10px] text-gray-400">Last synced: {formatDate(video.lastAnalyticsSync)}</span>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* CURRENT */}
            <div className="bg-red-50/50 dark:bg-red-500/5 border border-red-100 dark:border-red-500/15 rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-1.5"><Badge variant="red">CURRENT</Badge></div>
              <div className="space-y-3.5">
                {(() => {
                  const seo = video.currentSeo || { title: video.title, description: video.description || '', tags: video.tags || [] }
                  return (seo.title || seo.description) ? (
                    <>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs text-gray-500 font-medium">Title</label>
                          <button
                            onClick={() => handleCopyField(seo.title, 'Current Title')}
                            className="text-[10px] text-gray-400 hover:text-indigo-500 font-medium flex items-center gap-1 transition"
                            title="Copy Title"
                          >
                            <Copy className="w-3 h-3" />
                            Copy
                          </button>
                        </div>
                        <p className="text-xs text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-800/80 rounded-xl p-3 border border-red-100 dark:border-red-500/20 font-medium leading-relaxed">{seo.title}</p>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs text-gray-500 font-medium">Description</label>
                          <button
                            onClick={() => handleCopyField(seo.description, 'Current Description')}
                            className="text-[10px] text-gray-400 hover:text-indigo-500 font-medium flex items-center gap-1 transition"
                            title="Copy Description"
                          >
                            <Copy className="w-3 h-3" />
                            Copy
                          </button>
                        </div>
                        <div className="bg-white dark:bg-gray-800/80 rounded-xl p-3 border border-red-100 dark:border-red-500/20 min-h-[160px] max-h-[220px] overflow-y-auto">
                          <FormattedDescription text={seo.description} className="text-xs text-gray-600 dark:text-gray-300" />
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-xs text-gray-500 font-medium">Tags ({seo.tags.length})</label>
                          <button
                            onClick={() => handleCopyField(seo.tags.join(', '), 'Current Tags')}
                            className="text-[10px] text-gray-400 hover:text-indigo-500 font-medium flex items-center gap-1 transition"
                            title="Copy All Tags"
                          >
                            <Copy className="w-3 h-3" />
                            Copy All
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5 max-h-[140px] overflow-y-auto p-1">
                          {seo.tags.map((tag, i) => (
                            <span key={i} className="text-xs bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-700">{tag}</span>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-gray-400 italic">No current SEO set</p>
                  )
                })()}
              </div>
            </div>

            {/* AI SUGGESTED */}
            <div className="bg-emerald-50/50 dark:bg-emerald-500/5 border border-emerald-100 dark:border-emerald-500/15 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <Badge variant="green">AI SUGGESTED</Badge>
                {isRegenerating && (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-semibold animate-pulse">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating...
                  </span>
                )}
              </div>
              {video.suggestedSeo ? (
                <div className="space-y-3.5">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Title</label>
                      <button
                        onClick={() => handleCopyField(video.suggestedSeo!.title, 'AI Suggested Title')}
                        className="text-[10px] text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 font-medium flex items-center gap-1 transition"
                        title="Copy AI Suggested Title"
                      >
                        <Copy className="w-3 h-3" />
                        Copy
                      </button>
                    </div>
                    <p className="text-xs text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-800/80 rounded-xl p-3 border border-emerald-100 dark:border-emerald-500/20 font-medium leading-relaxed">{video.suggestedSeo.title}</p>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Description</label>
                      <button
                        onClick={() => handleCopyField(video.suggestedSeo!.description, 'AI Suggested Description')}
                        className="text-[10px] text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 font-medium flex items-center gap-1 transition"
                        title="Copy AI Suggested Description"
                      >
                        <Copy className="w-3 h-3" />
                        Copy
                      </button>
                    </div>
                    <div className="bg-white dark:bg-gray-800/80 rounded-xl p-3 border border-emerald-100 dark:border-emerald-500/20 min-h-[160px] max-h-[220px] overflow-y-auto">
                      <FormattedDescription text={video.suggestedSeo.description} className="text-xs text-gray-600 dark:text-gray-300" />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Tags ({video.suggestedSeo.tags.length})</label>
                      <button
                        onClick={() => handleCopyField(video.suggestedSeo!.tags.join(', '), 'AI Suggested Tags')}
                        className="text-[10px] text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 font-medium flex items-center gap-1 transition"
                        title="Copy All AI Suggested Tags"
                      >
                        <Copy className="w-3 h-3" />
                        Copy All
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-[140px] overflow-y-auto p-1">
                      {video.suggestedSeo.tags.map((tag, i) => (
                        <span key={i} className="text-xs bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-500/25 font-medium">{tag}</span>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic">No suggestions yet</p>
              )}
            </div>
          </div>

          {/* Action Row */}
          <div className="flex items-center gap-3 mt-5 pt-4 border-t border-gray-100 dark:border-gray-800">
            <button
              onClick={handleApprove}
              disabled={!video.suggestedSeo || approving || video.deletedFromYoutube || isRegenerating}
              className="bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold px-5 py-2.5 rounded-xl transition shadow-sm shadow-emerald-500/20 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              title={video.deletedFromYoutube ? 'Video deleted from YouTube' : !video.suggestedSeo ? 'Generate SEO suggestion first' : ''}
            >
              {approving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {approving ? 'Pushing to YouTube...' : '✓ Approve & Push'}
            </button>
            <button
              onClick={() => setRegenerateOpen(!regenerateOpen)}
              disabled={video.deletedFromYoutube || isRegenerating}
              className="bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-xs font-semibold px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition flex items-center gap-2 disabled:opacity-50"
            >
              {isRegenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-indigo-500" />}
              {isRegenerating ? 'Generating...' : 'Regenerate'}
            </button>
          </div>

          {regenerateOpen && (
            <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700 space-y-3">
              <label className="text-xs text-gray-600 dark:text-gray-300 font-medium block">Custom Instructions <span className="text-gray-400 font-normal">(optional)</span></label>
              <textarea
                value={regenerateNotes}
                onChange={(e) => setRegenerateNotes(e.target.value)}
                placeholder="Any specific angle, keywords, or style to emphasize..."
                rows={2}
                className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-xs text-gray-900 dark:text-white placeholder:text-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleRegenerate}
                  disabled={isRegenerating}
                  className="bg-indigo-500 text-white text-xs font-semibold px-4 py-2 rounded-lg hover:bg-indigo-600 transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isRegenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  {isRegenerating ? 'Generating...' : 'Regenerate'}
                </button>
                <button
                  onClick={() => { setRegenerateOpen(false); setRegenerateNotes('') }}
                  className="text-gray-400 text-xs px-3 py-2 rounded-lg hover:text-gray-600 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bottom 2-Column Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Version History & Comments */}
        <div className="lg:col-span-2 space-y-6">
          {/* Version History */}
          <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 relative z-20 overflow-visible">
            <CardContent className="p-5">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 font-heading">Version History</h3>
              {versionsLoading ? (
                <div className="text-center py-4">
                  <div className="w-5 h-5 border-[2px] border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
                </div>
              ) : (
                <div className="space-y-2.5">
                  {versions.map((v) => (
                    <div
                      key={v.id}
                      onMouseEnter={() => setHoveredVersion(v)}
                      onMouseLeave={() => setHoveredVersion(null)}
                      className={`relative flex items-center gap-3 p-3 rounded-xl transition ${hoveredVersion?.id === v.id ? 'z-30' : 'z-10'} ${v.approved && v.type === 'ai_optimized' ? 'bg-emerald-50/50 dark:bg-emerald-500/5 border border-emerald-100 dark:border-emerald-500/15' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'}`}
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${v.type === 'ai_optimized' ? 'bg-emerald-100 dark:bg-emerald-500/20' : v.type === 'rolled_back' ? 'bg-amber-100 dark:bg-amber-500/20' : 'bg-gray-100 dark:bg-gray-800'}`}>
                        {v.type === 'ai_optimized' ? <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> :
                         v.type === 'rolled_back' ? <RotateCcw className="w-4 h-4 text-amber-600 dark:text-amber-400" /> :
                         <Clock className="w-4 h-4 text-gray-400" />}
                      </div>
                      <div className="flex-1">
                        <p className="text-xs text-gray-900 dark:text-white font-semibold">
                          {v.type === 'ai_optimized' ? 'AI Optimized' : v.type === 'rolled_back' ? 'Rolled Back' : 'Original Upload'}
                        </p>
                        <p className="text-xs text-gray-400">{formatDate(v.createdAt)} &middot; {v.approved ? 'Approved' : v.note || 'Pending'}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {v.seo && (
                          <button
                            onClick={() => setSelectedVersionForModal(v)}
                            className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/20 hover:text-indigo-600 dark:hover:text-indigo-400 px-2.5 py-1 rounded-lg font-medium transition flex items-center gap-1"
                          >
                            <Eye className="w-3.5 h-3.5" /> View
                          </button>
                        )}
                        <button
                          onClick={() => handleRollback(v.id)}
                          className="text-xs text-indigo-500 hover:text-indigo-600 font-medium flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition"
                        >
                          <RotateCcw className="w-3 h-3" /> Rollback
                        </button>
                      </div>
                    </div>
                  ))}
                  {versions.length === 0 && (
                    <p className="text-xs text-gray-400 italic">No version history</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Comments Section */}
          <CommentsSection
            videoId={video.id}
            youtubeId={video.youtubeId}
            initialAutoReplyEnabled={video.autoReplyEnabled}
          />
        </div>

        {/* Right Column: Video Info & Engagement */}
        <div className="space-y-6">
          {/* Video Info */}
          <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
            <CardContent className="p-5">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 font-heading">Video Info</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center"><span className="text-xs text-gray-400">Privacy</span><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                  video.privacyStatus === 'public' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400' :
                  video.privacyStatus === 'unlisted' ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400' :
                  'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400'
                }`}>{video.privacyStatus || 'unknown'}</span></div>
                <div className="flex justify-between items-center"><span className="text-xs text-gray-400">Language</span><span className="text-xs font-medium text-gray-900 dark:text-white">{video.defaultLanguage || 'en-US'}</span></div>
                <div className="flex justify-between items-center"><span className="text-xs text-gray-400">Audio Language</span><span className="text-xs font-medium text-gray-900 dark:text-white">{video.defaultAudioLanguage || 'en-US'}</span></div>
                <div className="flex justify-between items-center"><span className="text-xs text-gray-400">License</span><span className="text-xs font-medium text-gray-900 dark:text-white">{video.license === 'creativeCommon' ? 'Creative Commons' : 'YouTube Standard'}</span></div>
                <div className="flex justify-between items-center"><span className="text-xs text-gray-400">Embeddable</span><span className="text-xs font-medium text-gray-900 dark:text-white">{video.embeddable !== false ? 'Yes' : 'No'}</span></div>
                <div className="flex justify-between items-center"><span className="text-xs text-gray-400">Public Stats</span><span className="text-xs font-medium text-gray-900 dark:text-white">{video.publicStatsViewable !== false ? 'Visible' : 'Hidden'}</span></div>
                <div className="flex justify-between items-center"><span className="text-xs text-gray-400">Projection</span><span className="text-xs font-medium text-gray-900 dark:text-white">{video.projection === '360' ? '360°' : 'Standard'}</span></div>
                <div className="flex justify-between items-center"><span className="text-xs text-gray-400">Live Status</span><span className="text-xs font-medium text-gray-900 dark:text-white">{video.liveBroadcastContent === 'none' || !video.liveBroadcastContent ? 'VOD' : video.liveBroadcastContent}</span></div>
              </div>
            </CardContent>
          </Card>

          {/* Engagement */}
          <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
            <CardContent className="p-5">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 font-heading">Engagement</h3>
              <div className="space-y-3.5">
                <div className="flex justify-between items-center"><span className="text-xs text-gray-400">Like Ratio</span><span className="text-sm font-semibold text-gray-900 dark:text-white">{video.viewCount > 0 ? `${((video.likeCount / video.viewCount) * 100).toFixed(1)}%` : '8.9%'}</span></div>
                <div className="flex justify-between items-center"><span className="text-xs text-gray-400">Comment Ratio</span><span className="text-sm font-semibold text-gray-900 dark:text-white">{video.viewCount > 0 ? `${((video.commentCount / video.viewCount) * 100).toFixed(1)}%` : '3.2%'}</span></div>
                <div className="flex justify-between items-center"><span className="text-xs text-gray-400">Likes</span><span className="text-sm font-semibold text-gray-900 dark:text-white">{formatNumber(video.likeCount)}</span></div>
                <div className="flex justify-between items-center"><span className="text-xs text-gray-400">Comments</span><span className="text-sm font-semibold text-gray-900 dark:text-white">{formatNumber(video.commentCount)}</span></div>
              </div>
            </CardContent>
          </Card>

          {video.aiScore && (
            <Card className="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800">
              <CardContent className="p-5">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 font-heading">AI Score</h3>
                <div className="text-center">
                  <div className={`w-16 h-16 rounded-full border-[3px] flex items-center justify-center mx-auto mb-2 ${video.aiScore >= 8.5 ? 'border-emerald-400' : video.aiScore >= 7 ? 'border-amber-400' : 'border-gray-300'}`}>
                    <span className={`text-xl font-bold ${video.aiScore >= 8.5 ? 'text-emerald-600 dark:text-emerald-400' : video.aiScore >= 7 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500'}`}>{video.aiScore}</span>
                  </div>
                  <Badge variant={video.aiScore >= 8.5 ? 'green' : video.aiScore >= 7 ? 'yellow' : 'gray'}>
                    {video.aiScore >= 8.5 ? 'GREENLIGHT' : video.aiScore >= 7 ? 'HOLD' : 'PASS'}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Version Details Modal */}
      {selectedVersionForModal && selectedVersionForModal.seo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50">
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${selectedVersionForModal.type === 'ai_optimized' ? 'bg-emerald-100 dark:bg-emerald-500/20' : selectedVersionForModal.type === 'rolled_back' ? 'bg-amber-100 dark:bg-amber-500/20' : 'bg-gray-100 dark:bg-gray-800'}`}>
                  {selectedVersionForModal.type === 'ai_optimized' ? <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> : selectedVersionForModal.type === 'rolled_back' ? <RotateCcw className="w-4 h-4 text-amber-600 dark:text-amber-400" /> : <Clock className="w-4 h-4 text-gray-400" />}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                    {selectedVersionForModal.type === 'ai_optimized' ? 'AI Optimized Version' : selectedVersionForModal.type === 'rolled_back' ? 'Rolled Back Version' : 'Original Upload Version'}
                  </h3>
                  <p className="text-[10px] text-gray-400 font-mono">{formatDate(selectedVersionForModal.createdAt)}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedVersionForModal(null)}
                className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 custom-scrollbar">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Title</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(selectedVersionForModal.seo.title)
                      toast.success('Title copied!')
                    }}
                    className="text-[11px] text-indigo-500 hover:text-indigo-600 font-medium flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" /> Copy
                  </button>
                </div>
                <p className="text-sm font-semibold text-gray-900 dark:text-white leading-snug p-3.5 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-800">
                  {selectedVersionForModal.seo.title}
                </p>
              </div>

              {selectedVersionForModal.seo.description && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Description</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(selectedVersionForModal.seo.description)
                        toast.success('Description copied!')
                      }}
                      className="text-[11px] text-indigo-500 hover:text-indigo-600 font-medium flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3" /> Copy
                    </button>
                  </div>
                  <div className="p-3.5 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-800 max-h-56 overflow-y-auto custom-scrollbar">
                    <FormattedDescription text={selectedVersionForModal.seo.description} className="text-xs text-gray-700 dark:text-gray-300" />
                  </div>
                </div>
              )}

              {selectedVersionForModal.seo.tags && selectedVersionForModal.seo.tags.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                      Tags ({selectedVersionForModal.seo.tags.length})
                    </span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(selectedVersionForModal.seo.tags.join(', '))
                        toast.success('Tags copied!')
                      }}
                      className="text-[11px] text-indigo-500 hover:text-indigo-600 font-medium flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3" /> Copy All
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 p-3.5 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-800 max-h-48 overflow-y-auto custom-scrollbar">
                    {selectedVersionForModal.seo.tags.map((t, idx) => (
                      <span key={idx} className="text-xs font-medium bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 px-2.5 py-1 rounded-lg border border-indigo-100 dark:border-indigo-500/20">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50 flex justify-end gap-2">
              <button
                onClick={() => {
                  const vId = selectedVersionForModal.id
                  setSelectedVersionForModal(null)
                  handleRollback(vId)
                }}
                className="text-xs bg-indigo-500 text-white font-semibold px-4 py-2 rounded-xl hover:bg-indigo-600 transition flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Restore This Version
              </button>
              <button
                onClick={() => setSelectedVersionForModal(null)}
                className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 px-3 py-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
