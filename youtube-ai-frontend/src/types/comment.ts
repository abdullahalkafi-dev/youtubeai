export interface Comment {
  id: string
  youtubeCommentId: string
  parentId: string | null
  authorName: string
  authorAvatar: string | null
  text: string
  likeCount: number
  replyCount: number
  publishedAt: string
}

export interface CommentThread {
  id: string
  authorName: string
  authorAvatar: string | null
  text: string
  likeCount: number
  replyCount: number
  publishedAt: string
  updatedAt: string
  replies: Comment[]
}

export interface CommentsResponse {
  comments: CommentThread[]
  nextPageToken?: string | null
  totalCount: number
  commentsDisabled: boolean
  demoMode?: boolean
}
