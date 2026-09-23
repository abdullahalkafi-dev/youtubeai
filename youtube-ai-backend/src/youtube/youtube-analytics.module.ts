import { Module } from '@nestjs/common';
import { YouTubeModule } from './youtube.module';

/**
 * Backward-compatible module — real providers live in YouTubeModule
 * (YoutubeAnalyticsService + PerformanceContextService).
 */
@Module({
  imports: [YouTubeModule],
  exports: [YouTubeModule],
})
export class YoutubeAnalyticsModule {}
