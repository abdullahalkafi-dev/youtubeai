import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

/** One conversation per campaign with the campaign assistant (shown on the campaign page). */
@Schema({ timestamps: true, collection: 'reel_campaign_chats' })
export class ReelCampaignChat {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) campaignId: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) channelId: Types.ObjectId;
  @Prop({
    type: [{ role: String, content: String, at: Date, _id: false }],
    default: [],
  })
  messages: Array<{ role: 'user' | 'assistant'; content: string; at: Date }>;
}
export type ReelCampaignChatDocument = HydratedDocument<ReelCampaignChat>;
export const ReelCampaignChatSchema = SchemaFactory.createForClass(ReelCampaignChat);
ReelCampaignChatSchema.index({ campaignId: 1 }, { unique: true });
