import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type HttpLogDocument = HydratedDocument<HttpLog>;

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'http_logs',
})
export class HttpLog {
  createdAt?: Date;

  @Prop({ required: true, index: true })
  method: string;

  @Prop({ required: true })
  url: string;

  @Prop({ required: true, index: true })
  path: string;

  @Prop({ required: true, index: true })
  statusCode: number;

  @Prop({ required: true, enum: ['error', 'warn', 'info'], index: true })
  level: 'error' | 'warn' | 'info';

  @Prop({ required: true, default: 0 })
  responseTimeMs: number;

  @Prop({ type: String, default: null })
  errorMessage?: string | null;

  @Prop({ type: String, default: null })
  errorStack?: string | null;

  @Prop({ type: String, default: null })
  errorName?: string | null;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  requestQuery?: Record<string, unknown> | null;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  requestBody?: Record<string, unknown> | string | null;

  @Prop({ type: String, default: null })
  ip?: string | null;

  @Prop({ type: String, default: null })
  userAgent?: string | null;

  @Prop({ type: String, default: null, index: true })
  userId?: string | null;

  @Prop({ type: String, default: null })
  userEmail?: string | null;

  /**
   * MongoDB TTL Index: Document expires and is automatically deleted
   * at `expiresAt`. Errors: 14 days; Successes: 7 days.
   */
  @Prop({ type: Date, required: true, index: { expires: 0 } })
  expiresAt: Date;
}

export const HttpLogSchema = SchemaFactory.createForClass(HttpLog);

// Compound indexes for query performance
HttpLogSchema.index({ statusCode: 1, createdAt: -1 });
HttpLogSchema.index({ level: 1, createdAt: -1 });
HttpLogSchema.index({ path: 1, createdAt: -1 });
HttpLogSchema.index({ createdAt: -1 });
