import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TrendingIdeaDocument = HydratedDocument<TrendingIdea>;

@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'trending_ideas' })
export class TrendingIdea {
  @Prop({ type: Types.ObjectId, ref: 'Channel', required: true, index: true })
  channelId: Types.ObjectId;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true, enum: ['first_night_inside', 'federal_pressure', 'street_code_autopsy', 'courtroom_reality', 'mothers_sentenced', 'prison_psychology', 'smart_man_trap'] })
  showType: string;

  @Prop({ required: true })
  score: number;

  @Prop({ required: true, enum: ['greenlight', 'hold', 'pass'] })
  status: string;

  @Prop()
  description?: string;

  @Prop({ required: true, enum: ['high', 'medium', 'low'] })
  searchDemand: string;

  @Prop({ required: true, enum: ['high', 'medium', 'low'] })
  emotionalPressure: string;

  @Prop({ required: true, enum: ['perfect', 'strong', 'moderate', 'weak'] })
  authorityFit: string;
}

export const TrendingIdeaSchema = SchemaFactory.createForClass(TrendingIdea);
