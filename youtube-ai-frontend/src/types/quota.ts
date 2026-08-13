export interface QuotaUsage {
  used: number
  limit: number
  breakdown: Record<string, number>
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
