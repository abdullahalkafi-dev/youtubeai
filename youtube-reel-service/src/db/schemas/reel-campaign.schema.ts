import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export const CAMPAIGN_STATUSES = [
  'queued',
  'researching',
  'sourcing',
  'preparing', // downloading + transcribing + mining the chosen source videos
  'composing', // director -> critic -> revision -> packaging
  'rendering',
  'completed',
  'partial',
  'failed',
  'cancelled',
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export const TERMINAL_CAMPAIGN_STATUSES: CampaignStatus[] = ['completed', 'partial', 'failed', 'cancelled'];

export interface CampaignSettings {
  targetReels: number;
  minSec: number;
  maxSec: number;
  allowCrossVideo: boolean;
  templateName: string;
  seedVideoIds: string[]; // youtube ids the user explicitly wants used
}

export interface CampaignSourceRef {
  youtubeId: string;
  videoId: string;
  title: string;
  viewCount: number;
  durationSec: number;
  publishedAt?: Date;
  reason: string;
  fromBank: boolean; // already analyzed in an earlier campaign
  status: 'pending' | 'ready' | 'failed';
  error?: string;
}

@Schema({ timestamps: true, collection: 'reel_campaigns' })
export class ReelCampaign {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true }) channelId: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) userId: Types.ObjectId;
  @Prop({ required: true }) name: string;
  @Prop({ required: true }) brief: string;
  @Prop({ type: String, enum: CAMPAIGN_STATUSES, default: 'queued', index: true }) status: CampaignStatus;
  @Prop({ type: Object, required: true }) settings: CampaignSettings;

  @Prop({ type: MongooseSchema.Types.Mixed }) research?: Record<string, any>;
  @Prop({ type: [Object], default: [] }) sources: CampaignSourceRef[];

  /** Human readable reason the campaign is waiting (e.g. YouTube login needed). */
  @Prop() blockedReason?: string;
  @Prop({ type: Object, default: () => ({ stage: 'queued', message: 'Waiting to start' }) })
  progress: { stage: string; message: string };

  @Prop({
    type: Object,
    default: () => ({ promptTokens: 0, completionTokens: 0, reasoningTokens: 0, sttSeconds: 0, embedTokens: 0, calls: 0 }),
  })
  usage: { promptTokens: number; completionTokens: number; reasoningTokens: number; sttSeconds: number; embedTokens: number; calls: number };

  @Prop({ type: Object, default: () => ({ candidates: 0, kept: 0, dropped: 0, rendered: 0, failed: 0 }) })
  stats: { candidates: number; kept: number; dropped: number; rendered: number; failed: number };

  @Prop({ type: [Object], default: [] }) log: Array<{ at: Date; level: 'info' | 'warn' | 'error'; msg: string }>;

  @Prop() error?: string;
  @Prop({ default: false }) cancelRequested: boolean;
  @Prop() startedAt?: Date;
  @Prop() finishedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}
export type ReelCampaignDocument = HydratedDocument<ReelCampaign>;
export const ReelCampaignSchema = SchemaFactory.createForClass(ReelCampaign);
ReelCampaignSchema.index({ channelId: 1, createdAt: -1 });
ReelCampaignSchema.index({ status: 1, updatedAt: 1 });
