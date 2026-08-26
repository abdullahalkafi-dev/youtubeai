import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AutomationBatchDocument = HydratedDocument<AutomationBatch>;

@Schema({ timestamps: false })
export class AutomationBatchItem {
  @Prop({ type: Types.ObjectId, ref: 'Video', required: true })
  videoId: Types.ObjectId;

  @Prop({ required: true })
  youtubeId: string;

  @Prop({ required: true })
  originalTitle: string;

  @Prop()
  originalDescription?: string;

  @Prop({ type: [String], default: [] })
  originalTags: string[];

  @Prop()
  generatedTitle?: string;

  @Prop()
  generatedDescription?: string;

  @Prop({ type: [String], default: [] })
  generatedTags: string[];

  @Prop({ type: [String], default: [] })
  generatedHashtags: string[];

  @Prop({
    default: 'queued',
    enum: [
      'queued',
      'generating',
      'staged',
      'pushing',
      'completed',
      'skipped_manual_override',
      'failed',
    ],
  })
  status: string;

  @Prop()
  error?: string;

  @Prop()
  durationMs?: number;

  @Prop({ default: () => new Date() })
  batchLockTimestamp: Date;

  @Prop()
  processedAt?: Date;
}

export const AutomationBatchItemSchema =
  SchemaFactory.createForClass(AutomationBatchItem);

@Schema({ timestamps: true, collection: 'automation_batches' })
export class AutomationBatch {
  @Prop({ type: Types.ObjectId, ref: 'Channel', required: true, index: true })
  channelId: Types.ObjectId;

  @Prop({
    default: 'video_seo',
    enum: ['video_seo', 'comment_reply'],
    index: true,
  })
  type: string;

  @Prop({
    default: 'auto_cron_batch',
    enum: ['auto_cron_batch', 'manual_ui_batch'],
  })
  source: string;

  @Prop({ type: Types.ObjectId, ref: 'AutomationBatch', sparse: true })
  parentBatchId?: Types.ObjectId;

  @Prop({ default: false })
  isRetried?: boolean;

  @Prop({ type: Types.ObjectId, ref: 'AutomationBatch', sparse: true })
  retriedByBatchId?: Types.ObjectId;

  @Prop({
    default: 'pending',
    enum: [
      'pending',
      'checking_quota',
      'generating',
      'staging',
      'pushing',
      'completed',
      'partial',
      'failed',
      'cancelled',
    ],
    index: true,
  })
  status: string;

  @Prop({ default: 0 })
  totalItems: number;

  @Prop({ default: 0 })
  successfulItems: number;

  @Prop({ default: 0 })
  failedItems: number;

  @Prop({ default: 0 })
  skippedItems: number;

  @Prop({ default: 0 })
  quotaUnitsUsed: number;

  @Prop({ default: () => new Date() })
  startedAt: Date;

  @Prop()
  completedAt?: Date;

  @Prop({ default: () => new Date() })
  lastHeartbeatAt: Date;

  @Prop({ type: [AutomationBatchItemSchema], default: [] })
  items: AutomationBatchItem[];

  @Prop()
  errorMessage?: string;
}

export const AutomationBatchSchema =
  SchemaFactory.createForClass(AutomationBatch);
AutomationBatchSchema.index({ channelId: 1, createdAt: -1 });
AutomationBatchSchema.index({ channelId: 1, status: 1 });
