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
  @Prop({ type: Object }) topic?: { name: string; brief: string; why: string; signal: string; keywords: string[]; pillar?: string | null; entity?: string | null; score?: number };
  /** The explore part of the day (a hidden child campaign shown inside the same card). */
  @Prop({ type: Object }) exploreTopic?: { name: string; brief: string; why: string; signal: string; keywords: string[]; pillar?: string | null; entity?: string | null; score?: number };
  @Prop({ type: Object }) evidence?: { moments: number; videos: number; strongMoments?: number; minableVideos?: number };
  @Prop({ type: [Object], default: [] }) candidates: Array<{
    name: string;
    signal: string;
    pillar?: string | null;
    entity?: string | null;
    moments: number;
    videos: number;
    strongMoments?: number;
    minableVideos?: number;
    trendMatch?: number;
    trendTitle?: string | null;
    velocityShare?: number;
    components?: Record<string, number>;
    score: number;
    exploreScore?: number;
    eligible?: boolean;
    reason?: string | null;
    picked?: 'main' | 'explore';
    /** Kept so a failed main topic can be replaced by the next candidate without another model call. */
    brief?: string;
    why?: string;
    keywords?: string[];
    thin?: boolean;
  }>;
  @Prop({ type: MongooseSchema.Types.ObjectId }) campaignId?: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId }) exploreCampaignId?: Types.ObjectId;
  @Prop() mainReels?: number;
  @Prop() exploreReels?: number;
  /** What the brain saw (stale trends, no analytics...). */
  @Prop({ type: [String], default: [] }) degraded: string[];
  /** A paused day still records what the brain WOULD have picked, so the choices can be compared before turning it on. */
  @Prop({ type: Object }) shadow?: { topic: string | null; exploreTopic: string | null; at: Date };
  /** Main topics that failed today (not enough usable footage...) and were replaced by the next-best candidate, oldest first. */
  @Prop({ type: [Object], default: [] }) fallbacks: Array<{ name: string; entity?: string | null; reason: string; at: Date }>;
  @Prop({ default: 0 }) fallbackCount: number;
  /** True once no further replacement will be tried today (limit reached, or nothing suitable left). */
  @Prop({ default: false }) rescueExhausted: boolean;
  @Prop() reason?: string;
  @Prop({ default: 1 }) attempts: number;
}
export type ReelDailyRunDocument = HydratedDocument<ReelDailyRun>;
export const ReelDailyRunSchema = SchemaFactory.createForClass(ReelDailyRun);
ReelDailyRunSchema.index({ channelId: 1, date: 1 }, { unique: true });
