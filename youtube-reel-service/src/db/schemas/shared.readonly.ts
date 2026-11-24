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
  @Prop({ type: MongooseSchema.Types.ObjectId }) channelId: Types.ObjectId;
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
  @Prop() deletedFromYoutube?: boolean;
  @Prop() categoryId?: string;
  @Prop() commentCount?: number;
  @Prop() lastSyncedAt?: Date;
  @Prop() transcriptText?: string;
  @Prop({ type: [Object] }) transcriptSegments?: Array<{ text: string; startSeconds: number; timestamp: string }>;
}
export type SourceVideoDocument = HydratedDocument<SourceVideo>;
export const SourceVideoSchema = SchemaFactory.createForClass(SourceVideo);
lockWrites(SourceVideoSchema, 'videos');

@Schema({ collection: 'channels', strict: false, versionKey: false, autoIndex: false, autoCreate: false })
export class SharedChannel {
  @Prop({ type: MongooseSchema.Types.ObjectId }) userId: Types.ObjectId;
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
  /**
   * Google tokens belong to the main app. They are mapped READ-ONLY and `select: false`, so they are never
   * loaded unless `GoogleTokenProvider` explicitly asks for them, and no response ever includes them.
   */
  @Prop({ select: false }) accessToken?: string;
  @Prop({ select: false }) refreshToken?: string;
  @Prop({ select: false }) tokenExpiresAt?: Date;
}
export type SharedUserDocument = HydratedDocument<SharedUser>;
export const SharedUserSchema = SchemaFactory.createForClass(SharedUser);
lockWrites(SharedUserSchema, 'users');

/**
 * The main app's Facebook logins (one document per app user AND Meta account, so an owner can hold several): the Pages each
 * account shared and their Page access tokens.
 * Mapped READ-ONLY. `pages` carries the tokens, so it is `select: false` and only `MetaTokenProvider` ever loads it.
 */
@Schema({ collection: 'meta_connections', strict: false, versionKey: false, autoIndex: false, autoCreate: false })
export class SharedMetaConnection {
  @Prop({ type: MongooseSchema.Types.ObjectId }) userId: Types.ObjectId;
  @Prop() metaUserId?: string;
  @Prop({ select: false, type: [Object] }) pages?: Array<{ pageId: string; name: string; accessToken: string; instagram?: { id: string; username?: string } }>;
  @Prop() userTokenExpiresAt?: Date;
  @Prop() connectedAt?: Date;
}
export type SharedMetaConnectionDocument = HydratedDocument<SharedMetaConnection>;
export const SharedMetaConnectionSchema = SchemaFactory.createForClass(SharedMetaConnection);
lockWrites(SharedMetaConnectionSchema, 'meta_connections');

/** Daily per-video performance rows written by the main app's Reporting API sync (read-only here). */
@Schema({ collection: 'video_daily_stats', strict: false, versionKey: false, autoIndex: false, autoCreate: false })
export class SharedVideoDailyStat {
  @Prop({ type: MongooseSchema.Types.ObjectId }) videoId: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId }) channelId: Types.ObjectId;
  @Prop() date: string;
  @Prop() views: number;
  @Prop() impressions: number;
  @Prop() ctr?: number;
  @Prop() watchMinutes: number;
  @Prop() retentionPct?: number;
  @Prop() likes: number;
  @Prop() subsGained: number;
}
export type SharedVideoDailyStatDocument = HydratedDocument<SharedVideoDailyStat>;
export const SharedVideoDailyStatSchema = SchemaFactory.createForClass(SharedVideoDailyStat);
lockWrites(SharedVideoDailyStatSchema, 'video_daily_stats');
