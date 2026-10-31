import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { LayoutSample } from '../../pipeline/layout';

/**
 * What we know about the studio layout of one source video: still frames the vision model looked at (source seconds, kind,
 * confidence, host and picture boxes in source pixels). Static for the video, so it is looked at once and reused by every
 * reel cut from it. A `version` change (layout.ts LAYOUT_VERSION) makes old samples be ignored.
 */
@Schema({ timestamps: true, collection: 'reel_layouts' })
export class ReelLayout {
  @Prop({ required: true, unique: true }) youtubeId: string;
  @Prop({ required: true }) version: string;
  @Prop() width: number;
  @Prop() height: number;
  @Prop({ type: [Object], default: [] }) samples: LayoutSample[];

  createdAt: Date;
  updatedAt: Date;
}
export type ReelLayoutDocument = HydratedDocument<ReelLayout>;
export const ReelLayoutSchema = SchemaFactory.createForClass(ReelLayout);
