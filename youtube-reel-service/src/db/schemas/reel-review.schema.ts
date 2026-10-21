import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export interface ReviewFinding {
  claim: string;
  evidence: string;
  sample: number;
  confidence: 'low' | 'medium' | 'high';
  action: string;
}

/** The weekly "what worked" review: written from the channel's own numbers, with the sample size behind every claim. */
@Schema({ timestamps: true, collection: 'reel_reviews' })
export class ReelReview {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) channelId: Types.ObjectId;
  /** Monday (New York) of the week the review was written. */
  @Prop({ required: true }) weekOf: string;
  @Prop({ type: Number, default: 0 }) posts: number;
  @Prop({ type: Boolean, default: false }) enoughData: boolean;
  @Prop() summary?: string;
  @Prop({ type: [Object], default: [] }) findings: ReviewFinding[];
  /** The tables the review was written from (so it can be checked). */
  @Prop({ type: Object }) tables?: Record<string, Array<{ key: string; posts: number; avgViews: number; avgViewPct: number | null }>>;
}
export type ReelReviewDocument = HydratedDocument<ReelReview>;
export const ReelReviewSchema = SchemaFactory.createForClass(ReelReview);
ReelReviewSchema.index({ channelId: 1, weekOf: -1 }, { unique: true });
