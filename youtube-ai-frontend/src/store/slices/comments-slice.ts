import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import { api } from '@/lib/api'
import type { CommentThread, CommentsResponse } from '@/types/comment'

export type SortOrder = 'relevance' | 'time'

interface CommentsState {
  threads: CommentThread[]
  loading: boolean
  syncing: boolean
  replyLoading: string | null
  error: string | null
  commentsDisabled: boolean
  nextPageToken: string | null
  totalCount: number
  isDemoMode: boolean
  sortBy: SortOrder
}

const initialState: CommentsState = {
  threads: [],
  loading: false,
  syncing: false,
  replyLoading: null,
  error: null,
  commentsDisabled: false,
  nextPageToken: null,
  totalCount: 0,
  isDemoMode: false,
  sortBy: 'relevance',
}

export const fetchComments = createAsyncThunk(
  'comments/fetchComments',
  async ({ videoId, pageToken, order }: { videoId: string; pageToken?: string; order?: SortOrder }) => {
    return api.getComments(videoId, pageToken, order)
  },
)

export const fetchReplies = createAsyncThunk(
  'comments/fetchReplies',
  async ({ videoId, commentId }: { videoId: string; commentId: string }) => {
    return api.getCommentReplies(videoId, commentId)
  },
)

export const syncComments = createAsyncThunk(
  'comments/syncComments',
  async ({ videoId, order }: { videoId: string; order?: SortOrder }) => {
    return api.syncComments(videoId, order)
  },
)

export const generateReply = createAsyncThunk(
  'comments/generateReply',
  async ({ videoId, commentId, commentText }: { videoId: string; commentId: string; commentText: string }) => {
    return api.generateReply(videoId, commentId, commentText)
  },
)

export const postReply = createAsyncThunk(
  'comments/postReply',
  async ({ videoId, parentId, text }: { videoId: string; parentId: string; text: string }) => {
    return api.postReply(videoId, parentId, text)
  },
)

const commentsSlice = createSlice({
  name: 'comments',
  initialState,
  reducers: {
    clearComments: (state) => {
      state.threads = []
      state.nextPageToken = null
      state.totalCount = 0
      state.commentsDisabled = false
      state.error = null
      state.isDemoMode = false
    },
    setSortBy: (state, action) => {
      state.sortBy = action.payload
      state.threads = []
      state.nextPageToken = null
      state.totalCount = 0
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchComments.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchComments.fulfilled, (state, action) => {
        state.loading = false
        const payload = action.payload as CommentsResponse & { demoMode?: boolean }

        if (payload.demoMode) {
          state.threads = []
          state.totalCount = 0
          state.commentsDisabled = false
          state.isDemoMode = true
        } else {
          state.isDemoMode = false
          state.commentsDisabled = payload.commentsDisabled
          if (action.meta.arg.pageToken) {
            state.threads = [...state.threads, ...payload.comments]
          } else {
            state.threads = payload.comments
          }
          state.totalCount = payload.totalCount
          state.nextPageToken = payload.nextPageToken || null
        }
      })
      .addCase(fetchComments.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message || 'Failed to load comments'
      })
      .addCase(syncComments.pending, (state) => {
        state.syncing = true
      })
      .addCase(syncComments.fulfilled, (state, action) => {
        state.syncing = false
        const payload = action.payload as CommentsResponse & { demoMode?: boolean }

        if (payload.demoMode) {
          state.threads = []
          state.totalCount = 0
          state.commentsDisabled = false
          state.isDemoMode = true
        } else {
          state.isDemoMode = false
          state.commentsDisabled = payload.commentsDisabled
          state.threads = payload.comments
          state.totalCount = payload.totalCount
          state.nextPageToken = payload.nextPageToken || null
        }
      })
      .addCase(syncComments.rejected, (state, action) => {
        state.syncing = false
        state.error = action.error.message || 'Failed to sync comments'
      })
      .addCase(generateReply.pending, (state, action) => {
        state.replyLoading = action.meta.arg.commentId
      })
      .addCase(generateReply.fulfilled, (state) => {
        state.replyLoading = null
      })
      .addCase(generateReply.rejected, (state) => {
        state.replyLoading = null
      })
      .addCase(postReply.fulfilled, (state, action) => {
        const { parentId, text } = action.meta.arg
        const payload = action.payload as { commentId?: string; authorName?: string; mock?: boolean }
        const thread = state.threads.find(t => t.id === parentId || t.replies.some(r => r.id === parentId))
        if (thread) {
          thread.replies.push({
            id: payload.commentId || `temp_${Date.now()}`,
            youtubeCommentId: '',
            parentId,
            authorName: payload.authorName || 'You',
            authorAvatar: null,
            text,
            likeCount: 0,
            replyCount: 0,
            publishedAt: new Date().toISOString(),
          })
          thread.replyCount++
        }
      })
  },
})

export const { clearComments, setSortBy } = commentsSlice.actions
export default commentsSlice.reducer
