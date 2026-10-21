import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppConfig, CONFIG } from '../config/config';
import { ReelCampaign, ReelCampaignSchema } from './schemas/reel-campaign.schema';
import { Reel, ReelSchema } from './schemas/reel.schema';
import { ReelSource, ReelSourceSchema } from './schemas/reel-source.schema';
import { ReelTranscript, ReelTranscriptSchema } from './schemas/reel-transcript.schema';
import { ReelMoment, ReelMomentSchema } from './schemas/reel-moment.schema';
import { ReelEntity, ReelEntitySchema, ReelSetting, ReelSettingSchema } from './schemas/reel-misc.schema';
import { ReelPost, ReelPostSchema } from './schemas/reel-post.schema';
import { ReelPostMetric, ReelPostMetricSchema } from './schemas/reel-post-metric.schema';
import { ReelCampaignChat, ReelCampaignChatSchema } from './schemas/reel-campaign-chat.schema';
import { ReelUpload, ReelUploadSchema } from './schemas/reel-upload.schema';
import { ReelDailyRun, ReelDailyRunSchema } from './schemas/reel-daily-run.schema';
import { ReelAutoDay, ReelAutoDaySchema } from './schemas/reel-autopublish.schema';
import { ReelSignal, ReelSignalSchema } from './schemas/reel-signal.schema';
import { ReelPillarSet, ReelPillarSetSchema, ReelVideoPillar, ReelVideoPillarSchema } from './schemas/reel-pillar.schema';
import {
  SharedChannel,
  SharedChannelSchema,
  SharedUser,
  SharedUserSchema,
  SharedVideoDailyStat,
  SharedVideoDailyStatSchema,
  SourceVideo,
  SourceVideoSchema,
} from './schemas/shared.readonly';

const models = MongooseModule.forFeature([
  { name: ReelCampaign.name, schema: ReelCampaignSchema },
  { name: Reel.name, schema: ReelSchema },
  { name: ReelSource.name, schema: ReelSourceSchema },
  { name: ReelTranscript.name, schema: ReelTranscriptSchema },
  { name: ReelMoment.name, schema: ReelMomentSchema },
  { name: ReelEntity.name, schema: ReelEntitySchema },
  { name: ReelSetting.name, schema: ReelSettingSchema },
  { name: ReelPost.name, schema: ReelPostSchema },
  { name: ReelPostMetric.name, schema: ReelPostMetricSchema },
  { name: ReelCampaignChat.name, schema: ReelCampaignChatSchema },
  { name: ReelUpload.name, schema: ReelUploadSchema },
  { name: ReelDailyRun.name, schema: ReelDailyRunSchema },
  { name: ReelPillarSet.name, schema: ReelPillarSetSchema },
  { name: ReelSignal.name, schema: ReelSignalSchema },
  { name: ReelAutoDay.name, schema: ReelAutoDaySchema },
  { name: ReelVideoPillar.name, schema: ReelVideoPillarSchema },
  { name: SourceVideo.name, schema: SourceVideoSchema },
  { name: SharedVideoDailyStat.name, schema: SharedVideoDailyStatSchema },
  { name: SharedChannel.name, schema: SharedChannelSchema },
  { name: SharedUser.name, schema: SharedUserSchema },
]);

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [CONFIG],
      useFactory: (cfg: AppConfig) => ({
        uri: cfg.MONGODB_URI,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 15_000,
        appName: 'reel-service',
      }),
    }),
    models,
  ],
  exports: [models],
})
export class DbModule {}
