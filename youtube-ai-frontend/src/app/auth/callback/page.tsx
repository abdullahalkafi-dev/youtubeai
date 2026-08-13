'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAppDispatch } from '@/store/hooks'
import { setToken, fetchProfile, fetchChannels } from '@/store/slices/auth-slice'

export default function AuthCallbackPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const dispatch = useAppDispatch()

  useEffect(() => {
    const token = searchParams.get('token')
    if (token) {
      localStorage.setItem('auth_token', token)
      dispatch(setToken(token))
      // Fetch profile and channels before redirecting
      dispatch(fetchProfile())
        .unwrap()
        .then(() => dispatch(fetchChannels()))
        .then(() => router.push('/dashboard'))
        .catch(() => router.push('/login'))
    } else {
      router.push('/login')
    }
  }, [searchParams, dispatch, router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="text-center">
        <div className="w-8 h-8 border-[3px] border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-400">Completing sign in...</p>
      </div>
    </div>
  )
}
