export const SHOW_TYPES = {
  first_night_inside: { name: 'First Night Inside', color: 'text-emerald-600 dark:text-emerald-400' },
  federal_pressure: { name: 'Federal Pressure', color: 'text-violet-600 dark:text-violet-400' },
  street_code_autopsy: { name: 'Street Code Autopsy', color: 'text-amber-600 dark:text-amber-400' },
  courtroom_reality: { name: 'Courtroom Reality', color: 'text-rose-600 dark:text-rose-400' },
  mothers_sentenced: { name: 'Mothers Got Sentenced', color: 'text-orange-600 dark:text-orange-400' },
  prison_psychology: { name: 'Prison Psychology', color: 'text-indigo-600 dark:text-indigo-400' },
  smart_man_trap: { name: 'The Smart Man Trap', color: 'text-pink-600 dark:text-pink-400' },
} as const

export const SEO_STATUS = {
  optimized: { label: 'Optimized', variant: 'green' as const },
  pending: { label: 'Pending', variant: 'yellow' as const },
  processing: { label: 'Processing', variant: 'blue' as const },
  not_started: { label: 'Not Started', variant: 'gray' as const },
  approved: { label: 'Approved', variant: 'green' as const },
} as const

export const QUEUE_STATUS = {
  queued: { label: 'Queued', variant: 'yellow' as const },
  processing: { label: 'Processing', variant: 'blue' as const },
  done: { label: 'Done', variant: 'green' as const },
  failed: { label: 'Failed', variant: 'red' as const },
} as const

export const ROUTES = {
  dashboard: '/dashboard',
  videos: '/videos',
  videoDetail: (id: string) => `/videos/${id}`,
  trends: '/trends',
  seo: '/seo',
  chat: '/chat',
  queue: '/queue',
  settings: '/settings',
  login: '/login',
} as const

export const NAV_ITEMS = [
  { label: 'Dashboard', href: ROUTES.dashboard, icon: 'LayoutDashboard' },
  { label: 'Video Library', href: ROUTES.videos, icon: 'Video' },
  { label: 'Trending', href: ROUTES.trends, icon: 'TrendingUp' },
  { label: 'AI Content Chat', href: ROUTES.chat, icon: 'MessageSquare' },
] as const

export const NAV_ITEMS_BOTTOM = [
  { label: 'Automation', href: ROUTES.queue, icon: 'Sparkles' },
  { label: 'Settings', href: ROUTES.settings, icon: 'Settings' },
] as const

export const CHAT_CATEGORIES = [
  { id: 'general', label: 'General' },
  { id: 'thumbnail', label: 'Thumbnail' },
] as const
