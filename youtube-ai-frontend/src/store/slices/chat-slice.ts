import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'
import type { Thread, ThreadListItem, Message, ThreadCategory } from '@/types/chat'
import api from '@/lib/api'

interface ChatState {
  threads: ThreadListItem[]
  activeThreadId: string | null
  activeThread: Thread | null
  loading: boolean
  sending: boolean
  streamingContent: string
  error: string | null
  selectedSkill: ThreadCategory | null
  isDraftThread: boolean
}

const initialState: ChatState = {
  threads: [],
  activeThreadId: null,
  activeThread: null,
  loading: false,
  sending: false,
  streamingContent: '',
  error: null,
  selectedSkill: null,
  isDraftThread: false,
}

export const fetchThreads = createAsyncThunk(
  'chat/fetchThreads',
  async (channelId: string) => {
    return await api.getThreads(channelId)
  },
)

export const createThread = createAsyncThunk(
  'chat/createThread',
  async (params: { channelId: string; title?: string; type: string; videoId?: string }) => {
    return await api.createThread(params.channelId, {
      title: params.title,
      type: params.type,
      videoId: params.videoId,
    })
  },
)

export const selectThread = createAsyncThunk(
  'chat/selectThread',
  async (threadId: string) => {
    return await api.getThread(threadId)
  },
)

export const renameThread = createAsyncThunk(
  'chat/renameThread',
  async (params: { threadId: string; title: string }) => {
    return await api.renameThread(params.threadId, params.title)
  },
)

export const archiveThread = createAsyncThunk<string, string>(
  'chat/archiveThread',
  async (id: string) => {
    await api.archiveThread(id)
    return id
  },
)

export const deleteThread = createAsyncThunk<string, string>(
  'chat/deleteThread',
  async (threadId: string) => {
    await api.deleteThread(threadId)
    return threadId
  },
)

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    setActiveThread(state, action: PayloadAction<string | null>) {
      state.activeThreadId = action.payload
      state.streamingContent = ''
      state.sending = false
      if (action.payload === null) {
        state.activeThread = null
      }
    },
    clearError(state) {
      state.error = null
    },
    setSelectedSkill(state, action: PayloadAction<ThreadCategory | null>) {
      state.selectedSkill = action.payload
    },
    enterDraftMode(state) {
      state.isDraftThread = true
      state.activeThreadId = null
      state.activeThread = {
        id: 'draft_' + Date.now(),
        channelId: '',
        type: 'standalone',
        title: 'New Thread',
        status: 'active',
        messages: [],
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalCachedTokens: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      state.streamingContent = ''
      state.sending = false
    },
    optimisticAddUserMessage(state, action: PayloadAction<{ threadId: string; content: string }>) {
      if (state.activeThread?.id === action.payload.threadId) {
        state.activeThread.messages.push({
          id: `temp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          threadId: action.payload.threadId,
          role: 'user' as const,
          content: action.payload.content,
          createdAt: new Date().toISOString(),
        })
        state.sending = true
      }
    },
    appendStreamChunk(state, action: PayloadAction<string>) {
      state.streamingContent += action.payload
    },
    clearStreaming(state) {
      state.streamingContent = ''
      state.sending = false
    },
    removeLastUserMessage(state) {
      if (state.activeThread && state.activeThread.messages.length > 0) {
        const lastMsg = state.activeThread.messages[state.activeThread.messages.length - 1]
        if (lastMsg.role === 'user' && lastMsg.id.startsWith('temp_')) {
          state.activeThread.messages.pop()
        }
      }
    },
    finalizeStreamedMessage(state, action: PayloadAction<{ content: string; messageId?: string; category?: string; title?: string }>) {
      if (state.activeThread) {
        state.activeThread.messages.push({
          id: action.payload.messageId || `streamed_${Date.now()}`,
          threadId: state.activeThreadId || '',
          role: 'assistant' as const,
          content: action.payload.content,
          createdAt: new Date().toISOString(),
          metadata: action.payload.category ? { category: action.payload.category } : undefined,
        })
        if (action.payload.title && action.payload.title !== 'New Thread') {
          state.activeThread.title = action.payload.title
          const idx = state.threads.findIndex(t => t.id === state.activeThreadId)
          if (idx !== -1) state.threads[idx].title = action.payload.title
        }
      }
      state.streamingContent = ''
      state.sending = false
    },
    updateThreadTitle(state, action: PayloadAction<{ threadId: string; title: string }>) {
      const { threadId, title } = action.payload
      if (state.activeThread?.id === threadId) {
        state.activeThread.title = title
      }
      const idx = state.threads.findIndex(t => t.id === threadId)
      if (idx !== -1) {
        state.threads[idx].title = title
      }
    },
    updateMessageScriptId(state, action: PayloadAction<{ messageId: string; scriptId: string }>) {
      if (state.activeThread?.messages) {
        const msg = state.activeThread.messages.find(
          (m) => m.id === action.payload.messageId || m._id === action.payload.messageId
        )
        if (msg) {
          if (!msg.metadata) msg.metadata = {}
          msg.metadata.scriptId = action.payload.scriptId
        }
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchThreads.pending, (state) => { state.loading = true })
      .addCase(fetchThreads.fulfilled, (state, action) => {
        state.loading = false
        state.threads = action.payload
      })
      .addCase(fetchThreads.rejected, (state) => {
        state.loading = false
      })
      .addCase(createThread.fulfilled, (state, action) => {
        const thread = action.payload
        state.threads.unshift({
          id: thread.id,
          channelId: thread.channelId,
          type: thread.type,
          title: thread.title,
          status: thread.status,
          videoId: thread.videoId,
          videoTitle: thread.videoTitle,
          videoThumbnail: thread.videoThumbnail,
          totalPromptTokens: thread.totalPromptTokens,
          totalCompletionTokens: thread.totalCompletionTokens,
          totalCachedTokens: thread.totalCachedTokens,
          messageCount: thread.messages?.length || 0,
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
        })
        state.activeThreadId = thread.id
        state.activeThread = thread
        state.isDraftThread = false
      })
      .addCase(selectThread.pending, (state) => { state.loading = true })
      .addCase(selectThread.fulfilled, (state, action) => {
        state.loading = false
        state.sending = false
        state.streamingContent = ''
        state.activeThread = action.payload
        state.activeThreadId = action.payload.id
      })
      .addCase(selectThread.rejected, (state, action) => {
        state.loading = false
        const failedId = action.meta?.arg
        if (failedId && state.activeThreadId === failedId) {
          state.threads = state.threads.filter((t) => t.id !== failedId)
          state.activeThreadId = state.threads[0]?.id || null
          state.activeThread = null
        }
      })
      .addCase(renameThread.fulfilled, (state, action) => {
        const updated = action.payload
        const idx = state.threads.findIndex(t => t.id === updated.id)
        if (idx !== -1) state.threads[idx].title = updated.title
        if (state.activeThread?.id === updated.id) {
          state.activeThread.title = updated.title
        }
      })
      .addCase(archiveThread.fulfilled, (state, action) => {
        state.threads = state.threads.filter(t => t.id !== action.payload)
        if (state.activeThreadId === action.payload) {
          if (state.threads.length > 0) {
            state.activeThreadId = state.threads[0].id
            state.activeThread = null
          } else {
            state.activeThreadId = null
            state.activeThread = null
          }
        }
      })
      .addCase(deleteThread.fulfilled, (state, action) => {
        state.threads = state.threads.filter(t => t.id !== action.payload)
        if (state.activeThreadId === action.payload) {
          if (state.threads.length > 0) {
            state.activeThreadId = state.threads[0].id
            state.activeThread = null
          } else {
            state.activeThreadId = null
            state.activeThread = null
          }
        }
      })
  },
})

export const {
  setActiveThread,
  clearError,
  setSelectedSkill,
  enterDraftMode,
  optimisticAddUserMessage,
  appendStreamChunk,
  clearStreaming,
  removeLastUserMessage,
  finalizeStreamedMessage,
  updateThreadTitle,
  updateMessageScriptId,
} = chatSlice.actions

export default chatSlice.reducer
