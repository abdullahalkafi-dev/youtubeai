import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
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
  // Comments under Instagram reels (the link comment now; replies later). Must be on the app's Instagram use case first (it is, 2026-11-28).
  'instagram_manage_comments',
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

/** The index the collection had while it held one login per app user. It must go before a second login can be stored. */
const LEGACY_USER_INDEX = 'userId_1';

@Injectable()
export class MetaService implements OnModuleInit {
  private readonly logger = new Logger(MetaService.name);

  constructor(
    @InjectModel(MetaConnection.name)
    private readonly connectionModel: Model<MetaConnectionDocument>,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    await this.ensureIndexes();
  }

  /**
   * One-time, idempotent: drop the old UNIQUE single-field `userId_1` index (it would reject a second Meta login of the same
   * app user), then make sure the schema's unique (userId, metaUserId) index exists. Only that one index is ever dropped, never
   * data and never other indexes. It must not stop the app from booting, so any failure is logged and swallowed.
   */
  async ensureIndexes(): Promise<void> {
    try {
      const indexes = (await this.connectionModel.collection.indexes()) as Array<{ name?: string; unique?: boolean; key?: Record<string, number> }>;
      const legacy = indexes.find((i) => i.name === LEGACY_USER_INDEX && i.unique && Object.keys(i.key ?? {}).join() === 'userId');
      if (legacy) {
        await this.connectionModel.collection.dropIndex(LEGACY_USER_INDEX);
        this.logger.log('Dropped the old one-login-per-user index on meta_connections');
      }
    } catch (err) {
      this.logger.warn(`Could not check or drop the old meta_connections index: ${(err as Error).message}`);
    }
    try {
      await this.connectionModel.createIndexes();
    } catch (err) {
      this.logger.warn(`Could not create the meta_connections indexes: ${(err as Error).message}`);
    }
  }

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
      const loginAudit = await this.auditLogin(long.token, userId, metaUserId, pages);

      // One document per Meta account: reconnecting the same account renews it, a different account is stored next to it.
      await this.connectionModel.findOneAndUpdate(
        { userId: new Types.ObjectId(userId), metaUserId },
        {
          userId: new Types.ObjectId(userId),
          metaUserId,
          userAccessToken: long.token,
          // null (not undefined) so a login Meta gives no expiry for does not keep the previous login's old date.
          userTokenExpiresAt: long.expiresAt ?? null,
          pages,
          connectedAt: new Date(),
          loginAudit,
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

  /**
   * Connected Pages and Instagram accounts of every Facebook login of this app user. Tokens are never included.
   * `pages` is every Page of every login in one list (each tagged with its `loginId`), `connectedAt` the newest login and
   * `tokenExpiresAt` the soonest expiry, so callers written for a single login keep working; `logins` has the per-account detail.
   */
  async listAccounts(userId: string) {
    const docs = await this.connectionModel.find({ userId: new Types.ObjectId(userId) }).sort({ connectedAt: 1 }).lean();
    if (!docs.length) return { connected: false, pages: [], logins: [] };

    const logins = docs.map((d) => ({
      loginId: d.metaUserId,
      connectedAt: d.connectedAt,
      tokenExpiresAt: d.userTokenExpiresAt,
      pages: (d.pages || []).map((p) => ({ pageId: p.pageId, name: p.name, instagram: p.instagram })),
    }));
    const times = (xs: Array<Date | undefined>) => xs.filter(Boolean).map((x) => new Date(x as Date).getTime());
    const connected = times(logins.map((l) => l.connectedAt));
    const expiries = times(logins.map((l) => l.tokenExpiresAt));
    return {
      connected: true,
      connectedAt: connected.length ? new Date(Math.max(...connected)) : undefined,
      tokenExpiresAt: expiries.length ? new Date(Math.min(...expiries)) : undefined,
      pages: logins.flatMap((l) => l.pages.map((p) => ({ ...p, loginId: l.loginId }))),
      logins,
    };
  }

  /**
   * Removes stored tokens and data and asks Meta to revoke the app's access (best effort). Without `loginId` every login of the
   * user goes (the Data Deletion page promises this); with it only that Meta account's login.
   */
  async disconnect(userId: string, loginId?: string): Promise<{ disconnected: boolean }> {
    const owner = new Types.ObjectId(userId);
    let docs: Array<{ userAccessToken: string }>;
    if (loginId) {
      const one = await this.connectionModel.findOneAndDelete({ userId: owner, metaUserId: loginId }).lean();
      docs = one ? [one] : [];
    } else {
      docs = await this.connectionModel.find({ userId: owner }).lean();
      if (docs.length) await this.connectionModel.deleteMany({ userId: owner });
    }
    if (!docs.length) return { disconnected: false };
    for (const doc of docs) {
      try {
        const url = `${this.graphBase}/me/permissions?${new URLSearchParams({ access_token: doc.userAccessToken })}`;
        await fetch(url, { method: 'DELETE' });
      } catch {
        this.logger.warn('Meta permission revoke failed; stored data was deleted anyway');
      }
    }
    return { disconnected: true };
  }

  /**
   * Records what Meta says about a fresh login (permissions granted/declined, token type, dates) in the log and on the connection, so a
   * token that stops working later can be compared with how it looked at login. Never throws and never records a token: a failed check
   * is noted in the audit and the login still succeeds.
   */
  private async auditLogin(token: string, userId: string, metaUserId: string, pages: MetaPage[]): Promise<Record<string, unknown>> {
    const audit: Record<string, unknown> = {
      at: new Date(),
      pages: pages.map((p) => ({ pageId: p.pageId, name: p.name, instagramId: p.instagram?.id ?? null })),
    };
    try {
      const perms = await this.graphGet<{ data?: Array<{ permission: string; status: string }> }>('/me/permissions', { access_token: token });
      const list = perms.data ?? [];
      audit.granted = list.filter((p) => p.status === 'granted').map((p) => p.permission);
      audit.declined = list.filter((p) => p.status !== 'granted').map((p) => p.permission);
      audit.missing = DEFAULT_SCOPES.filter((s) => !(audit.granted as string[]).includes(s));
    } catch (err) {
      audit.permissionsError = (err as Error).message.slice(0, 200);
    }
    try {
      const dbg = await this.graphGet<{ data?: Record<string, any> }>('/debug_token', { input_token: token, access_token: `${this.appId}|${this.appSecret}` });
      const d = dbg.data ?? {};
      const iso = (s?: number) => (s ? new Date(s * 1000).toISOString() : null);
      audit.token = {
        type: d.type ?? null,
        valid: d.is_valid ?? null,
        appId: d.app_id ?? null,
        issuedAt: iso(d.issued_at),
        expiresAt: iso(d.expires_at),
        dataAccessExpiresAt: iso(d.data_access_expires_at),
        scopes: d.scopes ?? [],
        granular: (d.granular_scopes ?? []).map((g: { scope: string; target_ids?: string[] }) => ({ scope: g.scope, targets: g.target_ids?.length ?? 0 })),
      };
    } catch (err) {
      audit.debugTokenError = (err as Error).message.slice(0, 200);
    }
    this.logger.log(`Meta login audit for user ${userId} / Meta account ${metaUserId}: ${JSON.stringify({ ...audit, pages: pages.length })}`);
    return audit;
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
