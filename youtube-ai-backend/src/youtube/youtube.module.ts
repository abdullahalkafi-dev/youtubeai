import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { YouTubeService } from './youtube.service';
import { YoutubeAnalyticsService } from './youtube-analytics.service';
import { YoutubeReportingService } from './youtube-reporting.service';
import { PerformanceContextService } from './performance-context.service';
import { YouTubeSuggestionsService } from './youtube-suggestions.service';
import { YouTubeTranscriptService } from './youtube-transcript.service';
import { LocalNewsService } from './local-news.service';
import { QuotaModule } from '../quota/quota.module';
import { User, UserSchema } from '../mongo/schemas/user.schema';
import { Video, VideoSchema } from '../mongo/schemas/video.schema';
import { Channel, ChannelSchema } from '../mongo/schemas/channel.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Video.name, schema: VideoSchema },
      { name: Channel.name, schema: ChannelSchema },
    ]),
    QuotaModule,
  ],
  providers: [
    YouTubeService,
    YoutubeAnalyticsService,
    YoutubeReportingService,
    PerformanceContextService,
    YouTubeSuggestionsService,
    YouTubeTranscriptService,
    LocalNewsService,
  ],
  exports: [
    YouTubeService,
    YoutubeAnalyticsService,
    YoutubeReportingService,
    PerformanceContextService,
    YouTubeSuggestionsService,
    YouTubeTranscriptService,
    LocalNewsService,
  ],
})
export class YouTubeModule {}
