import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'
import { api } from '@/lib/api'
import type { CommentThread, CommentsResponse, AiReplyOption } from '@/types/comment'

export type SortOrder = 'relevance' | 'time'
export type CommentFilterStatus = 'all' | 'unresponded' | 'responded'

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
  filterStatus: CommentFilterStatus
  searchQuery: string
  generatedReplies: Record<string, AiReplyOption[]>
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
  filterStatus: 'all',
  searchQuery: '',
  generatedReplies: {},
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

export const generateReplies = createAsyncThunk(
  'comments/generateReplies',
  async ({ videoId, commentId, commentText }: { videoId: string; commentId: string; commentText: string }) => {
    const data = await api.generateReplies(videoId, commentId, commentText)
    return { commentId, replies: data.replies }
  },
)

export const generateReply = createAsyncThunk(
  'comments/generateReply',
  async ({ videoId, commentId, commentText }: { videoId: string; commentId: string; commentText: string }) => {
    const data = await api.generateReply(videoId, commentId, commentText)
    return { commentId, reply: data.reply, replies: data.replies }
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
      state.generatedReplies = {}
    },
    setSortBy: (state, action: PayloadAction<SortOrder>) => {
      state.sortBy = action.payload
      state.threads = []
      state.nextPageToken = null
      state.totalCount = 0
    },
    setFilterStatus: (state, action: PayloadAction<CommentFilterStatus>) => {
      state.filterStatus = action.payload
    },
    setSearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload
    },
    setCommentReplies: (state, action: PayloadAction<{ commentId: string; replies: AiReplyOption[] }>) => {
      state.generatedReplies[action.payload.commentId] = action.payload.replies
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
      .addCase(generateReplies.pending, (state, action) => {
        state.replyLoading = action.meta.arg.commentId
      })
      .addCase(generateReplies.fulfilled, (state, action) => {
        state.replyLoading = null
        if (action.payload?.commentId && action.payload?.replies) {
          state.generatedReplies[action.payload.commentId] = action.payload.replies
        }
      })
      .addCase(generateReplies.rejected, (state) => {
        state.replyLoading = null
      })
      .addCase(generateReply.pending, (state, action) => {
        state.replyLoading = action.meta.arg.commentId
      })
      .addCase(generateReply.fulfilled, (state, action) => {
        state.replyLoading = null
        if (action.payload?.commentId && action.payload?.replies) {
          state.generatedReplies[action.payload.commentId] = action.payload.replies
        }
      })
      .addCase(generateReply.rejected, (state) => {
        state.replyLoading = null
      })
      .addCase(postReply.fulfilled, (state, action) => {
        const { parentId, text } = action.meta.arg
        const payload = action.payload as { commentId?: string; authorName?: string; mock?: boolean }
        const newId = payload.commentId || `temp_${Date.now()}`

        // Find thread if parentId is the top-level id OR a nested reply id
        const thread = state.threads.find(
          (t) => t.id === parentId || t.replies.some((r) => r.id === parentId),
        )
        if (!thread) return

        // Avoid duplicate optimistic rows if the same comment id already exists
        if (thread.replies.some((r) => r.id === newId)) return

        const parentReply = thread.replies.find((r) => r.id === parentId)
        thread.replies.push({
          id: newId,
          youtubeCommentId: payload.commentId || '',
          parentId,
          authorName: payload.authorName || 'You (Creator)',
          authorAvatar: null,
          text,
          likeCount: 0,
          replyCount: 0,
          publishedAt: new Date().toISOString(),
          isCreatorReply: true,
          replyingToName: parentReply?.authorName,
        })
        thread.replyCount = (thread.replyCount || 0) + 1
        thread.hasCreatorReplied = true
      })
  },
})

export const { clearComments, setSortBy, setFilterStatus, setSearchQuery, setCommentReplies } = commentsSlice.actions
export default commentsSlice.reducer
