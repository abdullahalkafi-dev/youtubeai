'use client'

import { useState, useEffect } from 'react'
import { useAppSelector, useAppDispatch } from '@/store/hooks'
import { fetchVideos } from '@/store/slices/videos-slice'
import { fetchSeoSuggestions, generateSeo, approveSeoAsync, rejectSeoAsync } from '@/store/slices/seo-slice'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Copy, Check, Sparkles, Video, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { showApiErrorToast } from '@/lib/error-handler'
import { formatDate } from '@/lib/utils'
import type { Video as VideoType } from '@/types/video'

export default function SeoPage() {
  const dispatch = useAppDispatch()
  const channelId = useAppSelector(s => s.auth.activeChannelId)
  const { items: videos } = useAppSelector(s => s.videos)
  const { suggestions, generating } = useAppSelector(s => s.seo)

  const [selectedVideoId, setSelectedVideoId] = useState<string>('')
  const [showType, setShowType] = useState('')
  const [keywords, setKeywords] = useState('')
  const [notes, setNotes] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [videoDropdownOpen, setVideoDropdownOpen] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editTags, setEditTags] = useState<string[]>([])
  const [isEditing, setIsEditing] = useState(false)

  useEffect(() => {
    if (channelId) {
      dispatch(fetchVideos({ channelId, limit: 100 }))
      dispatch(fetchSeoSuggestions(channelId))
    }
  }, [channelId, dispatch])

  const selectedVideo = videos.find(v => v.id === selectedVideoId)
  const latestSuggestion = selectedVideoId
    ? suggestions.find(s => {
        const sVideoId = typeof s.videoId === 'object' && s.videoId !== null
          ? (s.videoId as any).id || (s.videoId as any)._id
          : s.videoId
        return sVideoId === selectedVideoId
      })
    : suggestions[0]

  // Sync edit fields when suggestion changes
  useEffect(() => {
    if (latestSuggestion) {
      setEditTitle(latestSuggestion.title)
      setEditDescription(latestSuggestion.description)
      setEditTags([...latestSuggestion.tags])
      setIsEditing(false)
    }
  }, [latestSuggestion?.id])

  const handleGenerate = () => {
    if (!selectedVideoId) {
      toast.error("Please select a video first")
      return
    }
    const parts = [keywords, notes, showType ? `Show type: ${showType}` : ''].filter(Boolean)
    const customInstructions = parts.join('. ')
    dispatch(generateSeo({ videoId: selectedVideoId, customInstructions: customInstructions || undefined }))
  }

  const handleApprove = (id: string) => {
    dispatch(approveSeoAsync(id))
      .unwrap()
      .then(() => toast.success("SEO approved!"))
      .catch((err) => showApiErrorToast(err, "Failed to approve SEO"))
  }

  const handleReject = (id: string) => {
    dispatch(rejectSeoAsync(id))
      .unwrap()
      .then(() => toast.success("SEO rejected"))
      .catch((err) => showApiErrorToast(err, "Failed to reject SEO"))
  }

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text)
    setCopied(field)
    setTimeout(() => setCopied(null), 2000)
  }

  const handleCopyAllTags = (tags: string[]) => {
    navigator.clipboard.writeText(tags.join(', '))
    setCopied('tags')
    setTimeout(() => setCopied(null), 2000)
    toast.success("All tags copied!")
  }

  return (
    <div className="p-4 lg:p-6 2xl:p-8 max-w-[1600px] mx-auto">
      <div className="mb-6">
        <h1 className="text-xl lg:text-2xl font-bold text-gray-900 dark:text-white font-heading">AI SEO Engine</h1>
        <p className="text-sm lg:text-base text-gray-400 mt-0.5">Generate optimized titles, descriptions, tags</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-6">
        {/* Input Panel */}
        <Card>
          <CardContent className="p-5 lg:p-6">
            <h3 className="text-sm lg:text-base font-semibold text-gray-900 dark:text-white mb-4 font-heading">Input</h3>
            <div className="space-y-4">
              {/* Video Selector */}
              <div>
                <label className="text-xs text-gray-500 font-medium block mb-1.5">Select Video</label>
                <div className="relative">
                  <button
                    onClick={() => setVideoDropdownOpen(!videoDropdownOpen)}
                    className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl py-2.5 px-3.5 text-sm text-left flex items-center justify-between"
                  >
                    <span className={selectedVideo ? 'text-gray-900 dark:text-white' : 'text-gray-400'}>
                      {selectedVideo ? selectedVideo.title.slice(0, 50) + (selectedVideo.title.length > 50 ? '...' : '') : 'Choose a video...'}
                    </span>
                    <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                  </button>
                  {videoDropdownOpen && (
                    <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                      {videos.map((v) => (
                        <button
                          key={v.id}
                          onClick={() => { setSelectedVideoId(v.id); setVideoDropdownOpen(false) }}
                          className="w-full text-left px-3.5 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                        >
                          <Video className="w-4 h-4 text-gray-400 shrink-0" />
                          <span className="text-gray-900 dark:text-white truncate">{v.title}</span>
                        </button>
                      ))}
                      {videos.length === 0 && (
                        <p className="px-3.5 py-2.5 text-sm text-gray-400">No videos found. Sync your channel first.</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500 font-medium block mb-1.5">Show Type</label>
                <select
                  value={showType}
                  onChange={(e) => setShowType(e.target.value)}
                  className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl py-2.5 px-3.5 text-sm text-gray-500"
                >
                  <option value="">Select...</option>
                  <option value="first_night_inside">First Night Inside</option>
                  <option value="federal_pressure">Federal Pressure Report</option>
                  <option value="street_code_autopsy">Street Code Autopsy</option>
                  <option value="courtroom_reality">Courtroom Reality Check</option>
                  <option value="mothers_sentenced">Mothers Got Sentenced Too</option>
                  <option value="prison_psychology">Prison Psychology</option>
                  <option value="smart_man_trap">The Smart Man Trap</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-gray-500 font-medium block mb-1.5">Target Keywords <span className="text-gray-400">(optional)</span></label>
                <Input
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="e.g. prison, inmate, federal holding, texas..."
                  className="bg-gray-50 dark:bg-gray-800 text-sm py-2.5"
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 font-medium block mb-1.5">Additional Context <span className="text-gray-400">(optional)</span></label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any extra context: target audience, video highlights, specific angle to emphasize..."
                  rows={3}
                  className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl py-2.5 px-3.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>

              <button
                onClick={handleGenerate}
                disabled={generating || !selectedVideoId}
                className="w-full bg-gradient-to-r from-indigo-500 to-indigo-600 text-white font-semibold text-sm py-3 rounded-xl hover:from-indigo-600 hover:to-indigo-700 transition shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generating ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />Generate SEO
                  </>
                )}
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Output Panel */}
        <Card>
          <CardContent className="p-5 lg:p-6">
            <h3 className="text-sm lg:text-base font-semibold text-gray-900 dark:text-white mb-4 font-heading">Output</h3>
            {latestSuggestion ? (
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs text-gray-500 font-medium">Title</label>
                    <button onClick={() => handleCopy(editTitle, 'title')} className="text-xs text-indigo-500 hover:text-indigo-600 font-medium flex items-center gap-1">
                      {copied === 'title' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}Copy
                    </button>
                  </div>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => { setEditTitle(e.target.value); setIsEditing(true) }}
                    className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3.5 text-sm lg:text-base text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs text-gray-500 font-medium">Description</label>
                    <button onClick={() => handleCopy(editDescription, 'desc')} className="text-xs text-indigo-500 hover:text-indigo-600 font-medium flex items-center gap-1">
                      {copied === 'desc' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}Copy
                    </button>
                  </div>
                  <textarea
                    value={editDescription}
                    onChange={(e) => { setEditDescription(e.target.value); setIsEditing(true) }}
                    rows={10}
                    className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3.5 text-xs lg:text-sm text-gray-900 dark:text-white resize-y min-h-[200px]"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs text-gray-500 font-medium">Tags</label>
                    <button onClick={() => handleCopyAllTags(editTags)} className="text-xs text-indigo-500 hover:text-indigo-600 font-medium flex items-center gap-1">
                      {copied === 'tags' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}Copy All
                    </button>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3.5">
                    <div className="flex flex-wrap gap-1.5">
                      {editTags.map((tag, i) => (
                        <span key={i} className="text-xs bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 px-2.5 py-1 rounded-full border border-indigo-200 dark:border-indigo-500/25 font-medium">{tag}</span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2.5">
                  {latestSuggestion.status === 'pending' ? (
                    <>
                      <button
                        onClick={() => handleApprove(latestSuggestion.id)}
                        className="flex-1 bg-emerald-500 text-white text-sm font-semibold py-2.5 rounded-lg hover:bg-emerald-600 transition shadow-sm shadow-emerald-500/20"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleReject(latestSuggestion.id)}
                        className="flex-1 bg-white dark:bg-gray-800 text-gray-500 text-sm py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:text-gray-700 dark:hover:text-gray-300 transition"
                      >
                        Reject
                      </button>
                    </>
                  ) : (
                    <Badge variant={latestSuggestion.status === 'approved' ? 'green' : 'red'}>
                      {latestSuggestion.status === 'approved' ? 'Approved' : 'Rejected'}
                    </Badge>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <Sparkles className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                <p className="text-sm text-gray-400">No SEO generated yet</p>
                <p className="text-xs text-gray-400 mt-1">Select a video and click Generate SEO</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Suggestion History */}
      {suggestions.length > 1 && (
        <Card className="mt-5">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 font-heading">Previous Suggestions</h3>
            <div className="space-y-2">
              {suggestions.slice(1).map((s) => (
                <div key={s.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-100 dark:border-gray-800">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-900 dark:text-white font-medium truncate">{s.title}</p>
                    <p className="text-xs text-gray-400">{formatDate(s.createdAt)}</p>
                  </div>
                  <Badge variant={s.status === 'approved' ? 'green' : s.status === 'rejected' ? 'red' : 'yellow'}>
                    {s.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
