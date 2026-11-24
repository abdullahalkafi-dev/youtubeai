import { Inject, Injectable, Optional } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  SharedChannel,
  SharedChannelDocument,
  SharedMetaConnection,
  SharedMetaConnectionDocument,
} from '../db/schemas/shared.readonly';
import { PublishError } from './types';

type StoredPage = NonNullable<SharedMetaConnection['pages']>[number];

/** What callers may see about the connected Page. Never carries a token. */
export interface MetaPageIdentity {
  pageId: string;
  name: string;
  instagramId?: string;
  /** More than one Page was shared; the first one is used (see `pickPage`). */
  extraPages: number;
  /** The long-lived user token's expiry (Page tokens derived from it are what we publish with). */
  tokenExpiresAt?: Date;
}

/**
 * The Page we publish to for a channel: the first Page in the login (assumption, see MetaTokenProvider).
 * Pure so it can be tested without a database.
 */
export function pickPage(pages: StoredPage[] | undefined | null, preferredId?: string): StoredPage | null {
  const usable = (pages ?? []).filter((p) => p && p.pageId && p.accessToken);
  // A pinned Page is the only one ever used: if it is missing from the login we stop, never post to another Page.
  if (preferredId) return usable.find((p) => String(p.pageId) === preferredId) ?? null;
  return usable[0] ?? null;
}

/**
 * Gives the Facebook publisher the connected Page and its access token, from the main app's `meta_connections`
 * (written by the backend's Meta login; READ-ONLY here, nothing is written back and nothing is ever logged).
 *
 * ASSUMPTION (channel -> Page): the Meta connection belongs to the app USER, the reel service works per CHANNEL.
 * Today one user owns one channel and shared one Page, so a channel publishes to the connected Page of its owner
 * (`channel.userId`, never the caller). If a login ever shares several Pages the first one is used and `extraPages`
 * says so, until a per-channel Page choice exists.
 */
@Injectable()
export class MetaTokenProvider {
  constructor(
    @InjectModel(SharedChannel.name) private readonly channels: Model<SharedChannelDocument>,
    @InjectModel(SharedMetaConnection.name) private readonly connections: Model<SharedMetaConnectionDocument>,
    @Optional() @Inject(CONFIG) private readonly cfg?: AppConfig,
  ) {}

  /** The pinned Page (FACEBOOK_PAGE_ID), or undefined to use the first Page of the login. */
  private get pinned(): string | undefined {
    return this.cfg?.FACEBOOK_PAGE_ID?.trim() || undefined;
  }

  private async load(channelId: string) {
    const channel = await this.channels.findById(channelId).select('userId').lean();
    if (!channel) throw new PublishError('fatal', 'Channel not found');
    return this.connections
      .findOne({ userId: new Types.ObjectId(String(channel.userId)) })
      .select('+pages userTokenExpiresAt')
      .lean();
  }

  /** The connected Page without any token, or null when Facebook is not connected. */
  async identity(channelId: string): Promise<MetaPageIdentity | null> {
    const conn = await this.load(channelId);
    const page = pickPage(conn?.pages, this.pinned);
    if (!conn || !page) return null;
    return {
      pageId: page.pageId,
      name: page.name,
      instagramId: page.instagram?.id,
      extraPages: Math.max(0, (conn.pages ?? []).length - 1),
      tokenExpiresAt: conn.userTokenExpiresAt ? new Date(conn.userTokenExpiresAt) : undefined,
    };
  }

  /** The Page id and its access token for publishing. Throws an `auth` error (the app must be reconnected) when there is none. */
  async page(channelId: string): Promise<{ pageId: string; name: string; accessToken: string }> {
    const conn = await this.load(channelId);
    const page = pickPage(conn?.pages, this.pinned);
    if (!conn || !page) {
      throw new PublishError('auth', 'No Facebook Page is connected. Connect Facebook in the app Settings.', 'no_meta_connection');
    }
    if (conn.userTokenExpiresAt && new Date(conn.userTokenExpiresAt).getTime() <= Date.now()) {
      throw new PublishError('auth', 'The Facebook login has expired. Reconnect Facebook in the app Settings.', 'meta_token_expired');
    }
    return { pageId: page.pageId, name: page.name, accessToken: page.accessToken };
  }
}
