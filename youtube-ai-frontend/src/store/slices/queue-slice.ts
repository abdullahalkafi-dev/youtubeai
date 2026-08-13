import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import type { QueueItem, QueueStats } from '@/types/queue'
import api from '@/lib/api'
import { toast } from 'sonner'

interface QueueState {
  items: QueueItem[]
  stats: QueueStats | null
  loading: boolean
}

const initialState: QueueState = {
  items: [],
  stats: null,
  loading: false,
}

export const fetchQueueItems = createAsyncThunk(
  'queue/fetchItems',
  async (channelId: string) => {
    return await api.getQueueItems(channelId)
  },
)

export const fetchQueueStats = createAsyncThunk(
  'queue/fetchStats',
  async (channelId: string) => {
    return await api.getQueueStats(channelId)
  },
)

export const addToQueue = createAsyncThunk(
  'queue/add',
  async ({ channelId, videoId, videoTitle }: { channelId: string; videoId: string; videoTitle: string }, { rejectWithValue }) => {
    const result = await api.addToQueue(channelId, videoId, videoTitle)
    if (result.queued === false) {
      toast.error(result.message || 'Daily cap reached. Queue paused.')
      return rejectWithValue(result.message || 'Daily cap reached')
    }
    return result
  },
)

export const removeFromQueueAsync = createAsyncThunk(
  'queue/remove',
  async (id: string) => {
    await api.removeFromQueue(id)
    return id
  },
)

export const toggleQueueAsync = createAsyncThunk(
  'queue/toggle',
  async (channelId: string) => {
    return await api.toggleQueue(channelId)
  },
)

const queueSlice = createSlice({
  name: 'queue',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchQueueItems.pending, (state) => { state.loading = true })
      .addCase(fetchQueueItems.fulfilled, (state, action) => {
        state.loading = false
        state.items = action.payload
      })
      .addCase(fetchQueueItems.rejected, (state) => { state.loading = false })
      .addCase(fetchQueueStats.fulfilled, (state, action) => {
        state.stats = action.payload
      })
      .addCase(addToQueue.fulfilled, (state, action) => {
        const payload = action.payload as any
        const item = payload?.item || payload
        if (item && item.id) {
          state.items.unshift(item)
          toast.success('Added to queue')
        }
      })
      .addCase(removeFromQueueAsync.fulfilled, (state, action) => {
        state.items = state.items.filter(i => i.id !== action.payload)
        toast.success('Removed from queue')
      })
      .addCase(toggleQueueAsync.fulfilled, (state, action) => {
        if (state.stats) {
          state.stats.isActive = action.payload.isActive
        }
        toast.success(action.payload.isActive ? 'Queue resumed' : 'Queue paused')
      })
  },
})

export default queueSlice.reducer
