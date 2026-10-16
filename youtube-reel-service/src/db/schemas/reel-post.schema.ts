import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { NormalizedMetrics, PLATFORMS, POST_STATUSES, PlatformId, PostMetadata, PostStatus, Privacy } from '../../publishing/types';

/**
 * One row per (reel × platform × account × attempt): what we published where, its state, and its latest numbers.
 * Every post exists because a person pressed Publish (or recorded a manual post) — nothing is created automatically.
 */
@Schema({ timestamps: true, collection: 'reel_posts' })
export class ReelPost {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true }) reelId: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true }) campaignId: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true }) channelId: Types.ObjectId;
  @Prop({ type: String, enum: PLATFORMS, required: true }) platform: PlatformId;
  /** Platform-side account id (YouTube channel id). */
  @Prop() accountExternalId?: string;
  @Prop() accountName?: string;
  @Prop({ type: String, enum: ['api', 'manual'], default: 'api' }) source: 'api' | 'manual';
  @Prop({ type: String, enum: POST_STATUSES, default: 'queued', index: true }) status: PostStatus;

  @Prop({ type: Object }) metadata: PostMetadata;
  @Prop({ type: MongooseSchema.Types.ObjectId }) approvedBy?: Types.ObjectId;
  @Prop() approvedAt?: Date;

  @Prop() assetKey?: string;
  @Prop() assetSizeBytes?: number;
  /** Resumable-upload session: lets a crashed/retried job continue instead of uploading twice. */
  @Prop({ select: false }) uploadSessionUri?: string;
  @Prop({ default: 0 }) bytesUploaded: number;
  @Prop({ default: 0 }) attempts: number;
  @Prop({ default: false }) cancelRequested: boolean;

  @Prop() externalId?: string;
  @Prop() url?: string;
  @Prop() publishedAt?: Date;
  @Prop({ type: String }) requestedPrivacy?: Privacy;
  @Prop({ type: String }) actualPrivacy?: Privacy;
  @Prop({ type: [String], default: [] }) warnings: string[];
  @Prop() error?: string;
  @Prop() errorCode?: string;
  @Prop() blockedUntil?: Date;
  @Prop({ default: 0 }) unitsSpent: number;

  @Prop({ type: Object }) latestMetrics?: NormalizedMetrics & { capturedAt: Date; provisional?: boolean };
  @Prop() nextMetricsAt?: Date;
  @Prop({ default: 0 }) metricsCheckpoint: number;

  createdAt: Date;
  updatedAt: Date;
}
export type ReelPostDocument = HydratedDocument<ReelPost>;
export const ReelPostSchema = SchemaFactory.createForClass(ReelPost);
ReelPostSchema.index({ reelId: 1, createdAt: -1 });
ReelPostSchema.index({ channelId: 1, status: 1, createdAt: -1 });
ReelPostSchema.index({ status: 1, nextMetricsAt: 1 });
ReelPostSchema.index({ platform: 1, externalId: 1 }, { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } });
