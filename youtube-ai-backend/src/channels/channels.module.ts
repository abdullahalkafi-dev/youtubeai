import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChannelsService } from './channels.service';
import { ChannelsController } from './channels.controller';
import { Channel, ChannelSchema } from '../mongo/schemas/channel.schema';
import { User, UserSchema } from '../mongo/schemas/user.schema';
import { Video, VideoSchema } from '../mongo/schemas/video.schema';
import { SyncLog, SyncLogSchema } from '../mongo/schemas/sync-log.schema';
import { SeoVersion, SeoVersionSchema } from '../mongo/schemas/seo-version.schema';
import { YouTubeModule } from '../youtube/youtube.module';
import { YoutubeAnalyticsModule } from '../youtube/youtube-analytics.module';
import { QuotaModule } from '../quota/quota.module';
import { ChromaModule } from '../chroma/chroma.module';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Channel.name, schema: ChannelSchema },
      { name: Video.name, schema: VideoSchema },
      { name: SyncLog.name, schema: SyncLogSchema },
      { name: SeoVersion.name, schema: SeoVersionSchema },
      { name: User.name, schema: UserSchema },
    ]),
    YouTubeModule,
    YoutubeAnalyticsModule,
    QuotaModule,
    ChromaModule,
    CommonModule,
  ],
  controllers: [ChannelsController],
  providers: [ChannelsService],
  exports: [ChannelsService],
})
export class ChannelsModule {}
