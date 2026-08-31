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
    let errorCode: string | undefined = undefined;
    let requiresGoogleAuth: boolean | undefined = undefined;
    let rawErrorResponse: unknown = null;

    const exceptionAny = exception as any;
    const exMessage = exception instanceof Error ? exception.message : typeof exception === 'string' ? exception : '';
    const lowerExMsg = exMessage.toLowerCase();

    // Check for YouTube API Quota Exceeded
    const isQuotaExceeded =
      exceptionAny?.reason === 'quotaExceeded' ||
      exceptionAny?.code === 'QUOTA_EXCEEDED' ||
      exceptionAny?.name === 'QuotaExceededException' ||
      lowerExMsg.includes('quotaexceeded') ||
      lowerExMsg.includes('quota exceeded') ||
      lowerExMsg.includes('dailylimitexceeded') ||
      lowerExMsg.includes('exceeded your quota');

    // Check for YouTube OAuth Token Expiration / Missing Grant
    const isOAuthExpired =
      exceptionAny?.code === 'OAUTH_REFRESH_FAILED' ||
      exceptionAny?.code === 'OAUTH_NO_TOKEN' ||
      lowerExMsg.includes('oauth_refresh_failed') ||
      lowerExMsg.includes('oauth_no_token') ||
      lowerExMsg.includes('invalid_grant') ||
      lowerExMsg.includes('token expired') ||
      lowerExMsg.includes('re-login with google');

    if (isQuotaExceeded) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      errorCode = 'QUOTA_EXCEEDED';
      errorName = 'QuotaExceededException';
      message = 'YouTube API daily quota limit reached. Quota resets at midnight Pacific Time (PT).';
      rawErrorResponse = { error: errorCode, message };
    } else if (isOAuthExpired) {
      status = HttpStatus.UNAUTHORIZED;
      errorCode = 'OAUTH_REFRESH_FAILED';
      errorName = 'OAuthSessionExpiredException';
      requiresGoogleAuth = true;
      message = 'YouTube token expired or revoked. Please re-login with Google.';
      rawErrorResponse = { error: errorCode, message, requiresGoogleAuth: true };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      errorName = exception.name;
      const exResponse = exception.getResponse();
      rawErrorResponse = exResponse;
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
      rawErrorResponse = { error: exception.name, message: exception.message };
    } else if (typeof exception === 'string') {
      message = exception;
      rawErrorResponse = { message: exception };
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

    const errorPayload = {
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
      raw: rawErrorResponse,
    };

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
          requestHeaders: request.headers as Record<string, unknown>,
          requestQuery: request.query,
          requestBody: request.body,
          responseBody: errorPayload,
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
      code: errorCode,
      error: errorName,
      message,
      requiresGoogleAuth,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
