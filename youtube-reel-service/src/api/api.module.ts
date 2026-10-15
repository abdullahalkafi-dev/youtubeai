import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CoreModule } from '../core.module';
import { ReelAuthGuard } from './auth.guard';
import { CampaignsController, HealthController, MediaController, StatusController } from './controllers';
import { ReelsApiService } from './reels-api.service';

@Module({
  imports: [CoreModule, JwtModule.register({})],
  controllers: [HealthController, StatusController, CampaignsController, MediaController],
  providers: [ReelsApiService, ReelAuthGuard],
})
export class ApiModule {}
