export type ThreadCategory = 'general' | 'script' | 'seo' | 'thumbnail' | 'image' | 'competitor' | 'trends' | 'ideas' | 'outline'

export interface CategoryColor {
  name: string
  icon: string
  primary: string
  light: string
  dark: string
  bg: string
  bgDark: string
  border: string
  borderDark: string
  text: string
  textDark: string
}

export const CATEGORY_COLORS: Record<ThreadCategory, CategoryColor> = {
  general: {
    name: 'General',
    icon: 'MessageSquare',
    primary: '#6366f1',
    light: '#e0e7ff',
    dark: '#818cf8',
    bg: 'bg-indigo-50',
    bgDark: 'dark:bg-indigo-500/10',
    border: 'border-indigo-200',
    borderDark: 'dark:border-indigo-500/20',
    text: 'text-indigo-600',
    textDark: 'dark:text-indigo-400',
  },
  script: {
    name: 'Script',
    icon: 'FileText',
    primary: '#f59e0b',
    light: '#fef3c7',
    dark: '#fbbf24',
    bg: 'bg-amber-50',
    bgDark: 'dark:bg-amber-500/10',
    border: 'border-amber-200',
    borderDark: 'dark:border-amber-500/20',
    text: 'text-amber-600',
    textDark: 'dark:text-amber-400',
  },
  seo: {
    name: 'SEO',
    icon: 'Sparkles',
    primary: '#10b981',
    light: '#d1fae5',
    dark: '#34d399',
    bg: 'bg-emerald-50',
    bgDark: 'dark:bg-emerald-500/10',
    border: 'border-emerald-200',
    borderDark: 'dark:border-emerald-500/20',
    text: 'text-emerald-600',
    textDark: 'dark:text-emerald-400',
  },
  thumbnail: {
    name: 'Thumbnail',
    icon: 'Image',
    primary: '#8b5cf6',
    light: '#ede9fe',
    dark: '#a78bfa',
    bg: 'bg-violet-50',
    bgDark: 'dark:bg-violet-500/10',
    border: 'border-violet-200',
    borderDark: 'dark:border-violet-500/20',
    text: 'text-violet-600',
    textDark: 'dark:text-violet-400',
  },
  image: {
    name: 'Generate Image',
    icon: 'Film',
    primary: '#ec4899',
    light: '#fce7f3',
    dark: '#f472b6',
    bg: 'bg-pink-50',
    bgDark: 'dark:bg-pink-500/10',
    border: 'border-pink-200',
    borderDark: 'dark:border-pink-500/20',
    text: 'text-pink-600',
    textDark: 'dark:text-pink-400',
  },
  competitor: {
    name: 'Competitor',
    icon: 'Target',
    primary: '#f43f5e',
    light: '#ffe4e6',
    dark: '#fb7185',
    bg: 'bg-rose-50',
    bgDark: 'dark:bg-rose-500/10',
    border: 'border-rose-200',
    borderDark: 'dark:border-rose-500/20',
    text: 'text-rose-600',
    textDark: 'dark:text-rose-400',
  },
  trends: {
    name: 'Trends',
    icon: 'TrendingUp',
    primary: '#06b6d4',
    light: '#cffafe',
    dark: '#22d3ee',
    bg: 'bg-cyan-50',
    bgDark: 'dark:bg-cyan-500/10',
    border: 'border-cyan-200',
    borderDark: 'dark:border-cyan-500/20',
    text: 'text-cyan-600',
    textDark: 'dark:text-cyan-400',
  },
  ideas: {
    name: 'Ideas',
    icon: 'Lightbulb',
    primary: '#f97316',
    light: '#ffedd5',
    dark: '#fb923c',
    bg: 'bg-orange-50',
    bgDark: 'dark:bg-orange-500/10',
    border: 'border-orange-200',
    borderDark: 'dark:border-orange-500/20',
    text: 'text-orange-600',
    textDark: 'dark:text-orange-400',
  },
  outline: {
    name: 'Outline',
    icon: 'Layers',
    primary: '#3b82f6',
    light: '#dbeafe',
    dark: '#60a5fa',
    bg: 'bg-blue-50',
    bgDark: 'dark:bg-blue-500/10',
    border: 'border-blue-200',
    borderDark: 'dark:border-blue-500/20',
    text: 'text-blue-600',
    textDark: 'dark:text-blue-400',
  },
}

export function getCategoryColor(category: string): CategoryColor {
  return CATEGORY_COLORS[category as ThreadCategory] || CATEGORY_COLORS.general
}
