import { configureStore, combineReducers } from '@reduxjs/toolkit'
import { persistStore, persistReducer, FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER } from 'redux-persist'
import authReducer from './slices/auth-slice'
import videosReducer from './slices/videos-slice'
import chatReducer from './slices/chat-slice'
import queueReducer from './slices/queue-slice'
import seoReducer from './slices/seo-slice'
import uiReducer from './slices/ui-slice'
import commentsReducer from './slices/comments-slice'
import trendsReducer from './slices/trends-slice'
import quotaReducer from './slices/quota-slice'
import analyticsReducer from './slices/analytics-slice'

const rootReducer = combineReducers({
  auth: authReducer,
  videos: videosReducer,
  chat: chatReducer,
  queue: queueReducer,
  seo: seoReducer,
  ui: uiReducer,
  comments: commentsReducer,
  trends: trendsReducer,
  quota: quotaReducer,
  analytics: analyticsReducer,
})

// Safe storage that works on both server and client
const createNoopStorage = () => ({
  getItem: () => Promise.resolve(null),
  setItem: () => Promise.resolve(),
  removeItem: () => Promise.resolve(),
})

const createBrowserStorage = () => ({
  getItem: (key: string) => {
    const value = localStorage.getItem(key)
    return Promise.resolve(value)
  },
  setItem: (key: string, value: string) => {
    localStorage.setItem(key, value)
    return Promise.resolve()
  },
  removeItem: (key: string) => {
    localStorage.removeItem(key)
    return Promise.resolve()
  },
})

const storage = typeof window !== 'undefined' ? createBrowserStorage() : createNoopStorage()

const persistConfig = {
  key: 'root',
  storage,
  whitelist: ['auth', 'ui'],
  merge: (persistedState: any, initialState: any) => {
    // Merge persisted state but force `loading` to false (it's transient UI state)
    const merged = { ...initialState, ...persistedState }
    if (merged.auth) {
      merged.auth.loading = false
    }
    return merged
  },
}

const persistedReducer = persistReducer(persistConfig, rootReducer)

export const makeStore = () => {
  const store = configureStore({
    reducer: persistedReducer,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: { ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER] },
      }),
  })
  const persistor = persistStore(store)
  return { store, persistor }
}

export type AppStore = ReturnType<typeof makeStore>['store']
export type RootState = ReturnType<AppStore['getState']>
export type AppDispatch = AppStore['dispatch']
