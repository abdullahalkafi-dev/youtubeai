export interface QuotaUsage {
  used: number
  limit: number
  breakdown: Record<string, number>
  /** Google's separate search.list bucket: 100 calls/day (not part of `limit` units). */
  search?: { used: number; limit: number }
}

export interface QuotaLog {
  id: string
  endpoint: string
  quotaCost: number
  relatedId: string | null
  success: boolean
  errorMessage: string | null
  calledAt: string
}
