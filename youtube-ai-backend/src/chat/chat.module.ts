import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { Thread, ThreadSchema } from '../mongo/schemas/thread.schema';
import { Channel, ChannelSchema } from '../mongo/schemas/channel.schema';
import { User, UserSchema } from '../mongo/schemas/user.schema';
import { AIOutputLog, AIOutputLogSchema } from '../mongo/schemas/ai-output-log.schema';
import { Video, VideoSchema } from '../mongo/schemas/video.schema';
import { TrendingTopic, TrendingTopicSchema } from '../mongo/schemas/trending-topic.schema';
import { SeoSuggestion, SeoSuggestionSchema } from '../mongo/schemas/seo-suggestion.schema';
import { CompetitorChannel, CompetitorChannelSchema } from '../mongo/schemas/competitor-channel.schema';
import { OpenAIModule } from '../openai/openai.module';
import { MinioModule } from '../minio/minio.module';
import { ChromaModule } from '../chroma/chroma.module';
import { CommonModule } from '../common/common.module';
import { YouTubeModule } from '../youtube/youtube.module';
import { SkillRegistry } from './skills/skill-registry';
import { TrendsModule } from '../trends/trends.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Thread.name, schema: ThreadSchema },
      { name: Channel.name, schema: ChannelSchema },
      { name: User.name, schema: UserSchema },
      { name: AIOutputLog.name, schema: AIOutputLogSchema },
      { name: Video.name, schema: VideoSchema },
      { name: TrendingTopic.name, schema: TrendingTopicSchema },
      { name: SeoSuggestion.name, schema: SeoSuggestionSchema },
      { name: CompetitorChannel.name, schema: CompetitorChannelSchema },
    ]),
    OpenAIModule,
    MinioModule,
    ChromaModule,
    CommonModule,
    YouTubeModule,
    forwardRef(() => TrendsModule),
  ],
  controllers: [ChatController],
  providers: [ChatService, SkillRegistry],
  exports: [ChatService],
})
export class ChatModule {}
