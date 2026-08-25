import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { MongooseModule } from '@nestjs/mongoose';
import configuration from './config/configuration';
import { validate } from './config/validation';
import { MongoModule } from './mongo/mongo.module';
import { ChromaModule } from './chroma/chroma.module';
import { VideoBackfillService } from './chroma/video-backfill.service';
import { RedisModule } from './redis/redis.module';
import { MinioModule } from './minio/minio.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ChannelsModule } from './channels/channels.module';
import { VideosModule } from './videos/videos.module';
import { OpenAIModule } from './openai/openai.module';
import { SeoModule } from './seo/seo.module';
import { ChatModule } from './chat/chat.module';
import { QueueModule } from './queue/queue.module';
import { YouTubeModule } from './youtube/youtube.module';
import { CommentsModule } from './comments/comments.module';
import { TrendsModule } from './trends/trends.module';
import { QuotaModule } from './quota/quota.module';
import { RevivalModule } from './revival/revival.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { KeywordsModule } from './keywords/keywords.module';
import { CompetitorsModule } from './competitors/competitors.module';
import { AssetsModule } from './assets/assets.module';
import { DevLogsModule } from './dev-logs/dev-logs.module';
import { AutomationModule } from './automation/automation.module';
import { Video, VideoSchema } from './mongo/schemas/video.schema';

/**
 * Root application module. Registers all feature modules,
 * global configuration, database, cache, and queue infrastructure.
 */
@Module({
  imports: [
    // Global configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate,
    }),

    // Scheduled tasks (cron)
    ScheduleModule.forRoot(),

    // Redis-backed Bull queue
    BullModule.forRootAsync({
      useFactory: (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL', 'redis://localhost:6379');
        const url = new URL(redisUrl);
        return {
          redis: {
            host: url.hostname,
            port: parseInt(url.port, 10) || 6379,
          },
        };
      },
      inject: [ConfigService],
    }),

    // Core infrastructure (global)
    MongoModule,
    ChromaModule,
    RedisModule,
    MinioModule,
    MongooseModule.forFeature([{ name: Video.name, schema: VideoSchema }]),

    // Feature modules
    AuthModule,
    UsersModule,
    ChannelsModule,
    VideosModule,
    OpenAIModule,
    YouTubeModule,
    SeoModule,
    ChatModule,
    QueueModule,
    AutomationModule,
    CommentsModule,
    TrendsModule,
    QuotaModule,
    RevivalModule,
    AnalyticsModule,
    KeywordsModule,
    CompetitorsModule,
    AssetsModule,
    DevLogsModule,
  ],
  providers: [VideoBackfillService],
})
export class AppModule {}
