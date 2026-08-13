import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SeoVersionDocument = HydratedDocument<SeoVersion>;

@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'seo_versions' })
export class SeoVersion {
  createdAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'Video', required: true, index: true })
  videoId: Types.ObjectId;

  @Prop({ required: true, enum: ['original', 'ai_optimized', 'rolled_back'] })
  type: string;

  @Prop({ default: false })
  approved: boolean;

  @Prop({ type: Object, required: true })
  seo: {
    title: string;
    description: string;
    tags: string[];
    hashtags: string[];
  };

  @Prop()
  note?: string;
}

export const SeoVersionSchema = SchemaFactory.createForClass(SeoVersion);
