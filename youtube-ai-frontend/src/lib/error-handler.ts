import { toast } from 'sonner'
import api from '@/lib/api'

export interface ParsedApiError {
  title: string
  description: string
  isAuthExpired: boolean
  isQuotaExceeded: boolean
  isRateLimited: boolean
  action?: {
    label: string
    onClick: () => void
  }
}

/**
 * Classifies an API / runtime error into human-readable, client-friendly explanation
 * with actionable recovery steps (e.g. 1-click Google OAuth re-login).
 */
export function parseApiError(err: unknown, defaultTitle: string = 'Action Failed'): ParsedApiError {
  let message = ''
  let code = ''
  let requiresReauth = false
  let isQuota = false
  let statusCode = 0

  if (err && typeof err === 'object') {
    const anyErr = err as any
    message = anyErr.message || anyErr.errorMessage || anyErr.error || ''
    code = anyErr.code || anyErr.raw?.code || anyErr.raw?.error || ''
    statusCode = anyErr.statusCode || anyErr.status || 0
    requiresReauth = Boolean(
      anyErr.requiresReauth ||
      anyErr.raw?.requiresGoogleAuth ||
      code === 'OAUTH_REFRESH_FAILED' ||
      code === 'OAUTH_NO_TOKEN'
    )
    isQuota = Boolean(
      anyErr.isQuotaError ||
      code === 'QUOTA_EXCEEDED' ||
      statusCode === 429
    )
  } else if (typeof err === 'string') {
    message = err
  }

  const lowerMsg = message.toLowerCase()

  // 1. Check for Google / YouTube OAuth token expiration or revoked grant
  if (
    requiresReauth ||
    code === 'OAUTH_REFRESH_FAILED' ||
    code === 'OAUTH_NO_TOKEN' ||
    lowerMsg.includes('oauth_refresh_failed') ||
    lowerMsg.includes('oauth_no_token') ||
    lowerMsg.includes('invalid_grant') ||
    lowerMsg.includes('token expired') ||
    lowerMsg.includes('re-login with google') ||
    lowerMsg.includes('reconnect via google') ||
    lowerMsg.includes('token has been expired or revoked')
  ) {
    return {
      title: 'YouTube Authorization Expired',
      description: 'Your Google/YouTube connection has expired. Please re-login with Google to reconnect your channel.',
      isAuthExpired: true,
      isQuotaExceeded: false,
      isRateLimited: false,
      action: {
        label: 'Re-login with Google',
        onClick: () => {
          if (typeof window !== 'undefined') {
            window.location.href = api.getGoogleAuthUrl()
          }
        },
      },
    }
  }

  // 2. Check for YouTube API Daily Quota Exceeded
  if (
    isQuota ||
    code === 'QUOTA_EXCEEDED' ||
    lowerMsg.includes('quotaexceeded') ||
    lowerMsg.includes('quota exceeded') ||
    lowerMsg.includes('dailylimitexceeded') ||
    lowerMsg.includes('daily limit exceeded') ||
    lowerMsg.includes('exceeded your quota') ||
    lowerMsg.includes('quota limit')
  ) {
    return {
      title: 'YouTube API Quota Exceeded',
      description: "YouTube's daily API limit has been reached for today. Quota automatically resets at midnight Pacific Time (PT). Please try again later.",
      isAuthExpired: false,
      isQuotaExceeded: true,
      isRateLimited: false,
    }
  }

  // 3. Check for Rate Limiting / 429
  if (
    statusCode === 429 ||
    lowerMsg.includes('ratelimit') ||
    lowerMsg.includes('rate limit') ||
    lowerMsg.includes('too many requests')
  ) {
    return {
      title: 'Rate Limit Reached',
      description: 'YouTube is receiving too many requests right now. Please wait a few moments before trying again.',
      isAuthExpired: false,
      isQuotaExceeded: false,
      isRateLimited: true,
    }
  }

  // 4. Check for comments disabled
  if (
    lowerMsg.includes('commentsdisabled') ||
    lowerMsg.includes('comments disabled') ||
    lowerMsg.includes('disabled comments')
  ) {
    return {
      title: 'Comments Disabled',
      description: 'Comments are disabled on this video on YouTube.',
      isAuthExpired: false,
      isQuotaExceeded: false,
      isRateLimited: false,
    }
  }

  // 5. Clean up ugly technical prefixes if present
  const cleanMessage = message
    .replace(/^Error:\s*/i, '')
    .replace(/^API error:\s*\d+\s*-?\s*/i, '')
    .replace(/^OAUTH_REFRESH_FAILED:\s*/i, '')
    .replace(/^QUOTA_EXCEEDED:\s*/i, '')
    .trim() || 'An unexpected error occurred. Please try again.'

  return {
    title: defaultTitle,
    description: cleanMessage,
    isAuthExpired: false,
    isQuotaExceeded: false,
    isRateLimited: false,
  }
}

/**
 * Displays a toast using Sonner with rich descriptions, actionable recovery buttons for
 * OAuth expired tokens, and extended durations for critical issues.
 */
export function showApiErrorToast(err: unknown, defaultTitle: string = 'Action Failed') {
  const parsed = parseApiError(err, defaultTitle)

  if (parsed.isAuthExpired && parsed.action) {
    toast.error(parsed.title, {
      description: parsed.description,
      action: {
        label: parsed.action.label,
        onClick: parsed.action.onClick,
      },
      duration: 12000,
    })
    return
  }

  if (parsed.isQuotaExceeded) {
    toast.error(parsed.title, {
      description: parsed.description,
      duration: 8000,
    })
    return
  }

  toast.error(parsed.title, {
    description: parsed.description,
  })
}

export function getFriendlyErrorMessage(err: unknown, defaultTitle: string = 'Action Failed'): string {
  const parsed = parseApiError(err, defaultTitle)
  return parsed.isAuthExpired || parsed.isQuotaExceeded
    ? `${parsed.title}: ${parsed.description}`
    : parsed.description
}
