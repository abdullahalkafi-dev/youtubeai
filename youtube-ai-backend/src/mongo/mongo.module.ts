import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Schema } from 'mongoose';

import { User, UserSchema } from './schemas/user.schema';
import { Channel, ChannelSchema } from './schemas/channel.schema';
import { Video, VideoSchema } from './schemas/video.schema';
import { Thread, ThreadSchema } from './schemas/thread.schema';
import { SeoSuggestion, SeoSuggestionSchema } from './schemas/seo-suggestion.schema';
import { SeoVersion, SeoVersionSchema } from './schemas/seo-version.schema';
import { QueueItem, QueueItemSchema } from './schemas/queue-item.schema';
import { TrendingTopic, TrendingTopicSchema } from './schemas/trending-topic.schema';
import { TrendingIdea, TrendingIdeaSchema } from './schemas/trending-idea.schema';
import { AIOutputLog, AIOutputLogSchema } from './schemas/ai-output-log.schema';
import { ApiQuotaLog, ApiQuotaLogSchema } from './schemas/api-quota-log.schema';
import { SearchListQuota, SearchListQuotaSchema } from './schemas/search-list-quota.schema';
import { TokenUsageDaily, TokenUsageDailySchema } from './schemas/token-usage-daily.schema';
import { SyncLog, SyncLogSchema } from './schemas/sync-log.schema';
import { HttpLog, HttpLogSchema } from './schemas/http-log.schema';

function addVirtualId(schema: Schema) {
  schema.set('toJSON', {
    virtuals: true,
    transform: (_doc: any, ret: any) => {
      if (ret._id) {
        ret.id = ret._id.toString();
      }
      delete ret.__v;
      return ret;
    },
  });
  schema.set('toObject', {
    virtuals: true,
    transform: (_doc: any, ret: any) => {
      if (ret._id) {
        ret.id = ret._id.toString();
      }
      delete ret.__v;
      return ret;
    },
  });
}

const schemas = [
  UserSchema, ChannelSchema, VideoSchema, ThreadSchema,
  SeoSuggestionSchema, SeoVersionSchema, QueueItemSchema,
  TrendingTopicSchema, TrendingIdeaSchema, AIOutputLogSchema,
  ApiQuotaLogSchema, SearchListQuotaSchema, TokenUsageDailySchema,
  SyncLogSchema, HttpLogSchema,
];
schemas.forEach(addVirtualId);

const modelImports = MongooseModule.forFeature([
  { name: User.name, schema: UserSchema },
  { name: Channel.name, schema: ChannelSchema },
  { name: Video.name, schema: VideoSchema },
  { name: Thread.name, schema: ThreadSchema },
  { name: SeoSuggestion.name, schema: SeoSuggestionSchema },
  { name: SeoVersion.name, schema: SeoVersionSchema },
  { name: QueueItem.name, schema: QueueItemSchema },
  { name: TrendingTopic.name, schema: TrendingTopicSchema },
  { name: TrendingIdea.name, schema: TrendingIdeaSchema },
  { name: AIOutputLog.name, schema: AIOutputLogSchema },
  { name: ApiQuotaLog.name, schema: ApiQuotaLogSchema },
  { name: SearchListQuota.name, schema: SearchListQuotaSchema },
  { name: TokenUsageDaily.name, schema: TokenUsageDailySchema },
  { name: SyncLog.name, schema: SyncLogSchema },
  { name: HttpLog.name, schema: HttpLogSchema },
]);

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI', 'mongodb://admin:password@localhost:27017/youtube_ai?authSource=admin'),
      }),
      inject: [ConfigService],
    }),
    modelImports,
  ],
  exports: [modelImports],
})
export class MongoModule {}
