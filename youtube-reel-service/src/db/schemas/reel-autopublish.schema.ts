import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export interface AutoDayItem {
  reelId: Types.ObjectId;
  postId: Types.ObjectId;
  slot: string;
  runAt: Date;
  score: number | null;
  track: 'main' | 'explore';
  title: string;
}

/**
 * One document per channel per New York day: what auto-publish decided for that day's reels (which went out at which slot,
 * which were held back and why). The slot results are what the timing learning is computed from.
 */
@Schema({ timestamps: true, collection: 'reel_autopublish_days' })
export class ReelAutoDay {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) channelId: Types.ObjectId;
  @Prop({ required: true }) date: string;
  @Prop({ type: String, enum: ['planning', 'planned', 'skipped'], required: true }) status: 'planning' | 'planned' | 'skipped';
  @Prop() reason?: string;
  /** rotation = random slot order (fair test of each slot); bandit = learned preference with an exploration floor. */
  @Prop({ type: String, enum: ['rotation', 'bandit'], default: 'rotation' }) mode: 'rotation' | 'bandit';
  @Prop({ type: [Object], default: [] }) items: AutoDayItem[];
  @Prop({ type: [Object], default: [] }) held: Array<{ reelId: Types.ObjectId; title: string; reason: string }>;
}
export type ReelAutoDayDocument = HydratedDocument<ReelAutoDay>;
export const ReelAutoDaySchema = SchemaFactory.createForClass(ReelAutoDay);
ReelAutoDaySchema.index({ channelId: 1, date: 1 }, { unique: true });
