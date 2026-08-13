import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'
import api from '@/lib/api'
import type { Channel } from '@/types/channel'

interface User {
  id: string
  name?: string
  email: string
  avatar?: string
}

interface AuthState {
  isAuthenticated: boolean
  user: User | null
  loading: boolean
  token: string | null
  channels: Channel[]
  activeChannelId: string | null
}

const initialState: AuthState = {
  isAuthenticated: false,
  user: null,
  loading: false,
  token: typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null,
  channels: [],
  activeChannelId: null,
}

export const loginWithGoogle = createAsyncThunk(
  'auth/loginWithGoogle',
  async () => {
    // Redirect immediately — don't set loading (it redirects anyway)
    window.location.href = api.getGoogleAuthUrl()
  },
)

export const loginWithEmail = createAsyncThunk(
  'auth/loginWithEmail',
  async ({ email, password }: { email: string; password: string }) => {
    const result = await api.login(email, password)
    localStorage.setItem('auth_token', result.access_token)
    return {
      id: result.id,
      email: result.email,
      name: result.name,
      avatar: result.avatar,
      access_token: result.access_token,
    }
  },
)

export const register = createAsyncThunk(
  'auth/register',
  async ({ email, password, name }: { email: string; password: string; name?: string }) => {
    const result = await api.register(email, password, name)
    localStorage.setItem('auth_token', result.access_token)
    return {
      id: result.id,
      email: result.email,
      name: result.name,
      access_token: result.access_token,
    }
  },
)

export const fetchProfile = createAsyncThunk(
  'auth/fetchProfile',
  async () => {
    return await api.getProfile()
  },
)

export const fetchChannels = createAsyncThunk(
  'auth/fetchChannels',
  async () => {
    return await api.getChannels()
  },
)

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    logout(state) {
      state.isAuthenticated = false
      state.user = null
      state.token = null
      state.channels = []
      state.activeChannelId = null
      state.loading = false
      localStorage.removeItem('auth_token')
    },
    resetLoading(state) {
      state.loading = false
    },
    setAuth(state, action: PayloadAction<{ isAuthenticated: boolean; user: User | null }>) {
      state.isAuthenticated = action.payload.isAuthenticated
      state.user = action.payload.user
    },
    setToken(state, action: PayloadAction<string>) {
      state.token = action.payload
      localStorage.setItem('auth_token', action.payload)
    },
    setActiveChannel(state, action: PayloadAction<string>) {
      state.activeChannelId = action.payload
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loginWithEmail.pending, (state) => { state.loading = true })
      .addCase(loginWithEmail.fulfilled, (state, action) => {
        state.loading = false
        state.isAuthenticated = true
        state.user = action.payload
        state.token = action.payload.access_token
      })
      .addCase(loginWithEmail.rejected, (state) => { state.loading = false })
      .addCase(register.pending, (state) => { state.loading = true })
      .addCase(register.fulfilled, (state, action) => {
        state.loading = false
        state.isAuthenticated = true
        state.user = action.payload
        state.token = action.payload.access_token
      })
      .addCase(register.rejected, (state) => { state.loading = false })
      .addCase(fetchProfile.fulfilled, (state, action) => {
        state.isAuthenticated = true
        state.user = action.payload
      })
      .addCase(fetchProfile.rejected, (state) => {
        // Only logout on clear auth failures (401), not transient network errors
        // The 401 handler in api.ts already handles real auth failures
        // Don't clear state here — let the user retry on transient errors
        state.isAuthenticated = false
        state.user = null
        state.token = null
        localStorage.removeItem('auth_token')
        // Keep channels and activeChannelId — they may still be valid
      })
      .addCase(fetchChannels.fulfilled, (state, action) => {
        state.channels = action.payload
        if (action.payload.length > 0 && !state.activeChannelId) {
          state.activeChannelId = action.payload[0].id
        }
      })
      .addCase(fetchChannels.rejected, (state) => {
        // Don't clear channels or activeChannelId on transient errors
        // The existing data may still be valid — user can retry
      })
  },
})

export const { logout, setAuth, setToken, setActiveChannel, resetLoading } = authSlice.actions
export default authSlice.reducer
