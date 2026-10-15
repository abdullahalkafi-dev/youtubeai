import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export const MOMENT_TYPES = [
  'story',
  'punchline',
  'hard_rule',
  'contrarian_take',
  'warning',
  'psych_breakdown',
  'confession',
  'list',
] as const;
export type MomentType = (typeof MOMENT_TYPES)[number];

/**
 * The "moment bank": every reel-worthy passage mined from a video is kept,
 * so later campaigns reuse unused material instead of re-mining or repeating.
 */
@Schema({ timestamps: true, collection: 'reel_moments' })
export class ReelMoment {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true }) channelId: Types.ObjectId;
  @Prop({ required: true, index: true }) youtubeId: string;
  @Prop({ type: MongooseSchema.Types.ObjectId }) videoId?: Types.ObjectId;
  @Prop({ required: true }) promptVersion: string;

  @Prop({ required: true }) startLine: number;
  @Prop({ required: true }) endLine: number;
  @Prop({ required: true }) start: number;
  @Prop({ required: true }) end: number;

  @Prop() title: string;
  @Prop({ type: String, enum: MOMENT_TYPES }) type: MomentType;
  @Prop() summary: string;
  @Prop() whyItWorks: string;
  @Prop({ type: [Number], default: [] }) hookLines: number[];
  @Prop() payoffLine: number;
  @Prop() standalone: number;
  @Prop() intensity: number;
  @Prop() contextNeeded?: string;
  @Prop({ type: [String], default: [] }) entityNames: string[];
  @Prop({ type: [String], default: [], index: true }) entitySlugs: string[];
  @Prop({ type: [String], default: [] }) themes: string[];

  @Prop({ type: String, enum: ['unused', 'used', 'retired'], default: 'unused', index: true })
  status: 'unused' | 'used' | 'retired';
  @Prop({ type: [MongooseSchema.Types.ObjectId], default: [] }) usedByReelIds: Types.ObjectId[];
  @Prop() lastUsedAt?: Date;
  @Prop({ default: 0 }) rejectedCount: number;
  @Prop({ type: [Number], select: false }) embedding?: number[];

  createdAt: Date;
  updatedAt: Date;
}
export type ReelMomentDocument = HydratedDocument<ReelMoment>;
export const ReelMomentSchema = SchemaFactory.createForClass(ReelMoment);
ReelMomentSchema.index({ channelId: 1, status: 1, standalone: -1 });
ReelMomentSchema.index({ youtubeId: 1, promptVersion: 1 });
