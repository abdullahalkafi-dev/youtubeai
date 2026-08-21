import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
  Optional,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize, catchError } from 'rxjs/operators';
import { Request, Response } from 'express';
import { DevLogsService } from '../../dev-logs/dev-logs.service';

/**
 * Logs incoming requests and response times.
 * Asynchronously persists request logs to MongoDB via DevLogsService.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  constructor(
    @Optional()
    private readonly devLogsService?: DevLogsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpCtx = context.switchToHttp();
    const request = httpCtx.getRequest<Request>();
    const response = httpCtx.getResponse<Response>();

    const { method, url } = request;
    const now = Date.now();

    // Track start time on request object for exception filter
    (request as any)._startTime = now;

    return next.handle().pipe(
      finalize(() => {
        const elapsed = Date.now() - now;

        // Log to console
        if (elapsed > 5000) {
          this.logger.warn(`SLOW ${method} ${url} ${elapsed}ms`);
        } else {
          this.logger.log(`${method} ${url} ${elapsed}ms`);
        }

        // Avoid duplicate logging if already recorded by AllExceptionsFilter
        if ((request as any)._logged) {
          return;
        }

        // Skip logging dev log polling queries to prevent database flood
        const rawPath = request.path || url.split('?')[0];
        if (rawPath.startsWith('/api/dev/logs') && request.method === 'GET') {
          return;
        }

        // If response finished successfully, persist to MongoDB
        const statusCode = response.statusCode || 200;
        const user = (request as any).user;
        const userId = user?.id || user?._id?.toString() || null;
        const userEmail = user?.email || null;

        const ip =
          (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
          request.ip ||
          request.socket.remoteAddress ||
          null;

        const userAgent = request.get('user-agent') || null;

        if (this.devLogsService) {
          this.devLogsService
            .logRequest({
              method,
              url: request.originalUrl || url,
              path: rawPath,
              statusCode,
              level: statusCode >= 400 ? 'warn' : 'info',
              responseTimeMs: elapsed,
              requestQuery: request.query,
              requestBody: request.body,
              ip,
              userAgent,
              userId,
              userEmail,
            })
            .catch((err) => {
              this.logger.warn(`Failed to persist HTTP log: ${err.message}`);
            });
        }
      }),
      catchError((error) => {
        const elapsed = Date.now() - now;
        this.logger.error(
          `${method} ${url} ${elapsed}ms FAILED: ${error?.message || error}`,
        );
        throw error;
      }),
    );
  }
}
