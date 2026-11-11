import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  MetaConnection,
  MetaConnectionDocument,
  MetaPage,
} from '../mongo/schemas/meta-connection.schema';
import { createMetaState, verifyMetaState } from './meta-state';

/** Pinned Graph API version: v26.0, released 2026-07-29 (Meta Graph API changelog). */
export const META_GRAPH_VERSION = 'v26.0';

const DEFAULT_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'read_insights',
  'pages_read_user_content',
  'pages_manage_engagement',
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_insights',
  'business_management',
];

const PAGE_FIELDS =
  'id,name,access_token,instagram_business_account{id,username,name,profile_picture_url,followers_count,media_count}';

export type MetaCallbackResult =
  | { ok: true; pages: number }
  | { ok: false; reason: 'not_configured' | 'access_denied' | 'invalid_state' | 'missing_code' | 'exchange_failed' };

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface GraphErrorBody {
  error?: { message?: string };
}

interface GraphPage {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: {
    id: string;
    username?: string;
    name?: string;
    profile_picture_url?: string;
    followers_count?: number;
    media_count?: number;
  };
}

@Injectable()
export class MetaService {
  private readonly logger = new Logger(MetaService.name);

  constructor(
    @InjectModel(MetaConnection.name)
    private readonly connectionModel: Model<MetaConnectionDocument>,
    private readonly configService: ConfigService,
  ) {}

  private get appId(): string {
    return this.configService.get<string>('META_APP_ID') || '';
  }

  private get appSecret(): string {
    return this.configService.get<string>('META_APP_SECRET') || '';
  }

  private get redirectUri(): string {
    return this.configService.get<string>('META_REDIRECT_URI') || '';
  }

  private get stateSecret(): string {
    return this.configService.get<string>('JWT_SECRET') || '';
  }

  private get graphBase(): string {
    const version = this.configService.get<string>('META_GRAPH_VERSION') || META_GRAPH_VERSION;
    return `https://graph.facebook.com/${version}`;
  }

  isConfigured(): boolean {
    return Boolean(this.appId && this.appSecret && this.redirectUri && this.stateSecret);
  }

  /** The Facebook login dialog URL the browser must be sent to. */
  buildAuthUrl(userId: string): string {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('Meta login is not configured on this server');
    }
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.redirectUri,
      state: createMetaState(userId, this.stateSecret),
      response_type: 'code',
    });
    const configId = this.configService.get<string>('META_LOGIN_CONFIG_ID');
    if (configId) {
      // Facebook Login for Business: the Configuration decides the permissions.
      params.set('config_id', configId);
      params.set('override_default_response_type', 'true');
    } else {
      params.set('scope', DEFAULT_SCOPES.join(','));
    }
    const version = this.configService.get<string>('META_GRAPH_VERSION') || META_GRAPH_VERSION;
    return `https://www.facebook.com/${version}/dialog/oauth?${params.toString()}`;
  }

  /** Handles Meta's redirect back: verify state, swap the code for tokens, store the Pages. */
  async handleCallback(query: {
    code?: string;
    state?: string;
    error?: string;
    error_reason?: string;
  }): Promise<MetaCallbackResult> {
    if (!this.isConfigured()) return { ok: false, reason: 'not_configured' };

    const userId = verifyMetaState(query.state, this.stateSecret);
    if (!userId) return { ok: false, reason: 'invalid_state' };

    if (query.error || query.error_reason) {
      this.logger.warn(`Meta login declined: ${query.error_reason || query.error}`);
      return { ok: false, reason: 'access_denied' };
    }
    if (!query.code) return { ok: false, reason: 'missing_code' };

    try {
      const short = await this.exchangeCode(query.code);
      const long = await this.extendToken(short);
      const metaUserId = await this.fetchMetaUserId(long.token);
      const pages = await this.fetchPages(long.token);

      await this.connectionModel.findOneAndUpdate(
        { userId: new Types.ObjectId(userId) },
        {
          userId: new Types.ObjectId(userId),
          metaUserId,
          userAccessToken: long.token,
          userTokenExpiresAt: long.expiresAt,
          pages,
          connectedAt: new Date(),
        },
        { upsert: true, new: true },
      );
      this.logger.log(`Meta connected for user ${userId}: ${pages.length} page(s)`);
      return { ok: true, pages: pages.length };
    } catch (err) {
      // Message only: never the request URL, code or tokens.
      this.logger.error(`Meta token exchange failed: ${(err as Error).message}`);
      return { ok: false, reason: 'exchange_failed' };
    }
  }

  /** Connected Pages and Instagram accounts. Tokens are never included. */
  async listAccounts(userId: string) {
    const doc = await this.connectionModel.findOne({ userId: new Types.ObjectId(userId) }).lean();
    if (!doc) return { connected: false, pages: [] };
    return {
      connected: true,
      connectedAt: doc.connectedAt,
      tokenExpiresAt: doc.userTokenExpiresAt,
      pages: (doc.pages || []).map((p) => ({
        pageId: p.pageId,
        name: p.name,
        instagram: p.instagram,
      })),
    };
  }

  /** Removes the stored tokens and data, and asks Meta to revoke the app's access (best effort). */
  async disconnect(userId: string): Promise<{ disconnected: boolean }> {
    const doc = await this.connectionModel.findOneAndDelete({ userId: new Types.ObjectId(userId) }).lean();
    if (!doc) return { disconnected: false };
    try {
      const url = `${this.graphBase}/me/permissions?${new URLSearchParams({ access_token: doc.userAccessToken })}`;
      await fetch(url, { method: 'DELETE' });
    } catch {
      this.logger.warn('Meta permission revoke failed; stored data was deleted anyway');
    }
    return { disconnected: true };
  }

  private async graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
    const res = await fetch(`${this.graphBase}${path}?${new URLSearchParams(params)}`);
    const body = (await res.json().catch(() => ({}))) as T & GraphErrorBody;
    if (!res.ok || body.error) {
      throw new Error(`Graph ${path} ${res.status}: ${body.error?.message || 'request failed'}`);
    }
    return body;
  }

  private async exchangeCode(code: string): Promise<{ token: string; expiresAt?: Date }> {
    const body = await this.graphGet<TokenResponse>('/oauth/access_token', {
      client_id: this.appId,
      client_secret: this.appSecret,
      redirect_uri: this.redirectUri,
      code,
    });
    if (!body.access_token) throw new Error('No access_token in code exchange');
    return { token: body.access_token, expiresAt: this.expiry(body.expires_in) };
  }

  /** Swap for a ~60-day token. Business-login tokens may not need it, so fall back to the one we have. */
  private async extendToken(short: { token: string; expiresAt?: Date }): Promise<{ token: string; expiresAt?: Date }> {
    try {
      const body = await this.graphGet<TokenResponse>('/oauth/access_token', {
        grant_type: 'fb_exchange_token',
        client_id: this.appId,
        client_secret: this.appSecret,
        fb_exchange_token: short.token,
      });
      if (!body.access_token) return short;
      return { token: body.access_token, expiresAt: this.expiry(body.expires_in) };
    } catch (err) {
      this.logger.warn(`Long-lived token exchange skipped: ${(err as Error).message}`);
      return short;
    }
  }

  private expiry(expiresIn?: number): Date | undefined {
    return expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined;
  }

  private async fetchMetaUserId(token: string): Promise<string> {
    const me = await this.graphGet<{ id: string }>('/me', { fields: 'id', access_token: token });
    return me.id;
  }

  private async fetchPages(token: string): Promise<MetaPage[]> {
    const body = await this.graphGet<{ data?: GraphPage[] }>('/me/accounts', {
      fields: PAGE_FIELDS,
      limit: '100',
      access_token: token,
    });
    return (body.data || []).map((p) => ({
      pageId: p.id,
      name: p.name,
      accessToken: p.access_token,
      instagram: p.instagram_business_account
        ? {
            id: p.instagram_business_account.id,
            username: p.instagram_business_account.username,
            name: p.instagram_business_account.name,
            profilePictureUrl: p.instagram_business_account.profile_picture_url,
            followersCount: p.instagram_business_account.followers_count,
            mediaCount: p.instagram_business_account.media_count,
          }
        : undefined,
    }));
  }
}
