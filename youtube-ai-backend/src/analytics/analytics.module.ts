import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AnalyticsController } from './analytics.controller';
import { Channel, ChannelSchema } from '../mongo/schemas/channel.schema';
import { YouTubeModule } from '../youtube/youtube.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Channel.name, schema: ChannelSchema }]),
    YouTubeModule,
  ],
  controllers: [AnalyticsController],
})
export class AnalyticsModule {}
