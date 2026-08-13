import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * RedisService provides caching and pub/sub capabilities.
 * Uses ioredis for robust Redis connections with automatic reconnection.
 * All methods gracefully handle errors — callers get null/void instead of crashes.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.get<string>('REDIS_URL', 'redis://localhost:6379');
    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        return Math.min(times * 50, 2000);
      },
    });

    this.client.on('error', (err) => {
      this.logger.error('Redis connection error:', err.message);
    });

    this.client.on('connect', () => {
      this.logger.log('Redis connected successfully');
    });
  }

  async onModuleDestroy() {
    try {
      await this.client.quit();
    } catch (error) {
      this.logger.warn(`Redis quit failed: ${error.message}`);
    }
  }

  /** Get a value by key */
  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (error) {
      this.logger.warn(`Redis GET ${key} failed: ${error.message}`);
      return null;
    }
  }

  /** Set a key-value pair with optional TTL in seconds */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    try {
      if (ttlSeconds && ttlSeconds > 0) {
        await this.client.setex(key, ttlSeconds, value);
      } else {
        await this.client.set(key, value);
      }
    } catch (error) {
      this.logger.warn(`Redis SET ${key} failed: ${error.message}`);
    }
  }

  /** Delete a key */
  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (error) {
      this.logger.warn(`Redis DEL ${key} failed: ${error.message}`);
    }
  }

  /** Check if a key exists */
  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      this.logger.warn(`Redis EXISTS ${key} failed: ${error.message}`);
      return false;
    }
  }

  /** Increment a counter */
  async incr(key: string): Promise<number> {
    try {
      return await this.client.incr(key);
    } catch (error) {
      this.logger.warn(`Redis INCR ${key} failed: ${error.message}`);
      return 0;
    }
  }

  /** Set TTL on an existing key */
  async expire(key: string, seconds: number): Promise<void> {
    try {
      await this.client.expire(key, seconds);
    } catch (error) {
      this.logger.warn(`Redis EXPIRE ${key} failed: ${error.message}`);
    }
  }

  /** Get remaining TTL for a key */
  async ttl(key: string): Promise<number> {
    try {
      return await this.client.ttl(key);
    } catch (error) {
      this.logger.warn(`Redis TTL ${key} failed: ${error.message}`);
      return -1;
    }
  }

  /** Store JSON object or array */
  async setJson(
    key: string,
    value: any,
    ttlSeconds?: number,
  ): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  }

  /** Retrieve JSON object */
  async getJson<T = Record<string, unknown>>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
}
