'use client'

import { useState } from 'react'
import { ThumbsUp, MessageSquare, Reply } from 'lucide-react'
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
    <div className={cn('group', isReply ? 'ml-8 mt-2' : '')}>
      <div className="flex items-start gap-2.5">
        {/* Avatar */}
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-600 flex items-center justify-center shrink-0">
          {authorAvatar ? (
            <img src={authorAvatar} alt={authorName} className="w-8 h-8 rounded-full object-cover" />
          ) : (
            <span className="text-[10px] font-bold text-gray-600 dark:text-gray-300">{initials}</span>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-900 dark:text-white">{authorName}</span>
            <span className="text-[10px] text-gray-400">{formatDate(publishedAt)}</span>
          </div>

          <p
            className="text-xs text-gray-700 dark:text-gray-300 mt-0.5 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(text, { ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'br'], ALLOWED_ATTR: ['href', 'target'] }) }}
          />

          {/* Actions */}
          <div className="flex items-center gap-3 mt-1.5">
            <button className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-indigo-500 transition">
              <ThumbsUp className="w-3 h-3" />
              {likeCount > 0 && <span>{likeCount}</span>}
            </button>

            {!isReply && (
              <button
                onClick={() => setShowReplyForm(!showReplyForm)}
                className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-indigo-500 transition"
              >
                <Reply className="w-3 h-3" />
                Reply
              </button>
            )}

            {!isReply && replyCount > 0 && (
              <button
                onClick={() => setShowReplies(!showReplies)}
                className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-indigo-500 transition"
              >
                <MessageSquare className="w-3 h-3" />
                {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
              </button>
            )}
          </div>

          {/* Reply Form */}
          {showReplyForm && (
            <CommentReplyForm
              videoId={videoId}
              commentId={id}
              commentText={text}
              onClose={() => setShowReplyForm(false)}
            />
          )}
        </div>
      </div>

      {/* Nested Replies */}
      {showReplies && replies.length > 0 && (
        <div className="ml-8 mt-1 space-y-1">
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
            />
          ))}
        </div>
      )}
    </div>
  )
}
