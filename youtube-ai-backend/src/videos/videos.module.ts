import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { VideosService } from './videos.service';
import { VideosController } from './videos.controller';
import { Video, VideoSchema } from '../mongo/schemas/video.schema';
import { SeoVersion, SeoVersionSchema } from '../mongo/schemas/seo-version.schema';
import { YoutubeAnalyticsModule } from '../youtube/youtube-analytics.module';
import { YouTubeModule } from '../youtube/youtube.module';
import { ChromaModule } from '../chroma/chroma.module';
import { CommonModule } from '../common/common.module';
import { QuotaModule } from '../quota/quota.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Video.name, schema: VideoSchema },
      { name: SeoVersion.name, schema: SeoVersionSchema },
    ]),
    YoutubeAnalyticsModule,
    YouTubeModule,
    ChromaModule,
    CommonModule,
    QuotaModule,
  ],
  controllers: [VideosController],
  providers: [VideosService],
  exports: [VideosService],
})
export class VideosModule {}
