import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ScriptDocument = HydratedDocument<Script>;

@Schema({ timestamps: true, collection: 'scripts' })
export class Script {
  @Prop({ type: Types.ObjectId, ref: 'Channel', required: true, index: true })
  channelId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Thread', index: true, required: false })
  threadId?: Types.ObjectId; // Soft loose reference (null if thread deleted)

  @Prop({ required: false })
  messageId?: string; // Originating message ID in thread

  @Prop({ required: false })
  videoId?: string; // Optional YouTube Video ID

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true })
  content: string; // Current raw teleprompter markdown

  @Prop({ type: [Object], default: [] })
  blocks: any[]; // Current BlockNote JSON representation

  @Prop({ default: 0 })
  wordCount: number;

  @Prop({ default: 0 })
  estimatedDurationMinutes: number; // Calculated at ~130-150 WPM

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ enum: ['ai_chat', 'manual_import', 'ai_beautified'], default: 'ai_chat' })
  source: string;

  @Prop({ enum: ['teleprompter_beat', 'standard_markdown', 'raw_text'], default: 'teleprompter_beat' })
  formatType: string;

  @Prop({ default: false })
  isFavorite: boolean;

  @Prop({ enum: ['synced', 'pending', 'failed'], default: 'pending', index: true })
  vectorSyncStatus: string;

  @Prop({ default: 1 })
  currentVersion: number;
}

export const ScriptSchema = SchemaFactory.createForClass(Script);

// Compound Full-Text Search Index with Field Weights
ScriptSchema.index(
  { title: 'text', content: 'text', tags: 'text' },
  { weights: { title: 10, tags: 5, content: 1 }, name: 'ScriptTextIndex' }
);
