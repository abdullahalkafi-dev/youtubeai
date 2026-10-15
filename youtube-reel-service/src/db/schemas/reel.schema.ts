import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export const REEL_STATUSES = ['queued', 'rendering', 'todo', 'posted', 'rejected', 'failed'] as const;
export type ReelStatus = (typeof REEL_STATUSES)[number];

export const REEL_SHAPES = ['single_take', 'cold_open', 'condensed', 'cross_video'] as const;
export type ReelShape = (typeof REEL_SHAPES)[number];

export const CLIP_ROLES = ['hook', 'setup', 'build', 'payoff', 'close'] as const;
export type ClipRole = (typeof CLIP_ROLES)[number];

export interface ReelClip {
  youtubeId: string;
  videoId: string;
  sourceTitle: string;
  role: ClipRole;
  startLine: number;
  endLine: number;
  start: number; // seconds in the source video (word-snapped)
  end: number;
  text: string;
}

export interface ReelWord {
  w: string;
  s: number; // seconds on the reel timeline
  e: number;
  eos?: boolean; // last word of a sentence
}

export interface ReelScores {
  hook: number;
  clarity: number;
  flow: number;
  payoff: number;
  ending: number;
  retention: number;
  safety: number;
  overall: number;
}

export interface ReelPackaging {
  headline: string;
  title: string;
  altTitles: string[];
  description: string;
  tags: string[];
  hashtags: string[];
  pinnedComment: string;
  summary: string;
}

@Schema({ timestamps: true, collection: 'reels' })
export class Reel {
  @Prop({ type: Types.ObjectId, required: true, index: true }) campaignId: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true, index: true }) channelId: Types.ObjectId;
  @Prop({ required: true }) index: number;
  @Prop({ type: String, enum: REEL_STATUSES, default: 'queued', index: true }) status: ReelStatus;

  @Prop({ type: String, enum: REEL_SHAPES }) shape: ReelShape;
  @Prop() concept: string;
  @Prop() angle?: string;
  @Prop() hookText: string;
  @Prop() payoffText: string;
  @Prop() whyItWorks?: string;

  @Prop({ type: [Object], default: [] }) clips: ReelClip[];
  @Prop() durationSec: number;
  @Prop({ type: [Object], default: [], select: false }) words: ReelWord[];

  @Prop({ type: Object }) scores?: ReelScores;
  @Prop({ type: Object }) critique?: { verdict: string; issues: string[]; revised: boolean };
  @Prop({ type: Object }) packaging?: ReelPackaging;

  @Prop({ type: [String], default: [], index: true }) entitySlugs: string[];
  @Prop({ type: [String], default: [] }) entityNames: string[];
  @Prop({ type: [String], default: [] }) themes: string[];
  @Prop({ type: [Types.ObjectId], default: [] }) momentIds: Types.ObjectId[];
  @Prop({ type: [Number], select: false }) embedding?: number[];

  @Prop({ type: Object, default: {} })
  assets: { videoKey?: string; coverKey?: string; srtKey?: string; planKey?: string; sizeBytes?: number };
  @Prop() templateName?: string;
  @Prop() templateEtag?: string;
  @Prop({ type: Object }) qa?: { loudnessLufs?: number; width?: number; height?: number; warnings: string[] };

  @Prop({ default: 0 }) renderAttempts: number;
  @Prop() error?: string;
  @Prop() postedAt?: Date;
  @Prop() postedUrl?: string;
  @Prop() rejectedAt?: Date;
  @Prop() rejectReason?: string;

  createdAt: Date;
  updatedAt: Date;
}
export type ReelDocument = HydratedDocument<Reel>;
export const ReelSchema = SchemaFactory.createForClass(Reel);
ReelSchema.index({ channelId: 1, createdAt: -1 });
ReelSchema.index({ channelId: 1, status: 1 });
ReelSchema.index({ 'clips.youtubeId': 1 });
