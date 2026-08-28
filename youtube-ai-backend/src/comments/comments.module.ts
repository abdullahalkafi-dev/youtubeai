import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CommentsService } from './comments.service';
import { CommentCacheService } from './comment-cache.service';
import { CommentsController } from './comments.controller';
import { YouTubeModule } from '../youtube/youtube.module';
import { QuotaModule } from '../quota/quota.module';
import { OpenAIModule } from '../openai/openai.module';
import { CommonModule } from '../common/common.module';
import { Video, VideoSchema } from '../mongo/schemas/video.schema';
import { Channel, ChannelSchema } from '../mongo/schemas/channel.schema';
import { AutomationBatch, AutomationBatchSchema } from '../mongo/schemas/automation-batch.schema';
import { User, UserSchema } from '../mongo/schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Video.name, schema: VideoSchema },
      { name: Channel.name, schema: ChannelSchema },
      { name: AutomationBatch.name, schema: AutomationBatchSchema },
      { name: User.name, schema: UserSchema },
    ]),
    YouTubeModule,
    QuotaModule,
    OpenAIModule,
    CommonModule,
  ],
  controllers: [CommentsController],
  providers: [CommentsService, CommentCacheService],
  exports: [CommentsService],
})
export class CommentsModule {}

