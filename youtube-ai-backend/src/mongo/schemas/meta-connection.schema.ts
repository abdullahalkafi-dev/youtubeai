import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MetaConnectionDocument = HydratedDocument<MetaConnection>;

export interface MetaInstagramAccount {
  id: string;
  username?: string;
  name?: string;
  profilePictureUrl?: string;
  followersCount?: number;
  mediaCount?: number;
}

export interface MetaPage {
  pageId: string;
  name: string;
  /** Page access token — never returned by the API. */
  accessToken: string;
  instagram?: MetaInstagramAccount;
}

/**
 * One Facebook login per (app user, Meta account): the Pages that account shared and the Instagram accounts linked to them.
 * An app user can hold several logins side by side (e.g. the account that runs the reels Page and the account that runs the
 * Instagram Page); reconnecting one account replaces only that account's document.
 */
@Schema({ timestamps: true, collection: 'meta_connections' })
export class MetaConnection {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  metaUserId: string;

  /** Long-lived user token — never returned by the API. */
  @Prop({ required: true })
  userAccessToken: string;

  @Prop()
  userTokenExpiresAt?: Date;

  @Prop({ type: [Object], default: [] })
  pages: MetaPage[];

  @Prop()
  connectedAt?: Date;

  /**
   * What Meta reported at the moment of the last login (no tokens): permissions granted and declined, token type, issue and expiry
   * dates, Pages and Instagram accounts seen. Written for audit only: when a token later stops working, compare it with this.
   */
  @Prop({ type: Object })
  loginAudit?: Record<string, unknown>;
}

export const MetaConnectionSchema = SchemaFactory.createForClass(MetaConnection);
// The old single-field unique index on userId is dropped at startup by MetaService.ensureIndexes (Mongoose never drops indexes itself).
MetaConnectionSchema.index({ userId: 1, metaUserId: 1 }, { unique: true });
