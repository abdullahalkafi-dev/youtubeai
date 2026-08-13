'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Video, Sparkles, MessageSquare, List, Settings, LogOut, X, TrendingUp, BarChart3, Search, Target, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NAV_ITEMS, NAV_ITEMS_BOTTOM } from '@/lib/constants'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { closeMobileSidebar } from '@/store/slices/ui-slice'
import { logout } from '@/store/slices/auth-slice'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

const iconMap = { LayoutDashboard, Video, Sparkles, MessageSquare, List, Settings, TrendingUp, BarChart3, Search, Target, RefreshCw }

export function MobileSidebar() {
  const pathname = usePathname()
  const dispatch = useAppDispatch()
  const open = useAppSelector(s => s.ui.mobileSidebarOpen)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-black/50" onClick={() => dispatch(closeMobileSidebar())} />
      <aside className="absolute left-0 top-0 bottom-0 w-64 bg-white dark:bg-gray-900 shadow-xl flex flex-col">
        <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <Link href="/dashboard" onClick={() => dispatch(closeMobileSidebar())} className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-lg flex items-center justify-center shadow-sm">
              <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
            </div>
            <div className="min-w-0">
              <h2 className="text-xs font-bold text-gray-900 dark:text-white truncate">UMA Platform</h2>
              <p className="text-[10px] text-gray-400">Content Intelligence</p>
            </div>
          </Link>
          <button onClick={() => dispatch(closeMobileSidebar())} className="text-gray-400 hover:text-gray-600 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 py-3 px-2.5 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = iconMap[item.icon as keyof typeof iconMap]
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => dispatch(closeMobileSidebar())}
                className={cn(
                  'flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg text-sm transition-all',
                  isActive
                    ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-semibold'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                )}
              >
                <Icon className="w-4.5 h-4.5 shrink-0" />
                {item.label}
              </Link>
            )
          })}

          <div className="pt-3 pb-1 px-2.5">
            <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-widest">Automation</p>
          </div>

          {NAV_ITEMS_BOTTOM.map((item) => {
            const Icon = iconMap[item.icon as keyof typeof iconMap]
            const isActive = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => dispatch(closeMobileSidebar())}
                className={cn(
                  'flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg text-sm transition-all',
                  isActive
                    ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-semibold'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                )}
              >
                <Icon className="w-4.5 h-4.5 shrink-0" />
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="p-3 border-t border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2.5">
            <Avatar className="w-8 h-8">
              <AvatarFallback className="bg-gradient-to-br from-indigo-400 to-indigo-600 text-white text-xs font-bold">U</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">Unique Mecca</p>
              <p className="text-[10px] text-gray-400">156K subs</p>
            </div>
            <button onClick={() => { dispatch(logout()); dispatch(closeMobileSidebar()); }} className="text-gray-400 hover:text-red-500 transition p-1">
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}
