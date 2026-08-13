import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { CompetitorsService } from './competitors.service';
import { CompetitorsController } from './competitors.controller';
import { Channel, ChannelSchema } from '../mongo/schemas/channel.schema';
import { Video, VideoSchema } from '../mongo/schemas/video.schema';
import {
  CompetitorChannel,
  CompetitorChannelSchema,
} from '../mongo/schemas/competitor-channel.schema';
import { YouTubeModule } from '../youtube/youtube.module';
import { QuotaModule } from '../quota/quota.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Channel.name, schema: ChannelSchema },
      { name: Video.name, schema: VideoSchema },
      { name: CompetitorChannel.name, schema: CompetitorChannelSchema },
    ]),
    ScheduleModule,
    YouTubeModule,
    QuotaModule,
  ],
  controllers: [CompetitorsController],
  providers: [CompetitorsService],
  exports: [CompetitorsService],
})
export class CompetitorsModule {}
