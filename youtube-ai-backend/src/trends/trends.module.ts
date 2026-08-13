import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { TrendsService } from './trends.service';
import { TrendsController } from './trends.controller';
import { Channel, ChannelSchema } from '../mongo/schemas/channel.schema';
import { TrendingTopic, TrendingTopicSchema } from '../mongo/schemas/trending-topic.schema';
import { OpenAIModule } from '../openai/openai.module';
import { ChatModule } from '../chat/chat.module';
import { YouTubeModule } from '../youtube/youtube.module';
import { ChromaModule } from '../chroma/chroma.module';
import { CommonModule } from '../common/common.module';
import { QuotaModule } from '../quota/quota.module';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Channel.name, schema: ChannelSchema },
      { name: TrendingTopic.name, schema: TrendingTopicSchema },
    ]),
    OpenAIModule,
    forwardRef(() => ChatModule),
    YouTubeModule,
    ChromaModule,
    CommonModule,
    QuotaModule,
  ],
  controllers: [TrendsController],
  providers: [TrendsService],
  exports: [TrendsService],
})
export class TrendsModule {}
