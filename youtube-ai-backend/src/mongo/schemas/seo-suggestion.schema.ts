import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SeoSuggestionDocument = HydratedDocument<SeoSuggestion>;

@Schema({ timestamps: true, collection: 'seo_suggestions' })
export class SeoSuggestion {
  @Prop({ type: Types.ObjectId, ref: 'Video', required: true, index: true })
  videoId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Channel', required: true, index: true })
  channelId: Types.ObjectId;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  description: string;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ type: [String], default: [] })
  hashtags: string[];

  @Prop({ enum: ['first_night_inside', 'federal_pressure', 'street_code_autopsy', 'courtroom_reality', 'mothers_sentenced', 'prison_psychology', 'smart_man_trap'] })
  showType?: string;

  @Prop()
  tone?: string;

  @Prop({ default: 'pending', enum: ['pending', 'approving', 'approved', 'rejected', 'superseded'] })
  status: string;

  @Prop({
    default: 'dashboard_single_video',
    enum: ['auto_cron_batch', 'manual_ui_batch', 'dashboard_single_video'],
  })
  source: string;

  @Prop({ type: Types.ObjectId, ref: 'AutomationBatch', sparse: true })
  batchId?: Types.ObjectId;
}

export const SeoSuggestionSchema = SchemaFactory.createForClass(SeoSuggestion);
SeoSuggestionSchema.index({ channelId: 1, status: 1 });
SeoSuggestionSchema.index({ videoId: 1, status: 1 });
SeoSuggestionSchema.index({ channelId: 1, createdAt: -1 });

