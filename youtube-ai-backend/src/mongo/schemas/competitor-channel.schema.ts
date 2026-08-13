import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CompetitorChannelDocument = HydratedDocument<CompetitorChannel>;

@Schema({ timestamps: true, collection: 'competitor_channels' })
export class CompetitorChannel {
  @Prop({ type: Types.ObjectId, ref: 'Channel', required: true, index: true })
  channelId: Types.ObjectId;

  @Prop({ required: true })
  youtubeChannelId: string;

  @Prop({ required: true })
  title: string;

  @Prop({ default: '' })
  thumbnailUrl: string;

  @Prop({ default: 0 })
  subscriberCount: number;

  @Prop({ default: 0 })
  videoCount: number;

  @Prop({ default: 0 })
  viewCount: number;

  @Prop({ default: true })
  isAutoDetected: boolean;

  @Prop({ type: Date, default: () => new Date() })
  discoveredAt: Date;

  @Prop({ type: Date, default: () => new Date() })
  lastChecked: Date;
}

export const CompetitorChannelSchema = SchemaFactory.createForClass(CompetitorChannel);
