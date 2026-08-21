export interface HttpLogItem {
  id: string;
  _id?: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | string;
  url: string;
  path: string;
  statusCode: number;
  level: 'error' | 'warn' | 'info';
  responseTimeMs: number;
  errorMessage?: string | null;
  errorStack?: string | null;
  errorName?: string | null;
  requestHeaders?: Record<string, unknown> | null;
  requestQuery?: Record<string, unknown> | null;
  requestBody?: Record<string, unknown> | string | null;
  responseBody?: Record<string, unknown> | string | null;
  ip?: string | null;
  userAgent?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface DailyTimelineItem {
  date: string;
  total: number;
  success: number;
  errors: number;
  serverErrors500: number;
  avgDuration: number;
}

export interface TopErrorEndpoint {
  path: string;
  method: string;
  count: number;
  serverErrors500: number;
  lastError?: string;
  lastOccurred: string;
  sampleStatusCode: number;
}

export interface StatusDistributionItem {
  statusCode: number;
  count: number;
}

export interface SlowestEndpoint {
  path: string;
  method: string;
  avgDuration: number;
  maxDuration: number;
  count: number;
}

export interface LogStatsResponse {
  summary: {
    totalRequests: number;
    totalErrors: number;
    total500Errors: number;
    totalSuccess: number;
    avgResponseTimeMs: number;
    errorRatePercentage: number;
    retentionPolicy: {
      errorDays: number;
      successDays: number;
    };
  };
  dailyTimeline: DailyTimelineItem[];
  topErrorEndpoints: TopErrorEndpoint[];
  statusDistribution: StatusDistributionItem[];
  slowestEndpoints: SlowestEndpoint[];
}

export interface PaginatedLogsResponse {
  logs: HttpLogItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface LogQueryParams {
  page?: number;
  limit?: number;
  level?: 'all' | 'error' | 'warn' | 'info';
  statusCode?: string;
  method?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  minDuration?: number;
  sort?: 'desc' | 'asc';
}
