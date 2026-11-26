import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type EpisodeStatus = 'queued' | 'processing' | 'uploaded' | 'failed' | 'skipped';

/** One YouTube video on its way to (or already on) Buzzsprout. Everything the retry logic needs is saved stage by stage. */
@Schema({ collection: 'podcast_episodes', timestamps: true, versionKey: false })
export class PodcastEpisode {
  @Prop({ required: true, unique: true }) youtubeId: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, index: true }) channelId: Types.ObjectId;
  @Prop() title: string;
  @Prop() videoPublishedAt?: Date;
  @Prop() videoViews?: number;
  /** 'auto' = found by the scheduler, 'manual' = added from the Podcast page / API. */
  @Prop({ default: 'auto' }) origin: string;
  @Prop({ default: 'queued', index: true }) status: EpisodeStatus;
  /** The stage being worked on (audio, meta, create, upload, processing, chapters, publish) or the one that failed. */
  @Prop() stage?: string;
  @Prop({ default: 0 }) attempts: number;
  @Prop() nextAttemptAt?: Date;
  @Prop() lockedAt?: Date;
  @Prop() error?: string;

  @Prop({ type: Object }) audio?: {
    source: 'cache' | 'download';
    key: string;
    bytes: number;
    originalSec: number;
    durationSec: number;
    removedSec: number;
    cuts: Array<{ start: number; end: number }>;
    trimSkipped?: string;
  };
  @Prop({ type: Object }) meta?: { title: string; descriptionHtml: string; tags: string; chapters: Array<{ startSec: number; title: string }> };
  @Prop({ type: Object }) buzzsprout?: {
    episodeId?: number;
    /** An episode with the same title was already on Buzzsprout (not made by us): kept apart from episodeId so it is never resumed or re-uploaded. */
    existingEpisodeId?: number;
    uploadId?: string;
    uploadDone?: boolean;
    processed?: boolean;
    chaptersDone?: boolean;
    published?: boolean;
    publishedAt?: Date;
    audioUrl?: string;
    pageUrl?: string;
  };
  @Prop() startedAt?: Date;
  @Prop() finishedAt?: Date;
}
export type PodcastEpisodeDocument = HydratedDocument<PodcastEpisode>;
export const PodcastEpisodeSchema = SchemaFactory.createForClass(PodcastEpisode);

@Schema({ collection: 'podcast_settings', versionKey: false })
export class PodcastSetting {
  @Prop({ required: true, unique: true }) key: string;
  @Prop({ type: MongooseSchema.Types.Mixed }) value: any;
}
export type PodcastSettingDocument = HydratedDocument<PodcastSetting>;
export const PodcastSettingSchema = SchemaFactory.createForClass(PodcastSetting);

// ---- READ-ONLY views of other services' collections (writes throw, like the reel service does) ----
function lockWrites(schema: MongooseSchema, name: string) {
  for (const hook of ['save', 'updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'insertMany'] as const) {
    schema.pre(hook as any, () => {
      throw new Error(`[podcast-service] write to shared collection "${name}" is forbidden`);
    });
  }
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
  @Prop() durationSeconds?: number;
  @Prop() viewCount?: number;
  @Prop() deletedAt?: Date;
  @Prop() liveBroadcastContent?: string;
}
export type SourceVideoDocument = HydratedDocument<SourceVideo>;
export const SourceVideoSchema = SchemaFactory.createForClass(SourceVideo);
lockWrites(SourceVideoSchema, 'videos');

/** The reel service's cache record of a downloaded video (is the full video in MinIO?). */
@Schema({ collection: 'reel_sources', strict: false, versionKey: false, autoIndex: false, autoCreate: false })
export class ReelSourceView {
  @Prop() youtubeId: string;
  @Prop() videoPresent?: boolean;
  @Prop() videoKey?: string;
}
export type ReelSourceViewDocument = HydratedDocument<ReelSourceView>;
export const ReelSourceViewSchema = SchemaFactory.createForClass(ReelSourceView);
lockWrites(ReelSourceViewSchema, 'reel_sources');

/** The reel service's settings (only the encrypted YouTube cookies are read). */
@Schema({ collection: 'reel_settings', strict: false, versionKey: false, autoIndex: false, autoCreate: false })
export class ReelSettingView {
  @Prop() key: string;
  @Prop({ type: MongooseSchema.Types.Mixed }) value: any;
}
export type ReelSettingViewDocument = HydratedDocument<ReelSettingView>;
export const ReelSettingViewSchema = SchemaFactory.createForClass(ReelSettingView);
lockWrites(ReelSettingViewSchema, 'reel_settings');

@Schema({ collection: 'channels', strict: false, versionKey: false, autoIndex: false, autoCreate: false })
export class SharedChannel {
  @Prop({ type: MongooseSchema.Types.ObjectId }) userId: Types.ObjectId;
  @Prop() name: string;
}
export type SharedChannelDocument = HydratedDocument<SharedChannel>;
export const SharedChannelSchema = SchemaFactory.createForClass(SharedChannel);
lockWrites(SharedChannelSchema, 'channels');

@Schema({ collection: 'users', strict: false, versionKey: false, autoIndex: false, autoCreate: false })
export class SharedUser {
  @Prop() role?: string;
}
export type SharedUserDocument = HydratedDocument<SharedUser>;
export const SharedUserSchema = SchemaFactory.createForClass(SharedUser);
lockWrites(SharedUserSchema, 'users');
