import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export const UPLOAD_STATUSES = ['uploading', 'uploaded', 'cancelled', 'expired'] as const;
export type UploadStatus = (typeof UPLOAD_STATUSES)[number];

/**
 * A raw video file the client sends from the browser (resumable, fixed-size parts written straight to disk).
 * Once complete it becomes a reel source `up_<id>` and its campaign starts. The raw file is deleted 24 h after the
 * 1080p working copy exists.
 */
@Schema({ timestamps: true, collection: 'reel_uploads' })
export class ReelUpload {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true }) channelId: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) userId: Types.ObjectId;
  @Prop({ required: true }) fileName: string;
  @Prop({ required: true }) size: number;
  @Prop({ required: true }) partSize: number;
  @Prop({ required: true }) parts: number;
  @Prop({ type: [Number], default: [] }) received: number[];
  @Prop({ type: String, enum: UPLOAD_STATUSES, default: 'uploading', index: true }) status: UploadStatus;
  @Prop({ required: true }) title: string;
  /** Source id used everywhere a YouTube id is used: "up_<this _id>". */
  @Prop({ required: true, unique: true }) sourceId: string;
  @Prop({ required: true }) rawPath: string;
  @Prop() completedAt?: Date;
  @Prop() rawDeletedAt?: Date;
  @Prop({ type: MongooseSchema.Types.ObjectId }) campaignId?: Types.ObjectId;
}
export type ReelUploadDocument = HydratedDocument<ReelUpload>;
export const ReelUploadSchema = SchemaFactory.createForClass(ReelUpload);
ReelUploadSchema.index({ channelId: 1, fileName: 1, size: 1, status: 1 });
