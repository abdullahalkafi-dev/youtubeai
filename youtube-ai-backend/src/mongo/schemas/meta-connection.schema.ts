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

/** One Facebook login per app user: the Pages he shared and the Instagram accounts linked to them. */
@Schema({ timestamps: true, collection: 'meta_connections' })
export class MetaConnection {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
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
}

export const MetaConnectionSchema = SchemaFactory.createForClass(MetaConnection);
