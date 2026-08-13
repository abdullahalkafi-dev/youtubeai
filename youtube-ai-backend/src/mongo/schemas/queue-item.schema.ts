import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type QueueItemDocument = HydratedDocument<QueueItem>;

@Schema({ timestamps: { createdAt: 'queuedAt', updatedAt: false }, collection: 'queue_items' })
export class QueueItem {
  @Prop({ type: Types.ObjectId, ref: 'Channel', required: true, index: true })
  channelId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Video', required: true })
  videoId: Types.ObjectId;

  @Prop({ required: true })
  videoTitle: string;

  @Prop({ default: 'queued', enum: ['queued', 'processing', 'done', 'failed'] })
  status: string;

  @Prop()
  error?: string;

  @Prop()
  processedAt?: Date;
}

export const QueueItemSchema = SchemaFactory.createForClass(QueueItem);
QueueItemSchema.index({ channelId: 1, status: 1, queuedAt: -1 });
QueueItemSchema.index({ status: 1, queuedAt: 1 });

