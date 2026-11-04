import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { OpsReportBody } from '../../pipeline/ops-report';

/**
 * Developer-only daily health record of the reel pipeline (one per channel per New York day). Never shown to the client: it is read with
 * the `ops:report` CLI command or straight from Mongo when auditing. See youtube-reel-service/OPS-AUDIT.md.
 */
@Schema({ timestamps: true, collection: 'reel_ops_reports' })
export class ReelOpsReport {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) channelId: Types.ObjectId;
  /** YYYY-MM-DD in America/New_York. */
  @Prop({ required: true }) date: string;
  @Prop({ required: true }) generatedAt: Date;
  /** Plain-language problems found for the day, most important first; empty on a healthy day. */
  @Prop({ type: [String], default: [] }) issues: string[];
  @Prop({ type: Object, required: true }) body: OpsReportBody;
}
export type ReelOpsReportDocument = HydratedDocument<ReelOpsReport>;
export const ReelOpsReportSchema = SchemaFactory.createForClass(ReelOpsReport);
ReelOpsReportSchema.index({ channelId: 1, date: -1 }, { unique: true });
