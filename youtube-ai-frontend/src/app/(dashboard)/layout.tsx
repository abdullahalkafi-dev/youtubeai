'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAppSelector, useAppDispatch } from '@/store/hooks'
import { fetchProfile, fetchChannels } from '@/store/slices/auth-slice'
import { Sidebar } from '@/components/layout/sidebar'
import { Topbar } from '@/components/layout/topbar'
import { MobileNav } from '@/components/layout/mobile-nav'
import { MobileSidebar } from '@/components/layout/mobile-sidebar'
import { cn } from '@/lib/utils'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const dispatch = useAppDispatch()
  const { isAuthenticated, token } = useAppSelector(s => s.auth)

  const isChatRoute = pathname === '/chat'

  useEffect(() => {
    if (!token) {
      router.push('/login')
      return
    }
    dispatch(fetchProfile())
      .unwrap()
      .then(() => {
        dispatch(fetchChannels())
      })
      .catch(() => {
        // token invalid, fetchProfile rejected handles cleanup
      })
  }, [token, dispatch, router])

  if (!isAuthenticated && !token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-center">
          <div className="w-8 h-8 border-[3px] border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <MobileSidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Topbar />
        <main
          className={cn(
            'flex-1 bg-gray-50 dark:bg-gray-950',
            isChatRoute
              ? 'overflow-hidden flex flex-col min-h-0 pb-14 lg:pb-0'
              : 'overflow-y-auto pb-16 lg:pb-0'
          )}
        >
          {children}
        </main>
        <MobileNav />
      </div>
    </div>
  )
}
