import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AIOutputLogDocument = HydratedDocument<AIOutputLog>;

@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'ai_output_logs' })
export class AIOutputLog {
  @Prop({ type: Types.ObjectId, ref: 'Channel', required: true, index: true })
  channelId: Types.ObjectId;

  @Prop({ required: true, index: true })
  operation: string;

  @Prop()
  threadId?: string;

  @Prop()
  videoId?: string;

  @Prop({ required: true })
  inputSummary: string;

  @Prop({ type: Object, required: true })
  output: Record<string, any>;

  @Prop({ default: 0 })
  promptTokens: number;

  @Prop({ default: 0 })
  completionTokens: number;

  @Prop({ default: 0 })
  cachedTokens: number;

  @Prop({ default: 0 })
  cacheHitRate: number;

  @Prop({ required: true })
  model: string;
}

export const AIOutputLogSchema = SchemaFactory.createForClass(AIOutputLog);
AIOutputLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 }); // 90 day TTL
