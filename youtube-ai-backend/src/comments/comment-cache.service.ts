import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

const CACHE_TTL = 3600; // 1 hour in seconds

/**
 * Redis-based cache for YouTube comments.
 * Comments are ephemeral and high-volume — Redis is more appropriate than DB.
 */
@Injectable()
export class CommentCacheService {
  private readonly logger = new Logger(CommentCacheService.name);

  constructor(private readonly redis: RedisService) {}

  private threadsKey(videoId: string, order: string = 'relevance'): string {
    return `comments:video:${videoId}:threads:${order}`;
  }

  private repliesKey(videoId: string, parentId: string): string {
    return `comments:video:${videoId}:replies:${parentId}`;
  }

  private metaKey(videoId: string): string {
    return `comments:video:${videoId}:meta`;
  }

  async getThreads(videoId: string, order: string = 'relevance'): Promise<any[] | null> {
    try {
      const data = await this.redis.get(this.threadsKey(videoId, order));
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  async setThreads(videoId: string, comments: any[], order: string = 'relevance'): Promise<void> {
    try {
      await this.redis.set(
        this.threadsKey(videoId, order),
        JSON.stringify(comments),
        CACHE_TTL,
      );
    } catch (error) {
      this.logger.error(
        `Failed to cache threads for video ${videoId}: ${error.message}`,
      );
    }
  }

  async getReplies(videoId: string, parentId: string): Promise<any[] | null> {
    try {
      const data = await this.redis.get(this.repliesKey(videoId, parentId));
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  async setReplies(
    videoId: string,
    parentId: string,
    replies: any[],
  ): Promise<void> {
    try {
      await this.redis.set(
        this.repliesKey(videoId, parentId),
        JSON.stringify(replies),
        CACHE_TTL,
      );
    } catch (error) {
      this.logger.error(
        `Failed to cache replies for parent ${parentId}: ${error.message}`,
      );
    }
  }

  async getMeta(
    videoId: string,
  ): Promise<{ totalCount: number; commentsDisabled: boolean } | null> {
    try {
      const data = await this.redis.get(this.metaKey(videoId));
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  async setMeta(
    videoId: string,
    meta: { totalCount: number; commentsDisabled: boolean },
  ): Promise<void> {
    try {
      await this.redis.set(
        this.metaKey(videoId),
        JSON.stringify(meta),
        CACHE_TTL,
      );
    } catch (error) {
      this.logger.error(
        `Failed to cache meta for video ${videoId}: ${error.message}`,
      );
    }
  }

  async invalidate(videoId: string): Promise<void> {
    try {
      await this.redis.del(this.threadsKey(videoId, 'relevance'));
      await this.redis.del(this.threadsKey(videoId, 'time'));
      await this.redis.del(this.metaKey(videoId));
    } catch (error) {
      this.logger.error(
        `Failed to invalidate cache for video ${videoId}: ${error.message}`,
      );
    }
  }
}
