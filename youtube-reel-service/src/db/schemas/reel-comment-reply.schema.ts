import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export const REPLY_DECISIONS = ['queued', 'replied', 'dry_run', 'skipped', 'failed'] as const;
export type ReplyDecision = (typeof REPLY_DECISIONS)[number];

/**
 * One row per comment the reply lane has looked at (the audit trail of the Facebook comment replies, see FACEBOOK-COMMENT-REPLIES.md).
 *  - queued:   a reply was written and approved by the rules; it waits for its turn (random gaps, daily cap)
 *  - replied:  the reply is posted (`replyId` is Facebook's id of it)
 *  - dry_run:  the lane is in FACEBOOK_REPLY_AUTO=dry: this is what WOULD have been posted; nothing was sent to Facebook
 *  - skipped:  the rules or the model decided not to reply (`skipReason` says why); final, never retried
 *  - failed:   posting failed 3 times (`error` / `errorCode`)
 * A comment has exactly one row (unique on platform + commentId), so nothing is ever answered twice.
 */
@Schema({ timestamps: true, collection: 'reel_comment_replies' })
export class ReelCommentReply {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) channelId: Types.ObjectId;
  /** Our reel_posts row of the reel the comment is on. */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) postId: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId }) reelId?: Types.ObjectId;
  @Prop({ type: String, enum: ['facebook', 'instagram'], default: 'facebook' }) platform: string;
  /** Facebook's id of the reel video the comment is on. */
  @Prop() externalPostId?: string;
  @Prop({ required: true }) commentId: string;
  /** The comment, cut to 500 characters (kept so an audit can read what was answered). */
  @Prop() commentText?: string;
  @Prop() commentCreatedAt?: Date;
  @Prop({ type: String, enum: REPLY_DECISIONS, required: true }) decision: ReplyDecision;
  @Prop() skipReason?: string;
  @Prop() replyText?: string;
  @Prop() replyId?: string;
  @Prop() tone?: string;
  /** The lane mode when the decision was made: 'dry' or 'on'. */
  @Prop() mode?: string;
  @Prop({ default: 0 }) attempts: number;
  @Prop() error?: string;
  @Prop() errorCode?: string;
  @Prop() queuedAt?: Date;
  @Prop() repliedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}
export type ReelCommentReplyDocument = HydratedDocument<ReelCommentReply>;
export const ReelCommentReplySchema = SchemaFactory.createForClass(ReelCommentReply);
ReelCommentReplySchema.index({ platform: 1, commentId: 1 }, { unique: true });
ReelCommentReplySchema.index({ channelId: 1, decision: 1, updatedAt: -1 });
