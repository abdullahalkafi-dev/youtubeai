import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { YouTubeService } from './youtube.service';
import { YoutubeAnalyticsService } from './youtube-analytics.service';
import { YouTubeSuggestionsService } from './youtube-suggestions.service';
import { YouTubeTranscriptService } from './youtube-transcript.service';
import { QuotaModule } from '../quota/quota.module';
import { User, UserSchema } from '../mongo/schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    QuotaModule,
  ],
  providers: [YouTubeService, YoutubeAnalyticsService, YouTubeSuggestionsService, YouTubeTranscriptService],
  exports: [YouTubeService, YoutubeAnalyticsService, YouTubeSuggestionsService, YouTubeTranscriptService],
})
export class YouTubeModule {}
