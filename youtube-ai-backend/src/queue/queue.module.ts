import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { QueueService } from './queue.service';
import { QueueController } from './queue.controller';
import { Channel, ChannelSchema } from '../mongo/schemas/channel.schema';
import { QueueItem, QueueItemSchema } from '../mongo/schemas/queue-item.schema';
import { CommonModule } from '../common/common.module';
import { SeoModule } from '../seo/seo.module';
import { QuotaModule } from '../quota/quota.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Channel.name, schema: ChannelSchema },
      { name: QueueItem.name, schema: QueueItemSchema },
    ]),
    CommonModule,
    SeoModule,
    QuotaModule,
  ],
  controllers: [QueueController],
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}

