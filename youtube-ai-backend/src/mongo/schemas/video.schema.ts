import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type VideoDocument = HydratedDocument<Video>;

@Schema({ timestamps: true, collection: 'videos' })
export class Video {
  @Prop({ type: Types.ObjectId, ref: 'Channel', required: true, index: true })
  channelId: Types.ObjectId;

  @Prop({ required: true })
  youtubeId: string;

  @Prop({ required: true })
  title: string;

  @Prop()
  description?: string;

  @Prop()
  thumbnailUrl?: string;

  @Prop()
  publishedAt?: Date;

  @Prop()
  videoUrl?: string;

  // YouTube metadata
  @Prop()
  definition?: string;

  @Prop()
  caption?: boolean;

  @Prop()
  categoryId?: string;

  @Prop()
  favoriteCount?: number;

  // YouTube status
  @Prop()
  privacyStatus?: string;

  @Prop()
  embeddable?: boolean;

  @Prop()
  publicStatsViewable?: boolean;

  @Prop()
  license?: string;

  // Language
  @Prop()
  defaultLanguage?: string;

  @Prop()
  defaultAudioLanguage?: string;

  // Broadcast
  @Prop()
  liveBroadcastContent?: string;

  // Content details
  @Prop()
  projection?: string;

  // Duration
  @Prop()
  duration?: string;

  @Prop()
  durationSeconds?: number;

  // Metrics
  @Prop({ default: 0 })
  viewCount: number;

  @Prop({ default: 0 })
  likeCount: number;

  @Prop({ default: 0 })
  commentCount: number;

  // Analytics
  @Prop()
  ctr?: number;

  @Prop()
  avgWatchTime?: number;

  @Prop()
  retentionPercent?: number;

  @Prop({ default: 0 })
  estimatedRevenue: number;

  @Prop()
  impressions?: number;

  @Prop()
  lastAnalyticsSync?: Date;

  // SEO
  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ default: 'not_started', enum: ['optimized', 'pending', 'processing', 'not_started', 'approved'] })
  seoStatus: string;

  @Prop({ type: Object })
  currentSeo?: {
    title: string;
    description: string;
    tags: string[];
    hashtags: string[];
  };

  @Prop({ type: Object })
  suggestedSeo?: {
    title: string;
    description: string;
    tags: string[];
    hashtags: string[];
  };

  @Prop()
  aiScore?: number;

  @Prop({ enum: ['first_night_inside', 'federal_pressure', 'street_code_autopsy', 'courtroom_reality', 'mothers_sentenced', 'prison_psychology', 'smart_man_trap'] })
  showType?: string;

  // Status
  @Prop({ default: 'draft', enum: ['published', 'draft', 'scheduled'] })
  status: string;

  // RAG embedding
  @Prop({ type: [Number] })
  embedding?: number[];

  // Drift detection — stores what YouTube LAST reported
  @Prop()
  youtubeTitle?: string;

  @Prop()
  youtubeDescription?: string;

  @Prop({ type: [String] })
  youtubeTags?: string[];

  // Sync metadata
  @Prop()
  lastSyncedAt?: Date;

  @Prop({ default: false })
  deletedFromYoutube?: boolean;

  @Prop()
  deletedAt?: Date;

  // Manual modification & provenance tracking
  @Prop()
  lastManualModifiedAt?: Date;

  @Prop({
    default: 'dashboard_single_video',
    enum: ['auto_cron_batch', 'manual_ui_batch', 'dashboard_single_video'],
  })
  optimizationSource: string;

  @Prop({ type: Types.ObjectId, ref: 'AutomationBatch', sparse: true })
  lastBatchId?: Types.ObjectId;

  // Spoken Transcript & Timestamps Cache
  @Prop()
  transcriptText?: string;

  @Prop({ type: [Object], default: [] })
  transcriptSegments?: Array<{
    text: string;
    startSeconds: number;
    timestamp: string;
  }>;

  @Prop({
    enum: ['transcriptapi', 'innertube_android', 'innertube_ios', 'innertube_web', 'official_oauth', 'none'],
  })
  transcriptSource?: string;

  @Prop()
  transcriptFetchedAt?: Date;
}

export const VideoSchema = SchemaFactory.createForClass(Video);
VideoSchema.index({ channelId: 1, youtubeId: 1 }, { unique: true });
VideoSchema.index({ channelId: 1, publishedAt: -1 });
VideoSchema.index({ channelId: 1, seoStatus: 1 });
VideoSchema.index({ channelId: 1, viewCount: -1 });

