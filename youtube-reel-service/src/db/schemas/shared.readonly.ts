import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

/**
 * Minimal READ-ONLY views of the main application's collections.
 * The reel service must never write to them — every write hook throws.
 */
function lockWrites(schema: MongooseSchema, name: string) {
  const deny = function () {
    throw new Error(`[reel-service] write to shared collection "${name}" is forbidden`);
  };
  schema.pre('save', deny);
  for (const op of [
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'findOneAndReplace',
    'findOneAndDelete',
    'replaceOne',
    'deleteOne',
    'deleteMany',
  ] as const) {
    schema.pre(op, deny);
  }
  schema.pre('insertMany', deny);
}

@Schema({ collection: 'videos', strict: false, versionKey: false, autoIndex: false, autoCreate: false })
export class SourceVideo {
  @Prop({ type: Types.ObjectId }) channelId: Types.ObjectId;
  @Prop() youtubeId: string;
  @Prop() title: string;
  @Prop() description?: string;
  @Prop({ type: [String] }) tags?: string[];
  @Prop() publishedAt?: Date;
  @Prop() privacyStatus?: string;
  @Prop() liveBroadcastContent?: string;
  @Prop() duration?: string;
  @Prop() durationSeconds?: number;
  @Prop() viewCount?: number;
  @Prop() likeCount?: number;
  @Prop() deletedAt?: Date;
  @Prop() transcriptText?: string;
  @Prop({ type: [Object] }) transcriptSegments?: Array<{ text: string; startSeconds: number; timestamp: string }>;
}
export type SourceVideoDocument = HydratedDocument<SourceVideo>;
export const SourceVideoSchema = SchemaFactory.createForClass(SourceVideo);
lockWrites(SourceVideoSchema, 'videos');

@Schema({ collection: 'channels', strict: false, versionKey: false, autoIndex: false, autoCreate: false })
export class SharedChannel {
  @Prop({ type: Types.ObjectId }) userId: Types.ObjectId;
  @Prop() name: string;
  @Prop() handle?: string;
  @Prop() youtubeChannelId?: string;
}
export type SharedChannelDocument = HydratedDocument<SharedChannel>;
export const SharedChannelSchema = SchemaFactory.createForClass(SharedChannel);
lockWrites(SharedChannelSchema, 'channels');

@Schema({ collection: 'users', strict: false, versionKey: false, autoIndex: false, autoCreate: false })
export class SharedUser {
  @Prop() email: string;
  @Prop() name?: string;
  @Prop() role?: string;
}
export type SharedUserDocument = HydratedDocument<SharedUser>;
export const SharedUserSchema = SchemaFactory.createForClass(SharedUser);
lockWrites(SharedUserSchema, 'users');
