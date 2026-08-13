import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import type { SeoSuggestion } from '@/types/seo'
import api from '@/lib/api'

interface SeoState {
  suggestions: SeoSuggestion[]
  loading: boolean
  generating: boolean
  error: string | null
}

const initialState: SeoState = {
  suggestions: [],
  loading: false,
  generating: false,
  error: null,
}

export const fetchSeoSuggestions = createAsyncThunk(
  'seo/fetchSuggestions',
  async (channelId: string) => {
    return await api.getSeoSuggestions(channelId)
  },
)

export const generateSeo = createAsyncThunk(
  'seo/generate',
  async ({ videoId, customInstructions }: { videoId: string; customInstructions?: string }) => {
    return await api.generateSeo(videoId, customInstructions)
  },
)

export const approveSeoAsync = createAsyncThunk(
  'seo/approve',
  async (id: string) => {
    const result = await api.approveSeo(id)
    if (result.success === false) {
      throw new Error(result.error)
    }
    return { id, ...result }
  },
)

export const rejectSeoAsync = createAsyncThunk(
  'seo/reject',
  async (id: string) => {
    await api.rejectSeo(id)
    return id
  },
)

const seoSlice = createSlice({
  name: 'seo',
  initialState,
  reducers: {
    clearError(state) {
      state.error = null
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchSeoSuggestions.pending, (state) => { state.loading = true })
      .addCase(fetchSeoSuggestions.fulfilled, (state, action) => {
        state.loading = false
        state.suggestions = action.payload
      })
      .addCase(fetchSeoSuggestions.rejected, (state) => {
        state.loading = false
      })
      .addCase(generateSeo.pending, (state) => { state.generating = true })
      .addCase(generateSeo.fulfilled, (state, action) => {
        state.generating = false
        if (action.payload) {
          state.suggestions.forEach(s => {
            if (s.videoId === action.payload.videoId && s.status === 'pending') {
              s.status = 'superseded'
            }
          })
          state.suggestions.unshift(action.payload)
        }
      })
      .addCase(generateSeo.rejected, (state) => {
        state.generating = false
        state.error = 'Failed to generate SEO'
      })
      .addCase(approveSeoAsync.fulfilled, (state, action) => {
        const idx = state.suggestions.findIndex(s => s.id === action.meta.arg)
        if (idx !== -1) state.suggestions[idx].status = 'approved'
      })
      .addCase(approveSeoAsync.rejected, (state, action) => {
        state.error = action.error.message || 'Daily limit reached'
      })
      .addCase(rejectSeoAsync.fulfilled, (state, action) => {
        const idx = state.suggestions.findIndex(s => s.id === action.payload)
        if (idx !== -1) state.suggestions[idx].status = 'rejected'
      })
  },
})

export const { clearError } = seoSlice.actions
export default seoSlice.reducer
