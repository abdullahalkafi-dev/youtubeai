'use client'

import { usePathname } from 'next/navigation'
import { Menu, Sun, Moon, Monitor } from 'lucide-react'
import { useAppDispatch } from '@/store/hooks'
import { toggleMobileSidebar } from '@/store/slices/ui-slice'
import { useTheme } from '@/lib/hooks/use-theme'
import { Button } from '@/components/ui/button'

const pageTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/videos': 'Video Library',
  '/seo': 'AI SEO Engine',
  '/chat': 'AI Content Chat',
  '/queue': 'Update Queue',
  '/settings': 'Settings',
}

export function Topbar() {
  const pathname = usePathname()
  const dispatch = useAppDispatch()
  const { theme, setTheme, resolvedTheme } = useTheme()

  const title = pageTitles[pathname] || 'Dashboard'
  const segments = pathname.split('/').filter(Boolean)

  const cycleTheme = () => {
    const themes: Array<'light' | 'dark' | 'system'> = ['light', 'dark', 'system']
    const idx = themes.indexOf(theme)
    setTheme(themes[(idx + 1) % themes.length])
  }

  const ThemeIcon = resolvedTheme === 'dark' ? Moon : Sun

  return (
    <header className="h-14 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-4 lg:px-5 2xl:px-6 shrink-0">
      <div className="flex items-center gap-3">
        <button onClick={() => dispatch(toggleMobileSidebar())} className="lg:hidden text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1">
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
          <span>UMA</span>
          {segments.map((s, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <span className="text-gray-300 dark:text-gray-600">/</span>
              <span className={i === segments.length - 1 ? 'text-gray-900 dark:text-white font-semibold' : ''}>
                {pageTitles['/' + s] || s}
              </span>
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={cycleTheme} className="w-8 h-8 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
          <ThemeIcon className="w-4 h-4" />
        </Button>
      </div>
    </header>
  )
}
