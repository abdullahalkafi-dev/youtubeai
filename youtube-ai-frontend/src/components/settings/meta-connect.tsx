'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, Loader2, Link2, Unplug } from 'lucide-react'
import { api, type MetaAccounts, type MetaLogin } from '@/lib/api'
import { showApiErrorToast } from '@/lib/error-handler'
import { toast } from 'sonner'

const ERROR_TEXT: Record<string, string> = {
  access_denied: 'Facebook login was cancelled.',
  invalid_state: 'The login link expired. Please try again.',
  missing_code: 'Facebook did not return a login code. Please try again.',
  exchange_failed: 'Facebook login could not be completed. Please try again.',
  not_configured: 'Facebook / Instagram login is not configured on the server.',
}

/** The connected Facebook accounts. An older server answers with only the flat `pages` list: show it as one account. */
function loginsOf(accounts: MetaAccounts): MetaLogin[] {
  if (accounts.logins?.length) return accounts.logins
  return [{ loginId: 'default', connectedAt: accounts.connectedAt, tokenExpiresAt: accounts.tokenExpiresAt, pages: accounts.pages }]
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

  const disconnect = async (loginId?: string) => {
    const what = loginId ? 'this Facebook account' : 'every connected Facebook account'
    if (!window.confirm(`Disconnect ${what}? Its stored access is deleted.`)) return
    try {
      setBusy(true)
      await api.disconnectMeta(loginId)
      toast.success(loginId ? 'Facebook account disconnected' : 'Facebook / Instagram disconnected and stored data deleted')
      await load()
    } catch (err) {
      showApiErrorToast(err, 'Could not disconnect')
    } finally {
      setBusy(false)
    }
  }

  const connected = Boolean(accounts?.connected)
  const logins = accounts ? loginsOf(accounts) : []
  const pageCount = logins.reduce((n, l) => n + l.pages.length, 0)

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
            {pageCount === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Logged in, but no Facebook Page was shared. Connect again and tick the Page on Facebook&apos;s screen.
              </p>
            )}
            {logins.map((login, i) => (
              <div
                key={login.loginId}
                className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3.5 border border-gray-200 dark:border-gray-700 space-y-2.5"
              >
                {logins.length > 1 && (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Facebook account {i + 1}</p>
                    <button
                      onClick={() => disconnect(login.loginId === 'default' ? undefined : login.loginId)}
                      disabled={busy}
                      className="text-[11px] text-gray-400 hover:text-red-500 transition disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                )}
                {login.pages.length === 0 && <p className="text-xs text-gray-400">No Page shared from this account.</p>}
                {login.pages.map((p) => (
                  <div key={p.pageId}>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{p.name}</p>
                    <p className="text-xs text-gray-400">Facebook Page</p>
                    <p className="text-xs mt-1 text-gray-600 dark:text-gray-300">
                      {p.instagram
                        ? `Instagram: @${p.instagram.username || p.instagram.id}${
                            p.instagram.followersCount ? ` · ${p.instagram.followersCount.toLocaleString()} followers` : ''
                          }`
                        : 'No Instagram account linked to this Page'}
                    </p>
                  </div>
                ))}
              </div>
            ))}
            <p className="text-[11px] text-gray-400">
              Connecting another Facebook account adds it here. It does not replace the ones already connected.
            </p>
            <div className="flex gap-2 pt-1">
              <button
                onClick={connect}
                disabled={busy}
                className="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                Connect a Facebook account
              </button>
              <button
                onClick={() => disconnect()}
                disabled={busy}
                className="py-2.5 px-4 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition disabled:opacity-50"
              >
                <Unplug className="w-3.5 h-3.5" />
                Disconnect all
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
