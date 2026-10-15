import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

/** Canonical people / cases / topics with aliases, so coverage counts "Diddy" == "Sean Combs". */
@Schema({ timestamps: true, collection: 'reel_entities' })
export class ReelEntity {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) channelId: Types.ObjectId;
  @Prop({ required: true }) slug: string;
  @Prop({ required: true }) name: string;
  @Prop({ type: [String], default: [] }) aliases: string[];
}
export type ReelEntityDocument = HydratedDocument<ReelEntity>;
export const ReelEntitySchema = SchemaFactory.createForClass(ReelEntity);
ReelEntitySchema.index({ channelId: 1, slug: 1 }, { unique: true });

/** Small key/value store for service-wide state (downloader session, counters). */
@Schema({ timestamps: true, collection: 'reel_settings' })
export class ReelSetting {
  @Prop({ required: true, unique: true }) key: string;
  @Prop({ type: MongooseSchema.Types.Mixed }) value: any;
}
export type ReelSettingDocument = HydratedDocument<ReelSetting>;
export const ReelSettingSchema = SchemaFactory.createForClass(ReelSetting);
