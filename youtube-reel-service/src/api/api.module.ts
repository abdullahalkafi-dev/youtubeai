import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CoreModule } from '../core.module';
import { ReelAuthGuard } from './auth.guard';
import { CampaignsController, HealthController, MediaController, StatusController } from './controllers';
import { PublishingController } from './publishing.controller';
import { CampaignChatService } from './campaign-chat.service';
import { ReelsApiService } from './reels-api.service';
import { UploadsController } from './uploads.controller';
import { DailyController } from './daily.controller';
import { UploadsService } from './uploads.service';

@Module({
  imports: [CoreModule, JwtModule.register({})],
  controllers: [HealthController, StatusController, CampaignsController, PublishingController, UploadsController, DailyController, MediaController],
  providers: [ReelsApiService, CampaignChatService, UploadsService, ReelAuthGuard],
})
export class ApiModule {}
