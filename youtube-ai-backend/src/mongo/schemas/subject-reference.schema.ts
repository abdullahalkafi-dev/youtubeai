import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SubjectReferenceDocument = SubjectReference & Document;

@Schema({ timestamps: true, collection: 'subject_references' })
export class SubjectReference {
  @Prop({ required: true, unique: true, index: true })
  canonicalName: string;

  @Prop({ required: true })
  displayName: string;

  @Prop({ default: 'Key Subject' })
  role: string;

  @Prop({ required: true })
  imageUrl: string;

  @Prop()
  originalSourceUrl?: string;

  @Prop({ default: 'web', enum: ['wikipedia', 'web', 'manual'] })
  source: string;

  @Prop({ default: 1 })
  searchCount: number;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const SubjectReferenceSchema =
  SchemaFactory.createForClass(SubjectReference);
SubjectReferenceSchema.index({ canonicalName: 1 });
