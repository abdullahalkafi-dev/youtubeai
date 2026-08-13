import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SyncLogDocument = HydratedDocument<SyncLog>;

@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'sync_logs', expires: 30 * 24 * 60 * 60 })
export class SyncLog {
  createdAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'Channel', required: true, index: true })
  channelId: Types.ObjectId;

  @Prop({ required: true })
  videoCount: number;

  @Prop({ default: 0 })
  newVideos: number;

  @Prop({ default: 0 })
  updatedVideos: number;

  @Prop({ default: 0 })
  deletedVideos: number;

  @Prop({ default: 0 })
  driftedVideos: number;

  @Prop({ type: [String], default: [] })
  errors: string[];

  @Prop({ type: [{ videoId: String, youtubeId: String, field: String, oldValue: String, newValue: String, action: String }], default: [] })
  changes: Array<{
    videoId: string;
    youtubeId: string;
    field: string;
    oldValue: string;
    newValue: string;
    action: 'created' | 'updated' | 'drifted' | 'deleted';
  }>;
}

export const SyncLogSchema = SchemaFactory.createForClass(SyncLog);
