import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ScriptVersionDocument = HydratedDocument<ScriptVersion>;

@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'script_versions' })
export class ScriptVersion {
  @Prop({ type: Types.ObjectId, ref: 'Script', required: true, index: true })
  scriptId: Types.ObjectId;

  @Prop({ required: true })
  versionNumber: number;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  content: string;

  @Prop({ type: [Object], required: true })
  blocks: any[];

  @Prop({ default: 0 })
  wordCount: number;

  @Prop({ default: 0 })
  estimatedDurationMinutes: number;

  @Prop({ required: false })
  changeDescription?: string;

  @Prop({ enum: ['ai_generated', 'user_edit', 'manual_import', 'restored_version'], default: 'user_edit' })
  createdBy: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;
}

export const ScriptVersionSchema = SchemaFactory.createForClass(ScriptVersion);

// UNIQUE compound index guarantees no duplicate version numbers can ever exist for a script
ScriptVersionSchema.index({ scriptId: 1, versionNumber: 1 }, { unique: true });
