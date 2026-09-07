import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import { api } from '@/lib/api'
import type { QuotaUsage } from '@/types/quota'

interface QuotaState {
  usage: QuotaUsage | null
  analyticsUsage: QuotaUsage | null
  loading: boolean
  analyticsLoading: boolean
}

const initialState: QuotaState = {
  usage: null,
  analyticsUsage: null,
  loading: false,
  analyticsLoading: false,
}

export const fetchQuotaUsage = createAsyncThunk(
  'quota/fetchUsage',
  async (channelId: string) => {
    return api.getQuotaUsage(channelId)
  },
)

export const fetchAnalyticsQuotaUsage = createAsyncThunk(
  'quota/fetchAnalyticsUsage',
  async (channelId: string) => {
    return api.getAnalyticsQuotaUsage(channelId)
  },
)

const quotaSlice = createSlice({
  name: 'quota',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchQuotaUsage.pending, (state) => {
        state.loading = true
      })
      .addCase(fetchQuotaUsage.fulfilled, (state, action) => {
        state.loading = false
        state.usage = action.payload as QuotaUsage
      })
      .addCase(fetchQuotaUsage.rejected, (state) => {
        state.loading = false
      })
      .addCase(fetchAnalyticsQuotaUsage.pending, (state) => {
        state.analyticsLoading = true
      })
      .addCase(fetchAnalyticsQuotaUsage.fulfilled, (state, action) => {
        state.analyticsLoading = false
        state.analyticsUsage = action.payload as QuotaUsage
      })
      .addCase(fetchAnalyticsQuotaUsage.rejected, (state) => {
        state.analyticsLoading = false
      })
  },
})

export default quotaSlice.reducer
