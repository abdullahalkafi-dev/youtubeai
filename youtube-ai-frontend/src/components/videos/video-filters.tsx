'use client'

import { useState, useEffect } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { setFilters } from '@/store/slices/videos-slice'

export function VideoFilters() {
  const dispatch = useAppDispatch()
  const search = useAppSelector(s => s.videos.filters.search)
  const [localSearch, setLocalSearch] = useState(search)

  // Sync local state when Redux search changes externally (e.g. page load)
  useEffect(() => {
    setLocalSearch(search)
  }, [search])

  // Debounce: only dispatch to Redux after 300ms pause
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localSearch !== search) {
        dispatch(setFilters({ search: localSearch }))
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [localSearch, search, dispatch])

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-3 mb-4">
      <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2.5 border border-gray-200 dark:border-gray-700">
        <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <Input
          type="text"
          placeholder="Search videos..."
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          className="bg-transparent border-0 h-auto p-0 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
        />
      </div>
    </div>
  )
}
