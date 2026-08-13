import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TrendingTopicDocument = HydratedDocument<TrendingTopic>;

@Schema({ timestamps: { createdAt: 'fetchedAt', updatedAt: false }, collection: 'trending_topics' })
export class TrendingTopic {
  @Prop({ type: Types.ObjectId, ref: 'Channel', required: true, index: true })
  channelId: Types.ObjectId;

  @Prop({ required: true })
  title: string;

  @Prop({ default: '' })
  summary: string;

  @Prop()
  source?: string;

  @Prop()
  sourceUrl?: string;

  @Prop()
  publishedAt?: Date;

  // YouTube video match
  @Prop()
  youtubeVideoId?: string;

  @Prop()
  youtubeThumbnailUrl?: string;

  @Prop()
  youtubeChannelTitle?: string;

  @Prop()
  youtubeVideoUrl?: string;

  // Quality logging
  @Prop()
  extractedEntity?: string;

  // Opportunity scoring
  @Prop({ default: 0 })
  opportunityScore: number;

  @Prop()
  opportunityLabel?: string;

  // Real data signals (not AI-guessed)
  @Prop({ default: 0 })
  searchDemand: number; // 0-100, from autocomplete frequency

  @Prop({ default: 0 })
  channelFit: number; // 0-100, from ChromaDB RAG similarity

  @Prop({ default: 'web_search' })
  sourceType: string; // 'web_search' | 'most_popular' | 'rss_news' | 'lite'

  @Prop()
  badge?: string; // 'viral' | 'gap' | 'breaking'

  // RAG embedding
  @Prop({ type: [Number] })
  embedding?: number[];
}

export const TrendingTopicSchema = SchemaFactory.createForClass(TrendingTopic);
