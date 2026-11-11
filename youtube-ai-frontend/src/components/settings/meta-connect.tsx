'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, Loader2, Link2, Unplug } from 'lucide-react'
import { api, type MetaAccounts } from '@/lib/api'
import { showApiErrorToast } from '@/lib/error-handler'
import { toast } from 'sonner'

const ERROR_TEXT: Record<string, string> = {
  access_denied: 'Facebook login was cancelled.',
  invalid_state: 'The login link expired. Please try again.',
  missing_code: 'Facebook did not return a login code. Please try again.',
  exchange_failed: 'Facebook login could not be completed. Please try again.',
  not_configured: 'Facebook / Instagram login is not configured on the server.',
}

export function MetaConnectCard() {
  const [accounts, setAccounts] = useState<MetaAccounts | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setAccounts(await api.getMetaAccounts())
    } catch {
      setAccounts(null)
    }
  }, [])

  useEffect(() => {
    load()
    // The backend callback sends the browser back here with ?meta=connected|error
    const params = new URLSearchParams(window.location.search)
    const status = params.get('meta')
    if (!status) return
    if (status === 'connected') {
      toast.success('Facebook / Instagram connected', { description: `${params.get('pages') || 0} Page(s) found.` })
    } else {
      toast.error(ERROR_TEXT[params.get('reason') || ''] || 'Facebook login failed.')
    }
    window.history.replaceState(null, '', window.location.pathname)
  }, [load])

  const connect = async () => {
    try {
      setBusy(true)
      const { url } = await api.getMetaAuthUrl()
      window.location.href = url
    } catch (err) {
      showApiErrorToast(err, 'Could not start Facebook login')
      setBusy(false)
    }
  }

  const disconnect = async () => {
    try {
      setBusy(true)
      await api.disconnectMeta()
      toast.success('Facebook / Instagram disconnected and stored data deleted')
      await load()
    } catch (err) {
      showApiErrorToast(err, 'Could not disconnect')
    } finally {
      setBusy(false)
    }
  }

  const connected = Boolean(accounts?.connected)

  return (
    <Card>
      <CardContent className="p-5 lg:p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm lg:text-base font-semibold text-gray-900 dark:text-white font-heading">
            Facebook & Instagram
          </h3>
          {connected && (
            <Badge variant="green" className="flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              Connected
            </Badge>
          )}
        </div>

        {connected ? (
          <div className="space-y-3">
            {accounts!.pages.length === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Logged in, but no Facebook Page was shared. Reconnect and tick the Page on Facebook&apos;s screen.
              </p>
            )}
            {accounts!.pages.map((p) => (
              <div
                key={p.pageId}
                className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3.5 border border-gray-200 dark:border-gray-700"
              >
                <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{p.name}</p>
                <p className="text-xs text-gray-400">Facebook Page</p>
                <p className="text-xs mt-1.5 text-gray-600 dark:text-gray-300">
                  {p.instagram
                    ? `Instagram: @${p.instagram.username || p.instagram.id}${
                        p.instagram.followersCount ? ` · ${p.instagram.followersCount.toLocaleString()} followers` : ''
                      }`
                    : 'No Instagram account linked to this Page'}
                </p>
              </div>
            ))}
            <div className="flex gap-2 pt-1">
              <button
                onClick={connect}
                disabled={busy}
                className="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                Reconnect
              </button>
              <button
                onClick={disconnect}
                disabled={busy}
                className="py-2.5 px-4 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition disabled:opacity-50"
              >
                <Unplug className="w-3.5 h-3.5" />
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-400">
              Connect the Facebook Page and its linked Instagram account. You choose what to share on Facebook&apos;s own screen.
            </p>
            <button
              onClick={connect}
              disabled={busy}
              className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 shadow-sm transition disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
              Connect Facebook & Instagram
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
