import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TokenUsageDailyDocument = HydratedDocument<TokenUsageDaily>;

@Schema({ timestamps: false, collection: 'token_usage_daily' })
export class TokenUsageDaily {
  @Prop({ type: Types.ObjectId, ref: 'Channel', required: true })
  channelId: Types.ObjectId;

  @Prop({ default: () => new Date() })
  date: Date;

  @Prop({ default: 0 })
  promptTokens: number;

  @Prop({ default: 0 })
  completionTokens: number;

  @Prop({ default: 0 })
  cachedTokens: number;

  @Prop({ default: 0 })
  totalCost: number;

  @Prop({ default: 0 })
  requestCount: number;
}

export const TokenUsageDailySchema = SchemaFactory.createForClass(TokenUsageDaily);
TokenUsageDailySchema.index({ channelId: 1, date: 1 }, { unique: true });
