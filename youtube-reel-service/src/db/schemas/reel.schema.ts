import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { softDelete } from './soft-delete';

export const REEL_STATUSES = ['queued', 'rendering', 'todo', 'posted', 'rejected', 'failed'] as const;
export type ReelStatus = (typeof REEL_STATUSES)[number];

export const REEL_SHAPES = ['single_take', 'cold_open', 'condensed', 'cross_video'] as const;
export type ReelShape = (typeof REEL_SHAPES)[number];

export const CLIP_ROLES = ['hook', 'setup', 'build', 'payoff', 'close'] as const;
export type ClipRole = (typeof CLIP_ROLES)[number];

/** An AI image shown inside the video window (times on the planned reel timeline). */
export interface ReelVisual {
  id: string;
  start: number;
  end: number;
  importance: 'high' | 'medium';
  purpose: string;
  /** The words he says when the picture appears. */
  phrase?: string;
  prompt: string;
  safePrompt: string;
  people: string[];
  status: 'pending' | 'ready' | 'failed' | 'removed';
  key?: string;
  variant?: number;
  /** Generated from the fallback prompt without real people. */
  usedSafe?: boolean;
  /** Shows a real, named person realistically → publish declares synthetic content. */
  realPerson?: boolean;
  error?: string;
}

/** A finished 9:16 thumbnail variant. */
export interface ReelThumbnail {
  id: string;
  key?: string;
  headline: string;
  subject: string | null;
  /** photo-ref: real person from a verified photo; ai / ai-safe: AI scene; frame: a frame of the reel. */
  source: 'photo-ref' | 'ai' | 'ai-safe' | 'frame';
  status: 'ready' | 'failed';
  createdAt: Date;
}

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
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true }) campaignId: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true }) channelId: Types.ObjectId;
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
  /** Content pillar, taken from the moments this reel was cut from. */
  @Prop({ index: true }) pillar?: string;
  @Prop({ type: [MongooseSchema.Types.ObjectId], default: [] }) momentIds: Types.ObjectId[];
  @Prop({ type: [Number], select: false }) embedding?: number[];

  @Prop({ type: Object, default: {} })
  assets: { videoKey?: string; coverKey?: string; srtKey?: string; planKey?: string; sizeBytes?: number };
  @Prop() templateName?: string;
  @Prop() templateEtag?: string;
  @Prop({ type: [Object], default: [] }) visuals: ReelVisual[];
  @Prop() visualsVersion?: string;
  @Prop({ type: [Object], default: [] }) thumbnails: ReelThumbnail[];
  @Prop() thumbnailChoice?: string;
  @Prop() thumbnailsVersion?: string;
  /** How the render paced the reel: speed/voice and the pauses cut (reel-timeline seconds). */
  @Prop({ type: Object }) timing?: { speed: number; voice: string; semitones?: number; cuts: Array<[number, number]>; plannedSec: number; fx?: { punch: boolean; join: boolean; whoosh: boolean; bar: boolean } | null; realign?: { ok: boolean; coverage?: number; maxShiftSec?: number; reason?: string } | null; sfx?: { kind: string; tail: number } | null };
  @Prop({ type: Object }) qa?: { loudnessLufs?: number; width?: number; height?: number; warnings: string[] };

  @Prop({ default: 0 }) renderAttempts: number;
  @Prop() error?: string;
  @Prop() postedAt?: Date;
  @Prop() postedUrl?: string;
  @Prop() rejectedAt?: Date;
  @Prop() rejectReason?: string;
  /** Set when its campaign is deleted from the app (it stays on any platform it was published to). */
  @Prop({ type: Date, default: null, index: true }) deletedAt?: Date | null;

  createdAt: Date;
  updatedAt: Date;
}
export type ReelDocument = HydratedDocument<Reel>;
export const ReelSchema = SchemaFactory.createForClass(Reel);
ReelSchema.index({ channelId: 1, createdAt: -1 });
ReelSchema.index({ channelId: 1, status: 1 });
ReelSchema.index({ 'clips.youtubeId': 1 });
ReelSchema.plugin(softDelete);
