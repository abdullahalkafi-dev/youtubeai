import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { PLATFORMS, PlatformId } from '../../publishing/types';

/** Time series of a post's numbers, one snapshot per checkpoint (1h, 3h, 6h … 90d). */
@Schema({ timestamps: false, collection: 'reel_post_metrics' })
export class ReelPostMetric {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true }) postId: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true }) reelId: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true }) channelId: Types.ObjectId;
  @Prop({ type: String, enum: PLATFORMS, required: true }) platform: PlatformId;
  @Prop({ required: true }) capturedAt: Date;
  @Prop({ required: true }) ageHours: number;
  @Prop({ required: true }) checkpoint: string;
  @Prop({ default: 0 }) views: number;
  @Prop() likes?: number;
  @Prop() comments?: number;
  @Prop() shares?: number;
  @Prop() saves?: number;
  @Prop() watchMinutes?: number;
  @Prop() avgViewDurationSec?: number;
  @Prop() avgViewPct?: number;
  @Prop() engagedViews?: number;
  @Prop() subscribersGained?: number;
  @Prop() impressions?: number;
  @Prop() ctr?: number;
  @Prop({ default: false }) provisional: boolean;
  @Prop() source: string;
  @Prop() definition?: string;
  @Prop({ type: Object, select: false }) raw?: Record<string, unknown>;
}
export type ReelPostMetricDocument = HydratedDocument<ReelPostMetric>;
export const ReelPostMetricSchema = SchemaFactory.createForClass(ReelPostMetric);
ReelPostMetricSchema.index({ postId: 1, capturedAt: 1 });
ReelPostMetricSchema.index({ channelId: 1, capturedAt: -1 });
