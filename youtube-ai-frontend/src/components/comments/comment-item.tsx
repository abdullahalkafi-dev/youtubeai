'use client'

import { useState } from 'react'
import { ThumbsUp, MessageSquare, Reply, Sparkles, CheckCircle2, Clock } from 'lucide-react'
import { CommentReplyForm } from './comment-reply-form'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/utils'
import DOMPurify from 'dompurify'
import type { Comment } from '@/types/comment'

interface CommentItemProps {
  id: string
  authorName: string
  authorAvatar: string | null
  text: string
  likeCount: number
  replyCount: number
  publishedAt: string
  replies: Comment[]
  videoId: string
  isReply?: boolean
  hasCreatorReplied?: boolean
  isCreatorReply?: boolean
}

export function CommentItem({
  id,
  authorName,
  authorAvatar,
  text,
  likeCount,
  replyCount,
  publishedAt,
  replies,
  videoId,
  isReply = false,
  hasCreatorReplied = false,
  isCreatorReply = false,
}: CommentItemProps) {
  const [showReplyForm, setShowReplyForm] = useState(false)
  const [showReplies, setShowReplies] = useState(false)

  const initials = authorName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div
      className={cn(
        'group p-3 rounded-xl transition border',
        isReply
          ? 'ml-8 mt-2 bg-gray-50/70 dark:bg-gray-800/40 border-gray-150 dark:border-gray-800/80'
          : hasCreatorReplied
          ? 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700'
          : 'bg-amber-50/20 dark:bg-amber-950/10 border-amber-200/50 dark:border-amber-900/30 hover:border-amber-300 dark:hover:border-amber-800',
      )}
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center shrink-0 overflow-hidden">
          {authorAvatar ? (
            <img src={authorAvatar} alt={authorName} className="w-8 h-8 rounded-full object-cover" />
          ) : (
            <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-300">{initials}</span>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-900 dark:text-white flex items-center gap-1.5">
                {authorName}
                {isCreatorReply && (
                  <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-600 text-white shadow-xs">
                    Creator
                  </span>
                )}
              </span>
              <span className="text-[10px] text-gray-400">{formatDate(publishedAt)}</span>
            </div>

            {/* Responded vs Unresponded Status Badge for Top-level comments */}
            {!isReply && (
              <div>
                {hasCreatorReplied ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                    <CheckCircle2 className="w-3 h-3" />
                    Replied
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    <Clock className="w-3 h-3" />
                    Unresponded
                  </span>
                )}
              </div>
            )}
          </div>

          <p
            className="text-xs text-gray-700 dark:text-gray-200 mt-1 leading-relaxed"
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(text, {
                ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'br'],
                ALLOWED_ATTR: ['href', 'target'],
              }),
            }}
          />

          {/* Action Bar */}
          <div className="flex items-center gap-3 mt-2.5">
            <span
              className="flex items-center gap-1 text-[11px] text-gray-400 select-none cursor-default"
              title={likeCount > 0 ? `${likeCount} ${likeCount === 1 ? 'like' : 'likes'} on YouTube` : '0 likes on YouTube'}
            >
              <ThumbsUp className="w-3 h-3 text-gray-400" />
              {likeCount > 0 && <span>{likeCount}</span>}
            </span>

            {!isReply && (
              <button
                onClick={() => setShowReplyForm(!showReplyForm)}
                className="flex items-center gap-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition px-2 py-0.5 rounded-md hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
              >
                <Sparkles className="w-3 h-3" />
                {showReplyForm ? 'Close AI Reply' : 'AI Reply'}
              </button>
            )}

            {!isReply && (
              <button
                onClick={() => setShowReplyForm(!showReplyForm)}
                className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition"
              >
                <Reply className="w-3 h-3" />
                Reply
              </button>
            )}

            {!isReply && replyCount > 0 && (
              <button
                onClick={() => setShowReplies(!showReplies)}
                className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-indigo-500 transition font-medium"
              >
                <MessageSquare className="w-3 h-3" />
                {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
              </button>
            )}
          </div>

          {/* Reply Form with 5-Tone Generator */}
          {showReplyForm && (
            <CommentReplyForm
              videoId={videoId}
              commentId={id}
              commentText={text}
              onClose={() => setShowReplyForm(false)}
              autoGenerate={true}
            />
          )}
        </div>
      </div>

      {/* Nested Replies */}
      {showReplies && replies.length > 0 && (
        <div className="space-y-1.5 mt-2">
          {replies.map((reply) => (
            <CommentItem
              key={reply.id}
              id={reply.id}
              authorName={reply.authorName}
              authorAvatar={reply.authorAvatar}
              text={reply.text}
              likeCount={reply.likeCount}
              replyCount={0}
              publishedAt={reply.publishedAt}
              replies={[]}
              videoId={videoId}
              isReply
              isCreatorReply={reply.isCreatorReply}
            />
          ))}
        </div>
      )}
    </div>
  )
}
