import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ApiQuotaLogDocument = HydratedDocument<ApiQuotaLog>;

@Schema({ timestamps: { createdAt: 'calledAt', updatedAt: false }, collection: 'api_quota_logs' })
export class ApiQuotaLog {
  @Prop({ type: Types.ObjectId, ref: 'Channel', required: true, index: true })
  channelId: Types.ObjectId;

  @Prop({ required: true })
  endpoint: string;

  @Prop({ required: true })
  quotaCost: number;

  @Prop()
  relatedId?: string;

  @Prop({ default: true })
  success: boolean;

  @Prop()
  errorMessage?: string;
}

export const ApiQuotaLogSchema = SchemaFactory.createForClass(ApiQuotaLog);
ApiQuotaLogSchema.index({ calledAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 }); // 30 day TTL
