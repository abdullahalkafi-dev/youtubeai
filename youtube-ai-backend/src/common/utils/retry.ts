import { Logger } from '@nestjs/common';

const logger = new Logger('RetryUtil');

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  retryOn?: number[];
  operationName?: string;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  retryOn: [429, 500, 502, 503, 504],
  operationName: 'operation',
};

/**
 * Retry with exponential backoff for external API calls.
 * Handles 429 (rate limit), 5xx (server errors), and timeouts.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Determine if we should retry
      const statusCode =
        error?.status || error?.response?.status || error?.statusCode;
      const isRetryable =
        opts.retryOn.includes(statusCode) ||
        error?.code === 'ECONNRESET' ||
        error?.code === 'ETIMEDOUT';

      if (!isRetryable || attempt === opts.maxRetries) {
        throw error;
      }

      // Calculate delay with exponential backoff
      let delay = opts.baseDelay * Math.pow(opts.backoffMultiplier, attempt);

      // Respect Retry-After header for 429s
      if (statusCode === 429) {
        const retryAfter = error?.response?.headers?.['retry-after'];
        if (retryAfter) {
          const retryAfterMs = parseInt(retryAfter, 10) * 1000;
          if (!isNaN(retryAfterMs)) {
            delay = Math.max(delay, retryAfterMs);
          }
        }
      }

      // Cap at maxDelay
      delay = Math.min(delay, opts.maxDelay);

      logger.warn(
        `${opts.operationName} failed (attempt ${attempt + 1}/${opts.maxRetries + 1}): ${error?.message || error}. Retrying in ${delay}ms...`,
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Determine if an error is retryable.
 */
export function isRetryableError(error: any): boolean {
  const statusCode =
    error?.status || error?.response?.status || error?.statusCode;
  const retryableStatuses = [429, 500, 502, 503, 504];
  const retryableCodes = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'];

  return (
    retryableStatuses.includes(statusCode) ||
    retryableCodes.includes(error?.code)
  );
}
