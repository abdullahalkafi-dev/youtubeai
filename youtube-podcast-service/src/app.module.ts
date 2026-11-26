import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { AppConfig, CONFIG, loadConfig } from './config';
import { BuzzsproutClient } from './buzzsprout/buzzsprout.client';
import {
  PodcastEpisode,
  PodcastEpisodeSchema,
  PodcastSetting,
  PodcastSettingSchema,
  ReelSettingView,
  ReelSettingViewSchema,
  ReelSourceView,
  ReelSourceViewSchema,
  SharedChannel,
  SharedChannelSchema,
  SharedUser,
  SharedUserSchema,
  SourceVideo,
  SourceVideoSchema,
} from './db/schemas';
import { StorageService } from './storage/storage.service';
import { AudioService } from './pipeline/audio.service';
import { BUZZSPROUT, EpisodeService } from './pipeline/episode.service';
import { PodcastAuthGuard } from './api/auth.guard';
import { PodcastController } from './api/podcast.controller';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      useFactory: () => ({ uri: loadConfig().MONGODB_URI, maxPoolSize: 5, serverSelectionTimeoutMS: 15_000, appName: 'podcast-service' }),
    }),
    MongooseModule.forFeature([
      { name: PodcastEpisode.name, schema: PodcastEpisodeSchema },
      { name: PodcastSetting.name, schema: PodcastSettingSchema },
      { name: SourceVideo.name, schema: SourceVideoSchema },
      { name: ReelSourceView.name, schema: ReelSourceViewSchema },
      { name: ReelSettingView.name, schema: ReelSettingViewSchema },
      { name: SharedChannel.name, schema: SharedChannelSchema },
      { name: SharedUser.name, schema: SharedUserSchema },
    ]),
    JwtModule.register({}),
  ],
  controllers: [PodcastController],
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    { provide: BUZZSPROUT, inject: [CONFIG], useFactory: (cfg: AppConfig) => new BuzzsproutClient({ apiKey: cfg.BUZZSPROUT_API_KEY, podcastId: cfg.BUZZSPROUT_PODCAST_ID }) },
    StorageService,
    AudioService,
    EpisodeService,
    PodcastAuthGuard,
  ],
})
export class AppModule {}
