import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChannelOwnershipGuard } from './guards/channel-ownership.guard';
import { Channel, ChannelSchema } from '../mongo/schemas/channel.schema';
import { Video, VideoSchema } from '../mongo/schemas/video.schema';
import { Thread, ThreadSchema } from '../mongo/schemas/thread.schema';
import { SeoSuggestion, SeoSuggestionSchema } from '../mongo/schemas/seo-suggestion.schema';
import { QueueItem, QueueItemSchema } from '../mongo/schemas/queue-item.schema';
import { SeoVersion, SeoVersionSchema } from '../mongo/schemas/seo-version.schema';
import { TrendingTopic, TrendingTopicSchema } from '../mongo/schemas/trending-topic.schema';
import { User, UserSchema } from '../mongo/schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Channel.name, schema: ChannelSchema },
      { name: Video.name, schema: VideoSchema },
      { name: Thread.name, schema: ThreadSchema },
      { name: SeoSuggestion.name, schema: SeoSuggestionSchema },
      { name: QueueItem.name, schema: QueueItemSchema },
      { name: SeoVersion.name, schema: SeoVersionSchema },
      { name: TrendingTopic.name, schema: TrendingTopicSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  providers: [ChannelOwnershipGuard],
  exports: [ChannelOwnershipGuard],
})
export class CommonModule {}
