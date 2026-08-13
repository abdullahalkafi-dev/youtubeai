import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';

export const SKIP_TRANSFORM_KEY = 'skipTransform';

export interface ResponseFormat<T> {
  data: T;
  message: string;
  success: boolean;
  timestamp: string;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  ResponseFormat<T>
> {
  constructor(private reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ResponseFormat<T>> {
    const skipTransform = this.reflector.getAllAndOverride<boolean>(
      SKIP_TRANSFORM_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (skipTransform) {
      return next.handle() as Observable<ResponseFormat<T>>;
    }

    return next.handle().pipe(
      map((data: T) => ({
        data,
        message: 'Success',
        success: true,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
