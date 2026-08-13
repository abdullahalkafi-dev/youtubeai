import { Module } from '@nestjs/common';
import { YoutubeAnalyticsService } from './youtube-analytics.service';
import { YouTubeModule } from './youtube.module';

@Module({
  imports: [YouTubeModule],
  providers: [YoutubeAnalyticsService],
  exports: [YoutubeAnalyticsService],
})
export class YoutubeAnalyticsModule {}
