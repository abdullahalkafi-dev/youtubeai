import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'
import type { Video, PaginatedVideos } from '@/types/video'
import api from '@/lib/api'

interface VideosState {
  items: Video[]
  selectedVideo: Video | null
  filters: { search: string; status: string; sort: string }
  pagination: { page: number; limit: number; total: number; totalPages: number }
  loading: boolean
  error: string | null
}

const initialState: VideosState = {
  items: [],
  selectedVideo: null,
  filters: { search: '', status: 'all', sort: 'newest' },
  pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  loading: false,
  error: null,
}

export const fetchVideos = createAsyncThunk(
  'videos/fetchVideos',
  async (params: { channelId: string; page?: number; limit?: number; search?: string; status?: string; sort?: string }) => {
    const result: PaginatedVideos = await api.getVideos(params.channelId, {
      page: params.page || 1,
      limit: params.limit || 20,
      search: params.search,
      status: params.status,
      sort: params.sort,
    })
    return result
  },
)

export const fetchVideoById = createAsyncThunk(
  'videos/fetchVideoById',
  async (id: string) => {
    return await api.getVideo(id)
  },
)

const videosSlice = createSlice({
  name: 'videos',
  initialState,
  reducers: {
    setFilters(state, action: PayloadAction<Partial<{ search: string; status: string; sort: string }>>) {
      state.filters = { ...state.filters, ...action.payload }
      state.pagination.page = 1
    },
    setPage(state, action) {
      state.pagination.page = action.payload
    },
    clearSelectedVideo(state) {
      state.selectedVideo = null
    },
    updateSelectedVideo(state, action) {
      if (state.selectedVideo && state.selectedVideo.id === action.payload.id) {
        state.selectedVideo = action.payload
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchVideos.pending, (state) => { state.loading = true })
      .addCase(fetchVideos.fulfilled, (state, action) => {
        state.loading = false
        state.items = action.payload.items
        state.pagination = {
          page: action.payload.page,
          limit: action.payload.limit,
          total: action.payload.total,
          totalPages: action.payload.totalPages,
        }
      })
      .addCase(fetchVideos.rejected, (state) => {
        state.loading = false
        state.error = 'Failed to fetch videos'
      })
      .addCase(fetchVideoById.fulfilled, (state, action) => {
        state.selectedVideo = action.payload || null
      })
      .addCase(fetchVideoById.rejected, (state) => {
        state.selectedVideo = null
      })
  },
})

export const { setFilters, setPage, clearSelectedVideo, updateSelectedVideo } = videosSlice.actions
export default videosSlice.reducer
