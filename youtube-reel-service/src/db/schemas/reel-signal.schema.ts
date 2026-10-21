import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export interface SignalShare {
  key: string;
  views3d: number;
  share3d: number;
}

/**
 * One document per channel per New York day: what the Daily Brain saw when it chose the day's topics.
 * Kept so choices can be audited and, once enough days exist, back-tested ("would this score have ranked what later earned views?").
 */
@Schema({ timestamps: true, collection: 'reel_signals' })
export class ReelSignal {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) channelId: Types.ObjectId;
  @Prop({ required: true }) date: string;
  /** Own channel (video_daily_stats): the window ends at the newest day that has data. */
  @Prop({ type: Object }) own?: {
    through: string;
    views3d: number;
    views14d: number;
    byEntity: SignalShare[];
    byPillar: SignalShare[];
    topVideos: Array<{ youtubeId: string; title: string; views3d: number }>;
    /** The channel's most watched videos of the last 3 days (up to 40): lets any topic, even one nobody tracked as a person, be matched to real traffic. */
    videos?: Array<{ title: string; views3d: number }>;
  };
  /** The main app's trend scan as the brain could use it. */
  @Prop({ type: Object }) trends?: {
    count: number;
    usable: number;
    freshestAt: Date | null;
    ageHours: number | null;
    top: Array<{ title: string; score: number | null; ageHours: number; source: string | null }>;
  };
  /** Why the day's picture is incomplete (stale trends, no own stats...). */
  @Prop({ type: [String], default: [] }) degraded: string[];
}
export type ReelSignalDocument = HydratedDocument<ReelSignal>;
export const ReelSignalSchema = SchemaFactory.createForClass(ReelSignal);
ReelSignalSchema.index({ channelId: 1, date: 1 }, { unique: true });
