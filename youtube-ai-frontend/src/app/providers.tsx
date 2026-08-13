'use client'

import { useRef, useEffect } from 'react'
import { Provider } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'
import { makeStore, type AppStore } from '@/store'
import { setLogoutHandler } from '@/lib/api'
import { logout } from '@/store/slices/auth-slice'
import { ThemeProvider } from '@/lib/hooks/use-theme'
import { Toaster } from 'sonner'

export function Providers({ children }: { children: React.ReactNode }) {
  const storeRef = useRef<AppStore>(null)
  const persistorRef = useRef<ReturnType<typeof makeStore>['persistor']>(null)
  if (!storeRef.current) {
    const { store, persistor } = makeStore()
    storeRef.current = store
    persistorRef.current = persistor
  }

  useEffect(() => {
    setLogoutHandler(() => storeRef.current?.dispatch(logout()))
  }, [])

  return (
    <Provider store={storeRef.current}>
      <PersistGate loading={null} persistor={persistorRef.current!}>
        <ThemeProvider>
          {children}
          <Toaster position="bottom-right" richColors />
        </ThemeProvider>
      </PersistGate>
    </Provider>
  )
}
