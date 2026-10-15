import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** A spoken word with precise timing from speech-to-text (seconds in the source video). */
export interface TWord {
  w: string;
  s: number;
  e: number;
}

/**
 * A transcript line (≈ one sentence / phrase with punctuation).
 * w0..w1 = inclusive word index range in `words`.
 */
export interface TLine {
  s: number;
  e: number;
  t: string;
  w0: number;
  w1: number;
}

@Schema({ timestamps: true, collection: 'reel_transcripts' })
export class ReelTranscript {
  @Prop({ required: true, unique: true }) youtubeId: string;
  @Prop() model: string;
  @Prop() language?: string;
  @Prop() durationSec: number;
  @Prop({ type: [Object], default: [] }) lines: TLine[];
  @Prop({ type: [Object], default: [] }) words: TWord[];
}
export type ReelTranscriptDocument = HydratedDocument<ReelTranscript>;
export const ReelTranscriptSchema = SchemaFactory.createForClass(ReelTranscript);
