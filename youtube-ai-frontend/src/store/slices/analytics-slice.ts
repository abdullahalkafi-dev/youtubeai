import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import api from '@/lib/api'

interface SearchTerm {
  term: string
  views: number
  watchMinutes: number
}

interface TrafficSource {
  source: string
  views: number
  watchMinutes: number
  subsGained: number
}

interface RetentionPoint {
  date: string
  retentionPercent: number
  avgDuration: number
}

interface RevenuePoint {
  date: string
  revenue: number
  adRevenue: number
}

interface TopVideo {
  videoId: string
  title: string
  views: number
  watchMinutes: number
  retentionPercent: number
  revenue: number
}

interface AnalyticsState {
  searchTerms: SearchTerm[]
  trafficSources: TrafficSource[]
  retention: RetentionPoint[]
  revenue: RevenuePoint[]
  topVideos: TopVideo[]
  period: 7 | 30 | 90 | 365
  loading: boolean
  error: string | null
}

const initialState: AnalyticsState = {
  searchTerms: [],
  trafficSources: [],
  retention: [],
  revenue: [],
  topVideos: [],
  period: 30,
  loading: false,
  error: null,
}

export const fetchAnalytics = createAsyncThunk(
  'analytics/fetchAll',
  async ({ channelId, period }: { channelId: string; period: number }, { rejectWithValue }) => {
    try {
      const [searchTerms, trafficSources, retention, revenue, topVideos] = await Promise.all([
        api.getSearchTerms(channelId, period),
        api.getTrafficSources(channelId, period),
        api.getRetention(channelId, period),
        api.getRevenue(channelId, period),
        api.getTopVideosByWatchTime(channelId, period, 10),
      ])
      return { searchTerms, trafficSources, retention, revenue, topVideos }
    } catch (error: any) {
      return rejectWithValue(error.message)
    }
  }
)

const analyticsSlice = createSlice({
  name: 'analytics',
  initialState,
  reducers: {
    setPeriod(state, action) {
      state.period = action.payload
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAnalytics.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchAnalytics.fulfilled, (state, action) => {
        state.loading = false
        state.searchTerms = action.payload.searchTerms
        state.trafficSources = action.payload.trafficSources
        state.retention = action.payload.retention
        state.revenue = action.payload.revenue
        state.topVideos = action.payload.topVideos
      })
      .addCase(fetchAnalytics.rejected, (state, action) => {
        state.loading = false
        state.error = action.payload as string
      })
  },
})

export const { setPeriod } = analyticsSlice.actions
export default analyticsSlice.reducer
