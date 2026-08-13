'use client'

import { Card, CardContent } from '@/components/ui/card'
import showTypes from '@/data/show-types.json'

export function ShowTypeChart() {
  const maxViews = Math.max(...showTypes.map(s => s.avgViews))

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 font-heading">Show Types</h3>
        <div className="space-y-3">
          {showTypes.map((st) => (
            <div key={st.id}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-600 dark:text-gray-400">{st.name}</span>
                <span className="font-semibold" style={{ color: st.color }}>{(st.avgViews / 1000).toFixed(0)}K</span>
              </div>
              <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${(st.avgViews / maxViews) * 100}%`, backgroundColor: st.color }}
                />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
