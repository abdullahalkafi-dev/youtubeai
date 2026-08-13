import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import { api } from '@/lib/api'
import type { QuotaUsage } from '@/types/quota'

interface QuotaState {
  usage: QuotaUsage | null
  loading: boolean
}

const initialState: QuotaState = {
  usage: null,
  loading: false,
}

export const fetchQuotaUsage = createAsyncThunk(
  'quota/fetchUsage',
  async (channelId: string) => {
    return api.getQuotaUsage(channelId)
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
  },
})

export default quotaSlice.reducer
