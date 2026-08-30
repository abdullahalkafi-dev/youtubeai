'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAppDispatch, useAppSelector } from '@/store/hooks'
import { loginWithGoogle, loginWithEmail, resetLoading } from '@/store/slices/auth-slice'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function LoginPage() {
  const router = useRouter()
  const dispatch = useAppDispatch()
  const { loading } = useAppSelector(s => s.auth)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  // Safety net: reset loading if it's been stuck for >3 seconds
  useEffect(() => {
    if (!loading) return
    const timer = setTimeout(() => {
      dispatch(resetLoading())
    }, 3000)
    return () => clearTimeout(timer)
  }, [loading, dispatch])

  const handleGoogleLogin = async () => {
    dispatch(loginWithGoogle())
  }

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      const result = await dispatch(loginWithEmail({ email, password }))
      if (loginWithEmail.fulfilled.match(result)) {
        window.location.href = '/dashboard'
      } else {
        setError('Invalid email or password')
      }
    } catch {
      setError('Connection failed. Please try again.')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-gray-50 dark:bg-gray-950 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-500/10 via-gray-50 to-gray-50 dark:from-indigo-900/20 dark:via-gray-950 dark:to-gray-950">
      <div className="relative z-10 w-full max-w-sm px-5 py-8">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl shadow-indigo-500/5 border border-gray-200/80 dark:border-gray-800 p-7">
          <div className="text-center mb-7">
            <div className="w-14 h-14 bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg shadow-indigo-500/25 shrink-0">
              <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
            </div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white font-sans tracking-tight">Unique Mecca Audio</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">YouTube SEO & Content Intelligence</p>
          </div>

          {!loading ? (
            <>
              {/* Google Login Button */}
              <button
                onClick={handleGoogleLogin}
                className="w-full flex items-center justify-center gap-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium h-11 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-750 transition shadow-sm"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </button>

              {/* Divider */}
              <div className="flex items-center gap-3 my-5">
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                <span className="text-[10px] text-gray-400 uppercase">or</span>
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
              </div>

              <form onSubmit={handleEmailLogin} className="space-y-2.5">
                <Input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-gray-50 dark:bg-gray-800 h-11"
                  required
                />
                <Input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-gray-50 dark:bg-gray-800 h-11"
                  required
                />
                {error && (
                  <p className="text-xs text-red-500">{error}</p>
                )}
                <Button type="submit" className="w-full bg-gradient-to-r from-indigo-500 to-indigo-600 text-white font-semibold h-11 hover:from-indigo-600 hover:to-indigo-700 shadow-lg shadow-indigo-500/25">
                  Sign In
                </Button>
              </form>

              <p className="text-[10px] text-gray-400 text-center mt-5">By signing in, you agree to our Terms of Service and Privacy Policy</p>
            </>
          ) : (
            <div className="text-center py-6">
              <div className="w-8 h-8 border-[3px] border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-gray-400">Connecting to YouTube...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
