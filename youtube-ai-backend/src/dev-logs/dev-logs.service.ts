import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery } from 'mongoose';
import { HttpLog, HttpLogDocument } from '../mongo/schemas/http-log.schema';
import { QueryLogsDto } from './dto/query-logs.dto';

export interface CreateHttpLogDto {
  method: string;
  url: string;
  path: string;
  statusCode: number;
  level?: 'error' | 'warn' | 'info';
  responseTimeMs: number;
  errorMessage?: string | null;
  errorStack?: string | null;
  errorName?: string | null;
  requestQuery?: Record<string, unknown> | null;
  requestBody?: Record<string, unknown> | string | null;
  ip?: string | null;
  userAgent?: string | null;
  userId?: string | null;
  userEmail?: string | null;
}

@Injectable()
export class DevLogsService {
  private readonly logger = new Logger(DevLogsService.name);

  // Retention periods in milliseconds
  private readonly RETENTION_ERROR_MS = 14 * 24 * 60 * 60 * 1000; // 14 days for 4xx/5xx & errors
  private readonly RETENTION_SUCCESS_MS = 7 * 24 * 60 * 60 * 1000; // 7 days for 2xx/3xx successes

  constructor(
    @InjectModel(HttpLog.name)
    private readonly httpLogModel: Model<HttpLogDocument>,
  ) {}

  /**
   * Non-blocking persistent log writer.
   * Masks sensitive fields and calculates 14d (errors) vs 7d (success) TTL.
   */
  async logRequest(entry: CreateHttpLogDto): Promise<void> {
    try {
      const isError =
        entry.statusCode >= 400 ||
        entry.level === 'error' ||
        entry.level === 'warn';

      const retentionMs = isError
        ? this.RETENTION_ERROR_MS
        : this.RETENTION_SUCCESS_MS;
      const expiresAt = new Date(Date.now() + retentionMs);

      const level: 'error' | 'warn' | 'info' =
        entry.level ||
        (entry.statusCode >= 500
          ? 'error'
          : entry.statusCode >= 400
            ? 'warn'
            : 'info');

      // Sanitize sensitive fields from request body
      const sanitizedBody = this.sanitize(entry.requestBody);
      const sanitizedQuery = this.sanitize(entry.requestQuery);

      await this.httpLogModel.create({
        method: entry.method.toUpperCase(),
        url: entry.url,
        path: entry.path || entry.url.split('?')[0],
        statusCode: entry.statusCode,
        level,
        responseTimeMs: Math.round(entry.responseTimeMs || 0),
        errorMessage: entry.errorMessage || null,
        errorStack: entry.errorStack || null,
        errorName: entry.errorName || null,
        requestQuery: sanitizedQuery,
        requestBody: sanitizedBody,
        ip: entry.ip || null,
        userAgent: entry.userAgent || null,
        userId: entry.userId || null,
        userEmail: entry.userEmail || null,
        expiresAt,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to persist HTTP log to database: ${msg}`);
    }
  }

  /**
   * Retrieve paginated and filtered logs.
   */
  async getLogs(dto: QueryLogsDto) {
    const page = dto.page || 1;
    const limit = dto.limit || 50;
    const skip = (page - 1) * limit;

    const filter: FilterQuery<HttpLogDocument> = {};

    // Filter by Level
    if (dto.level && dto.level !== 'all') {
      filter.level = dto.level;
    }

    // Filter by Status Code
    if (dto.statusCode && dto.statusCode !== 'all') {
      const codeStr = dto.statusCode.toLowerCase();
      if (codeStr === '5xx' || codeStr === '500s') {
        filter.statusCode = { $gte: 500, $lte: 599 };
      } else if (codeStr === '4xx' || codeStr === '400s') {
        filter.statusCode = { $gte: 400, $lte: 499 };
      } else if (codeStr === '2xx' || codeStr === '200s') {
        filter.statusCode = { $gte: 200, $lte: 299 };
      } else if (codeStr === '3xx') {
        filter.statusCode = { $gte: 300, $lte: 399 };
      } else if (codeStr === 'errors') {
        filter.statusCode = { $gte: 400 };
      } else {
        const num = parseInt(dto.statusCode, 10);
        if (!isNaN(num)) {
          filter.statusCode = num;
        }
      }
    }

    // Filter by Method
    if (dto.method && dto.method !== 'all') {
      filter.method = dto.method.toUpperCase();
    }

    // Filter by Duration
    if (dto.minDuration !== undefined && dto.minDuration > 0) {
      filter.responseTimeMs = { $gte: dto.minDuration };
    }

    // Filter by Date Range
    if (dto.startDate || dto.endDate) {
      filter.createdAt = {};
      if (dto.startDate) {
        filter.createdAt.$gte = new Date(dto.startDate);
      }
      if (dto.endDate) {
        filter.createdAt.$lte = new Date(dto.endDate);
      }
    }

    // Multi-field Search
    if (dto.search && dto.search.trim().length > 0) {
      const term = dto.search.trim();
      const regex = new RegExp(this.escapeRegExp(term), 'i');

      const isNumeric = /^\d+$/.test(term);
      const searchConditions: Array<Record<string, unknown>> = [
        { url: regex },
        { path: regex },
        { errorMessage: regex },
        { errorStack: regex },
        { userEmail: regex },
        { ip: regex },
        { method: regex },
      ];

      if (isNumeric) {
        searchConditions.push({ statusCode: parseInt(term, 10) });
      }

      filter.$or = searchConditions;
    }

    const sortOrder = dto.sort === 'asc' ? 1 : -1;

    const [logs, total] = await Promise.all([
      this.httpLogModel
        .find(filter)
        .sort({ createdAt: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.httpLogModel.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      logs,
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Aggregated metrics and timeline stats for visual dashboards.
   */
  async getStats(days = 14) {
    const safeDays = Math.min(Math.max(days, 1), 90);
    const startDate = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);

    // 1. Overall counts
    const [overallCounts] = await this.httpLogModel.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: null,
          totalRequests: { $sum: 1 },
          totalErrors: {
            $sum: { $cond: [{ $gte: ['$statusCode', 400] }, 1, 0] },
          },
          total500Errors: {
            $sum: { $cond: [{ $gte: ['$statusCode', 500] }, 1, 0] },
          },
          totalSuccess: {
            $sum: { $cond: [{ $lt: ['$statusCode', 400] }, 1, 0] },
          },
          avgResponseTimeMs: { $avg: '$responseTimeMs' },
        },
      },
    ]);

    // 2. Daily timeline breakdown for chart (Errors vs Success)
    const dailyTimeline = await this.httpLogModel.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $project: {
          dateStr: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
          },
          statusCode: 1,
          responseTimeMs: 1,
        },
      },
      {
        $group: {
          _id: '$dateStr',
          total: { $sum: 1 },
          success: {
            $sum: { $cond: [{ $lt: ['$statusCode', 400] }, 1, 0] },
          },
          errors: {
            $sum: { $cond: [{ $gte: ['$statusCode', 400] }, 1, 0] },
          },
          serverErrors500: {
            $sum: { $cond: [{ $gte: ['$statusCode', 500] }, 1, 0] },
          },
          avgDuration: { $avg: '$responseTimeMs' },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          date: '$_id',
          total: 1,
          success: 1,
          errors: 1,
          serverErrors500: 1,
          avgDuration: { $round: ['$avgDuration', 0] },
        },
      },
    ]);

    // 3. Top Failing Endpoints
    const topErrorEndpoints = await this.httpLogModel.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          statusCode: { $gte: 400 },
        },
      },
      {
        $group: {
          _id: { path: '$path', method: '$method' },
          count: { $sum: 1 },
          serverErrors500: {
            $sum: { $cond: [{ $gte: ['$statusCode', 500] }, 1, 0] },
          },
          lastError: { $last: '$errorMessage' },
          lastOccurred: { $max: '$createdAt' },
          sampleStatusCode: { $last: '$statusCode' },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
      {
        $project: {
          path: '$_id.path',
          method: '$_id.method',
          count: 1,
          serverErrors500: 1,
          lastError: 1,
          lastOccurred: 1,
          sampleStatusCode: 1,
        },
      },
    ]);

    // 4. Status Code Breakdown
    const statusDistribution = await this.httpLogModel.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: '$statusCode',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      {
        $project: {
          statusCode: '$_id',
          count: 1,
        },
      },
    ]);

    // 5. Slowest Endpoints
    const slowestEndpoints = await this.httpLogModel.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: { path: '$path', method: '$method' },
          avgDuration: { $avg: '$responseTimeMs' },
          maxDuration: { $max: '$responseTimeMs' },
          count: { $sum: 1 },
        },
      },
      { $sort: { avgDuration: -1 } },
      { $limit: 8 },
      {
        $project: {
          path: '$_id.path',
          method: '$_id.method',
          avgDuration: { $round: ['$avgDuration', 0] },
          maxDuration: '$maxDuration',
          count: 1,
        },
      },
    ]);

    const totalRequests = overallCounts?.totalRequests || 0;
    const totalErrors = overallCounts?.totalErrors || 0;
    const total500Errors = overallCounts?.total500Errors || 0;
    const totalSuccess = overallCounts?.totalSuccess || 0;
    const avgResponseTimeMs = Math.round(
      overallCounts?.avgResponseTimeMs || 0,
    );
    const errorRatePercentage =
      totalRequests > 0
        ? parseFloat(((totalErrors / totalRequests) * 100).toFixed(2))
        : 0;

    return {
      summary: {
        totalRequests,
        totalErrors,
        total500Errors,
        totalSuccess,
        avgResponseTimeMs,
        errorRatePercentage,
        retentionPolicy: {
          errorDays: 14,
          successDays: 7,
        },
      },
      dailyTimeline,
      topErrorEndpoints,
      statusDistribution,
      slowestEndpoints,
    };
  }

  /**
   * Delete logs (all or older than X).
   */
  async clearLogs(filter?: { olderThanDays?: number; onlyErrors?: boolean }) {
    const query: FilterQuery<HttpLogDocument> = {};
    if (filter?.olderThanDays) {
      query.createdAt = {
        $lte: new Date(Date.now() - filter.olderThanDays * 24 * 60 * 60 * 1000),
      };
    }
    if (filter?.onlyErrors) {
      query.statusCode = { $gte: 400 };
    }
    const result = await this.httpLogModel.deleteMany(query);
    return { deletedCount: result.deletedCount };
  }

  /**
   * Helper to sanitize sensitive keys (passwords, tokens, secrets)
   */
  private sanitize(data: unknown): unknown {
    if (!data) return data;
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        return this.sanitize(parsed);
      } catch {
        return data.length > 500 ? `${data.slice(0, 500)}...[truncated]` : data;
      }
    }
    if (typeof data !== 'object') return data;

    if (Array.isArray(data)) {
      return data.slice(0, 20).map((item) => this.sanitize(item));
    }

    const sensitiveKeys = [
      'password',
      'pass',
      'token',
      'accesstoken',
      'access_token',
      'refreshtoken',
      'refresh_token',
      'secret',
      'apikey',
      'api_key',
      'authorization',
      'bearer',
    ];

    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some((s) => lowerKey.includes(s))) {
        sanitized[key] = '***MASKED***';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitize(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
