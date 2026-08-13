import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ThreadDocument = HydratedDocument<Thread>;

// Message subdocument (embedded in Thread)
@Schema({ _id: true, timestamps: false })
export class Message {
  _id?: Types.ObjectId;

  @Prop({ required: true, enum: ['user', 'assistant'] })
  role: string;

  @Prop({ required: true })
  content: string;

  @Prop({ type: Object })
  metadata?: {
    category?: string;
    generatedSeo?: {
      title: string;
      description: string;
      tags: string[];
    };
    generatedScript?: string;
    images?: Array<{
      id: string;
      url: string;
      prompt?: string;
      createdAt: Date;
    }>;
    sources?: Array<{
      title: string;
      url: string;
      snippet?: string;
    }>;
    attachments?: Array<{
      type: 'pdf' | 'image';
      url: string;
      filename: string;
      extractedText?: string;
    }>;
  };

  @Prop({ type: [Number] })
  embedding?: number[];

  @Prop({ default: () => new Date() })
  createdAt: Date;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

@Schema({ timestamps: true, collection: 'threads' })
export class Thread {
  createdAt?: Date;
  updatedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'Channel', required: true, index: true })
  channelId: Types.ObjectId;

  @Prop({ required: true, enum: ['video', 'standalone'] })
  type: string;

  @Prop({ required: true })
  title: string;

  @Prop({ default: 'active', enum: ['active', 'archived'] })
  status: string;

  @Prop()
  videoId?: string;

  @Prop()
  videoTitle?: string;

  @Prop()
  videoThumbnail?: string;

  @Prop()
  summary?: string;

  @Prop({ default: 0 })
  totalPromptTokens: number;

  @Prop({ default: 0 })
  totalCompletionTokens: number;

  @Prop({ default: 0 })
  totalCachedTokens: number;

  @Prop({ default: 0 })
  lastCacheHitRate: number;

  @Prop({ type: [MessageSchema], default: [] })
  messages: Message[];
}

export const ThreadSchema = SchemaFactory.createForClass(Thread);
ThreadSchema.index({ channelId: 1, status: 1, updatedAt: -1 });
ThreadSchema.index({ channelId: 1, videoId: 1 });

