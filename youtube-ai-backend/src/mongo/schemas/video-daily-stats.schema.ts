import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type VideoDailyStatsDocument = HydratedDocument<VideoDailyStats>;

/**
 * Daily per-video performance snapshot (one row per video per day).
 * Source: YouTube Reporting API daily report files (reach + basic).
 * Powers trend charts ("CTR climbing since the repackage") and daily-sync proof.
 */
@Schema({ timestamps: true, collection: 'video_daily_stats' })
export class VideoDailyStats {
  @Prop({ type: Types.ObjectId, ref: 'Video', required: true })
  videoId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Channel', required: true, index: true })
  channelId: Types.ObjectId;

  /** YYYY-MM-DD (UTC day of the report file) */
  @Prop({ required: true })
  date: string;

  @Prop({ default: 0 })
  views: number;

  @Prop({ default: 0 })
  impressions: number;

  /** CTR % for that day (undefined when impressions are too low to measure) */
  @Prop()
  ctr?: number;

  @Prop({ default: 0 })
  watchMinutes: number;

  @Prop()
  retentionPct?: number;

  @Prop({ default: 0 })
  likes: number;

  @Prop({ default: 0 })
  subsGained: number;
}

export const VideoDailyStatsSchema = SchemaFactory.createForClass(VideoDailyStats);
VideoDailyStatsSchema.index({ videoId: 1, date: 1 }, { unique: true });
VideoDailyStatsSchema.index({ channelId: 1, date: -1 });
