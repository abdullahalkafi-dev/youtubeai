import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  Injectable,
  Optional,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { DevLogsService } from '../../dev-logs/dev-logs.service';

/**
 * Global exception filter. Catches all unhandled exceptions and returns
 * a consistent error response format while persisting full diagnostics to MongoDB.
 */
@Catch()
@Injectable()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(
    @Optional()
    private readonly devLogsService?: DevLogsService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errorName = 'InternalServerError';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      errorName = exception.name;
      const exResponse = exception.getResponse();
      if (typeof exResponse === 'string') {
        message = exResponse;
      } else if (typeof exResponse === 'object' && exResponse !== null) {
        const msg = (exResponse as Record<string, unknown>).message;
        // Handle validation error arrays (from ValidationPipe)
        if (Array.isArray(msg)) {
          message = msg.join('; ');
        } else if (typeof msg === 'string') {
          message = msg;
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      errorName = exception.name;
    } else if (typeof exception === 'string') {
      message = exception;
    }

    const stack = exception instanceof Error ? exception.stack : '';

    this.logger.error(
      `${request.method} ${request.url} ${status}: ${message}`,
      stack,
    );

    // Mark request as logged so LoggingInterceptor doesn't duplicate
    (request as any)._logged = true;

    // Calculate response time if start time was tracked
    const startTime = (request as any)._startTime || Date.now();
    const elapsed = Date.now() - startTime;

    // Extract user info if available (e.g. from passport jwt guard)
    const user = (request as any).user;
    const userId = user?.id || user?._id?.toString() || null;
    const userEmail = user?.email || null;

    const ip =
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      request.ip ||
      request.socket.remoteAddress ||
      null;

    const userAgent = request.get('user-agent') || null;

    // Persist full error diagnostic log to MongoDB asynchronously
    if (this.devLogsService) {
      this.devLogsService
        .logRequest({
          method: request.method,
          url: request.originalUrl || request.url,
          path: request.path || request.url.split('?')[0],
          statusCode: status,
          level: status >= 500 ? 'error' : 'warn',
          responseTimeMs: elapsed,
          errorMessage: message,
          errorStack: stack,
          errorName,
          requestQuery: request.query,
          requestBody: request.body,
          ip,
          userAgent,
          userId,
          userEmail,
        })
        .catch((err) => {
          this.logger.warn(`Failed to persist exception log: ${err.message}`);
        });
    }

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
