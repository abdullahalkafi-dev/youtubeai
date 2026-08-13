import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

/**
 * Global Redis module. Provides RedisService across the entire app.
 */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
