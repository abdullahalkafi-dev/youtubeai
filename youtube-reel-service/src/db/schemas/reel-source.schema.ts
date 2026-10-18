import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export const SOURCE_STAGES = [
  'queued',
  'downloading',
  'downloaded',
  'transcribing',
  'mining',
  'ready',
  'blocked', // waiting for YouTube re-login
  'failed',
] as const;
export type SourceStage = (typeof SOURCE_STAGES)[number];

/** One record per YouTube video, shared by every campaign (download/transcribe/mine once). */
@Schema({ timestamps: true, collection: 'reel_sources' })
export class ReelSource {
  @Prop({ required: true, unique: true }) youtubeId: string;
  /** youtube: a catalog video (re-downloadable); upload: a raw file the client sent (never evicted). */
  @Prop({ type: String, enum: ['youtube', 'upload'], default: 'youtube' }) kind: 'youtube' | 'upload';
  /** Uploads only: where the raw original sits until it is cleaned up. */
  @Prop() rawPath?: string;
  /** Uploads only: the YouTube video this upload became, once the client links it. */
  @Prop() linkedYoutubeId?: string;
  @Prop({ type: MongooseSchema.Types.ObjectId }) videoId?: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, index: true }) channelId?: Types.ObjectId;
  @Prop() title?: string;
  @Prop({ type: String, enum: SOURCE_STAGES, default: 'queued', index: true }) stage: SourceStage;

  @Prop() videoKey?: string;
  @Prop() audioKey?: string;
  /** False after the cached source video was evicted from MinIO (transcript + moments are kept). */
  @Prop({ default: false }) videoPresent: boolean;
  /** Simple mutexes so two workers never download / analyze the same video at once. */
  @Prop() downloadLockAt?: Date;
  @Prop() analyzeLockAt?: Date;
  @Prop() durationSec?: number;
  @Prop() width?: number;
  @Prop() height?: number;
  @Prop() fps?: number;
  @Prop() sizeBytes?: number;
  @Prop() hasAudio?: boolean;

  @Prop({ default: false }) transcriptReady: boolean;
  @Prop() minedVersion?: string;
  @Prop({ default: 0 }) momentCount: number;

  @Prop({ default: 0 }) attempts: number;
  @Prop() error?: string;
  @Prop() downloadedAt?: Date;
  @Prop() lastUsedAt?: Date;
  @Prop() ytdlpVersion?: string;

  createdAt: Date;
  updatedAt: Date;
}
export type ReelSourceDocument = HydratedDocument<ReelSource>;
export const ReelSourceSchema = SchemaFactory.createForClass(ReelSource);
