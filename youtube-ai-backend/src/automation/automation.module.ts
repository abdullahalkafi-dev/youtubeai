import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AutomationBatch,
  AutomationBatchSchema,
} from '../mongo/schemas/automation-batch.schema';
import { Video, VideoSchema } from '../mongo/schemas/video.schema';
import { Channel, ChannelSchema } from '../mongo/schemas/channel.schema';
import {
  SeoVersion,
  SeoVersionSchema,
} from '../mongo/schemas/seo-version.schema';
import {
  SeoSuggestion,
  SeoSuggestionSchema,
} from '../mongo/schemas/seo-suggestion.schema';
import { User, UserSchema } from '../mongo/schemas/user.schema';
import { AutomationService } from './automation.service';
import { AutomationGateway } from './automation.gateway';
import { AutomationScheduler } from './automation.scheduler';
import { AutomationController } from './automation.controller';
import { SeoModule } from '../seo/seo.module';
import { YouTubeModule } from '../youtube/youtube.module';
import { QuotaModule } from '../quota/quota.module';
import { CommentsModule } from '../comments/comments.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AutomationBatch.name, schema: AutomationBatchSchema },
      { name: Video.name, schema: VideoSchema },
      { name: Channel.name, schema: ChannelSchema },
      { name: SeoVersion.name, schema: SeoVersionSchema },
      { name: SeoSuggestion.name, schema: SeoSuggestionSchema },
      { name: User.name, schema: UserSchema },
    ]),
    forwardRef(() => SeoModule),
    forwardRef(() => CommentsModule),
    YouTubeModule,
    QuotaModule,
  ],
  controllers: [AutomationController],
  providers: [AutomationService, AutomationGateway, AutomationScheduler],
  exports: [AutomationService, AutomationGateway],
})
export class AutomationModule {}
