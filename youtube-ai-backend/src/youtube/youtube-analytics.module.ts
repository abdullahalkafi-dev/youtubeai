import { Module } from '@nestjs/common';
import { YoutubeAnalyticsService } from './youtube-analytics.service';
import { YouTubeModule } from './youtube.module';
import { QuotaModule } from '../quota/quota.module';

@Module({
  imports: [YouTubeModule, QuotaModule],
  providers: [YoutubeAnalyticsService],
  exports: [YoutubeAnalyticsService],
})
export class YoutubeAnalyticsModule {}
