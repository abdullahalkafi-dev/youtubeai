import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ChannelDocument = HydratedDocument<Channel>;

@Schema({ timestamps: true, collection: 'channels' })
export class Channel {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ unique: true, sparse: true })
  youtubeChannelId?: string;

  @Prop({ required: true })
  name: string;

  @Prop()
  handle?: string;

  @Prop()
  avatarUrl?: string;

  @Prop()
  description?: string;

  @Prop({ default: 0 })
  subscriberCount: number;

  @Prop({ default: 0 })
  totalVideos: number;

  @Prop({ default: 0 })
  totalViews: number;

  @Prop({ default: 0 })
  totalWatchHours: number;

  @Prop({ default: 0 })
  estimatedRevenue: number;

  @Prop()
  joinedDate?: Date;

  @Prop()
  country?: string;

  @Prop({
    type: {
      dailyUpdateCap: { type: Number, default: 15 },
      cronInterval: { type: Number, default: 5 },
      autoPauseAtLimit: { type: Boolean, default: true },
      autoResumeAtMidnight: { type: Boolean, default: true },
    },
    default: () => ({
      dailyUpdateCap: 15,
      cronInterval: 5,
      autoPauseAtLimit: true,
      autoResumeAtMidnight: true,
    }),
  })
  seoSettings: {
    dailyUpdateCap: number;
    cronInterval: number;
    autoPauseAtLimit: boolean;
    autoResumeAtMidnight: boolean;
  };

  @Prop()
  openaiApiKey?: string;

  @Prop()
  youtubeApiKey?: string;

  // Batch Automation Concurrency & Heartbeat Lock
  @Prop({ default: false })
  isBatchRunning: boolean;

  @Prop({ type: Types.ObjectId, ref: 'AutomationBatch', sparse: true })
  activeBatchId?: Types.ObjectId;

  @Prop()
  batchStartedAt?: Date;

  @Prop()
  lastBatchHeartbeatAt?: Date;

  // Daily performance sync (PerformanceSyncService) — proves the system is live-synced with YouTube
  @Prop({ type: Object })
  audienceProfile?: {
    ageGroups?: Array<{ label: string; sharePct: number }>;
    genderSplit?: Array<{ label: string; sharePct: number }>;
    windowDays?: number;
    syncedAt?: Date;
  };

  @Prop({ type: Object })
  performanceSync?: {
    lastRunAt?: Date;
    windowDays?: number;
    videosUpdated?: number;
    snapshotRows?: number;
    filesUsed?: number;
    durationMs?: number;
    errors?: string[];
    nextRunAt?: Date;
    source?: string;
  };
}

export const ChannelSchema = SchemaFactory.createForClass(Channel);
