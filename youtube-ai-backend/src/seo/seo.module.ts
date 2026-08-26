import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SeoService } from './seo.service';
import { SeoController } from './seo.controller';
import { Video, VideoSchema } from '../mongo/schemas/video.schema';
import { Channel, ChannelSchema } from '../mongo/schemas/channel.schema';
import { SeoSuggestion, SeoSuggestionSchema } from '../mongo/schemas/seo-suggestion.schema';
import { SeoVersion, SeoVersionSchema } from '../mongo/schemas/seo-version.schema';
import { TrendingTopic, TrendingTopicSchema } from '../mongo/schemas/trending-topic.schema';
import { User, UserSchema } from '../mongo/schemas/user.schema';
import { OpenAIModule } from '../openai/openai.module';
import { YouTubeModule } from '../youtube/youtube.module';
import { QuotaModule } from '../quota/quota.module';
import { ChromaModule } from '../chroma/chroma.module';
import { CommonModule } from '../common/common.module';
import { AutomationModule } from '../automation/automation.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Video.name, schema: VideoSchema },
      { name: Channel.name, schema: ChannelSchema },
      { name: SeoSuggestion.name, schema: SeoSuggestionSchema },
      { name: SeoVersion.name, schema: SeoVersionSchema },
      { name: TrendingTopic.name, schema: TrendingTopicSchema },
      { name: User.name, schema: UserSchema },
    ]),
    OpenAIModule,
    YouTubeModule,
    QuotaModule,
    ChromaModule,
    CommonModule,
    forwardRef(() => AutomationModule),
  ],
  controllers: [SeoController],
  providers: [SeoService],
  exports: [SeoService],
})
export class SeoModule {}
