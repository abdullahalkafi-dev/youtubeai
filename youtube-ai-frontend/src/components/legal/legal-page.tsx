import Link from 'next/link'
import { LEGAL } from '@/lib/legal'

export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="max-w-3xl mx-auto px-5 py-12">
        <Link href="/login" className="text-sm text-indigo-500 hover:underline">
          {LEGAL.product}
        </Link>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mt-3 mb-1 tracking-tight">{title}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">Last updated: {LEGAL.updated}</p>
        <div className="space-y-6 text-[15px] leading-7 text-gray-700 dark:text-gray-300">{children}</div>
        <div className="mt-12 pt-6 border-t border-gray-200 dark:border-gray-800 text-sm text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/privacy" className="hover:underline">Privacy Policy</Link>
          <Link href="/terms" className="hover:underline">Terms of Service</Link>
          <Link href="/data-deletion" className="hover:underline">Data Deletion</Link>
        </div>
      </div>
    </div>
  )
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

export function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc pl-6 space-y-1.5">
      {items.map((i) => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  )
}
