import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export interface PillarDef {
  key: string;
  name: string;
  description: string;
}

/**
 * The channel's content pillars: a short, stable list (about 10) that every moment, reel and catalog video is filed under,
 * so coverage ("what have we not made lately?") and learning ("which kind of topic works?") can aggregate.
 * Free-form themes cannot: 300 mined moments carried 417 different theme tags, 273 of them used once.
 */
@Schema({ timestamps: true, collection: 'reel_pillars' })
export class ReelPillarSet {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, unique: true }) channelId: Types.ObjectId;
  @Prop({ type: [Object], default: [] }) pillars: PillarDef[];
  @Prop({ default: 1 }) version: number;
}
export type ReelPillarSetDocument = HydratedDocument<ReelPillarSet>;
export const ReelPillarSetSchema = SchemaFactory.createForClass(ReelPillarSet);

/** Catalog video -> pillar (the main app's `videos` collection is read-only for the reel service, so the label lives here). */
@Schema({ timestamps: true, collection: 'reel_video_pillars' })
export class ReelVideoPillar {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) channelId: Types.ObjectId;
  @Prop({ required: true }) youtubeId: string;
  @Prop({ required: true }) pillar: string;
  @Prop({ default: 1 }) version: number;
}
export type ReelVideoPillarDocument = HydratedDocument<ReelVideoPillar>;
export const ReelVideoPillarSchema = SchemaFactory.createForClass(ReelVideoPillar);
ReelVideoPillarSchema.index({ channelId: 1, youtubeId: 1 }, { unique: true });
ReelVideoPillarSchema.index({ channelId: 1, pillar: 1 });
