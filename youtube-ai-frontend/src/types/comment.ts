export interface AiReplyOption {
  tone:
    | 'General'
    | 'Humorous'
    | 'Thankful'
    | 'Witty'
    | 'Informal'
    | 'Thoughtful and Balanced'
    | 'Sharp and Lighthearted'
    | 'Appreciative and Reflective'
    | 'Street-Wise and Provocative'
    | 'Curious and Challenging'
    | string
  text: string
  label: string
}

export interface Comment {
  id: string
  youtubeCommentId: string
  parentId: string | null
  authorName: string
  authorAvatar: string | null
  authorChannelId?: string
  text: string
  likeCount: number
  replyCount: number
  publishedAt: string
  isCreatorReply?: boolean
}

export interface CommentThread {
  id: string
  authorName: string
  authorAvatar: string | null
  authorChannelId?: string
  text: string
  likeCount: number
  replyCount: number
  publishedAt: string
  updatedAt: string
  hasCreatorReplied?: boolean
  replies: Comment[]
}

export interface CommentsResponse {
  comments: CommentThread[]
  nextPageToken?: string | null
  totalCount: number
  commentsDisabled: boolean
  demoMode?: boolean
}
