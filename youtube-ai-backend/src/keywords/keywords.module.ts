import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { KeywordsService } from './keywords.service';
import { KeywordsController } from './keywords.controller';
import { Channel, ChannelSchema } from '../mongo/schemas/channel.schema';
import { YouTubeModule } from '../youtube/youtube.module';
import { QuotaModule } from '../quota/quota.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Channel.name, schema: ChannelSchema }]),
    YouTubeModule,
    QuotaModule,
  ],
  controllers: [KeywordsController],
  providers: [KeywordsService],
  exports: [KeywordsService],
})
export class KeywordsModule {}
