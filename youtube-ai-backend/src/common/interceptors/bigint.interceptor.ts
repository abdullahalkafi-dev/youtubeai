import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

function bigintToNumber(obj: unknown, visited = new WeakSet()): unknown {
  if (typeof obj === 'bigint') return Number(obj);
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date || obj instanceof RegExp || Buffer.isBuffer(obj)) return obj;

  // Prevent infinite call-stack recursion on circular references
  if (visited.has(obj)) return obj;
  visited.add(obj);

  if (Array.isArray(obj)) {
    return obj.map((item) => bigintToNumber(item, visited));
  }

  // Handle Mongoose Document instances cleanly
  const targetObj = (typeof (obj as any).toObject === 'function')
    ? (obj as any).toObject()
    : obj;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(targetObj)) {
    if (key.startsWith('$') || key === '_doc') continue; // Skip Mongoose internal metadata
    result[key] = bigintToNumber(value, visited);
  }

  return result;
}

@Injectable()
export class BigIntInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(map((data) => bigintToNumber(data)));
  }
}
