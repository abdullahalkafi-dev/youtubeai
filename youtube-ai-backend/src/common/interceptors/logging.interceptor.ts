import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError, finalize } from 'rxjs/operators';
import { Request } from 'express';

/**
 * Logs incoming requests and their response times.
 * Also logs errors and slow requests.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, url } = request;
    const userAgent = request.get('user-agent') || '';
    const now = Date.now();

    return next.handle().pipe(
      finalize(() => {
        const elapsed = Date.now() - now;
        if (elapsed > 5000) {
          this.logger.warn(`SLOW ${method} ${url} ${elapsed}ms`);
        } else {
          this.logger.log(`${method} ${url} ${elapsed}ms`);
        }
      }),
      catchError((error) => {
        const elapsed = Date.now() - now;
        this.logger.error(`${method} ${url} ${elapsed}ms FAILED: ${error.message}`);
        throw error;
      }),
    );
  }
}
