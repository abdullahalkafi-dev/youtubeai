'use client'

import { useRef, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Provider } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'
import { makeStore, type AppStore } from '@/store'
import { setLogoutHandler } from '@/lib/api'
import { logout } from '@/store/slices/auth-slice'
import { ThemeProvider } from '@/lib/hooks/use-theme'
import { Toaster } from 'sonner'

// Public legal pages must be in the server-rendered HTML (platform reviewers and crawlers fetch them), so they skip PersistGate.
const PUBLIC_PATHS = ['/privacy', '/terms', '/data-deletion']

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
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

  if (PUBLIC_PATHS.includes(pathname)) {
    return <ThemeProvider>{children}</ThemeProvider>
  }

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
