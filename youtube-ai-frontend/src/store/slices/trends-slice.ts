import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import { api } from '@/lib/api'
import type { TrendingTopic } from '@/types/trend'

interface TrendsState {
  topics: TrendingTopic[]
  loading: boolean
  refreshing: boolean
  error: string | null
  historyDays: number | null
}

const initialState: TrendsState = {
  topics: [],
  loading: false,
  refreshing: false,
  error: null,
  historyDays: null,
}

export const fetchTrends = createAsyncThunk(
  'trends/fetchTrends',
  async ({ channelId, days }: { channelId: string; days?: number }) => {
    return api.getTrends(channelId, days)
  },
)

export const refreshTrends = createAsyncThunk(
  'trends/refreshTrends',
  async ({ channelId, days }: { channelId: string; days?: number }) => {
    await api.refreshTrends(channelId)

    let status: { running: boolean; error?: string } = { running: true }
    let pollCount = 0
    const MAX_POLLS = 60 // 2 minutes max polling guard

    while (status.running) {
      if (pollCount >= MAX_POLLS) {
        throw new Error('Refresh timed out after 2 minutes. Please try again.')
      }
      await new Promise(r => setTimeout(r, 2000))
      status = await api.getRefreshStatus(channelId)
      pollCount++
    }

    if (status.error) throw new Error(status.error)

    return api.getTrends(channelId, days)
  },
)

export const seedThreadFromTrend = createAsyncThunk(
  'trends/seedThread',
  async ({ channelId, topicId }: { channelId: string; topicId: string }) => {
    return api.seedThreadFromTrend(channelId, topicId)
  },
)

const trendsSlice = createSlice({
  name: 'trends',
  initialState,
  reducers: {
    setHistoryDays: (state, action) => {
      state.historyDays = action.payload
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchTrends.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchTrends.fulfilled, (state, action) => {
        state.loading = false
        state.topics = action.payload as TrendingTopic[]
      })
      .addCase(fetchTrends.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message || 'Failed to load trends'
      })
      .addCase(refreshTrends.pending, (state) => {
        state.refreshing = true
        state.error = null
      })
      .addCase(refreshTrends.fulfilled, (state, action) => {
        state.refreshing = false
        state.topics = action.payload as TrendingTopic[]
      })
      .addCase(refreshTrends.rejected, (state, action) => {
        state.refreshing = false
        state.error = action.error.message || 'Failed to refresh trends'
      })
  },
})

export const { setHistoryDays } = trendsSlice.actions
export default trendsSlice.reducer
