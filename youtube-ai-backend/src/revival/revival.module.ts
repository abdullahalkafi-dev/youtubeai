import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { RevivalService } from './revival.service';
import { RevivalController } from './revival.controller';
import { Video, VideoSchema } from '../mongo/schemas/video.schema';
import { Channel, ChannelSchema } from '../mongo/schemas/channel.schema';
import { YouTubeModule } from '../youtube/youtube.module';
import { YouTubeSuggestionsService } from '../youtube/youtube-suggestions.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Video.name, schema: VideoSchema },
      { name: Channel.name, schema: ChannelSchema },
    ]),
    ScheduleModule,
    YouTubeModule,
  ],
  controllers: [RevivalController],
  providers: [RevivalService, YouTubeSuggestionsService],
  exports: [RevivalService],
})
export class RevivalModule {}
