import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

/** One record per channel per New York day: what the nightly automatic campaign chose (or why it skipped). */
@Schema({ timestamps: true, collection: 'reel_daily_runs' })
export class ReelDailyRun {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) channelId: Types.ObjectId;
  /** YYYY-MM-DD in America/New_York. */
  @Prop({ required: true }) date: string;
  @Prop({ type: String, enum: ['running', 'started', 'skipped', 'failed'], required: true }) status: 'running' | 'started' | 'skipped' | 'failed';
  @Prop({ type: String, enum: ['schedule', 'manual'], default: 'schedule' }) trigger: 'schedule' | 'manual';
  @Prop({ type: Object }) topic?: { name: string; brief: string; why: string; signal: string; keywords: string[] };
  @Prop({ type: Object }) evidence?: { moments: number; videos: number };
  @Prop({ type: [Object], default: [] }) candidates: Array<{ name: string; signal: string; moments: number; videos: number; score: number }>;
  @Prop({ type: MongooseSchema.Types.ObjectId }) campaignId?: Types.ObjectId;
  @Prop() reason?: string;
  @Prop({ default: 1 }) attempts: number;
}
export type ReelDailyRunDocument = HydratedDocument<ReelDailyRun>;
export const ReelDailyRunSchema = SchemaFactory.createForClass(ReelDailyRun);
ReelDailyRunSchema.index({ channelId: 1, date: 1 }, { unique: true });
