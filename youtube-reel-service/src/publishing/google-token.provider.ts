import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppConfig, CONFIG } from '../config/config';
import { SharedChannel, SharedChannelDocument, SharedUser, SharedUserDocument } from '../db/schemas/shared.readonly';
import { PublishError } from './types';

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
/** Reuse the stored access token only while it has at least this much life left. */
const MIN_REMAINING_MS = 10 * 60_000;

/** Scopes that Google accepts for `videos.insert` (any one is enough). */
export const UPLOAD_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtubepartner',
  'https://www.googleapis.com/auth/youtube.force-ssl',
];

export interface ChannelIdentity {
  channelId: string;
  userId: string;
  youtubeChannelId?: string;
  name: string;
  handle?: string;
}

/**
 * Gives the publisher a valid Google access token for a channel, using the main app's existing login.
 *
 * - The token is resolved from the channel's OWNER (`channel.userId`), never from the caller, so an ADMIN
 *   pressing Publish can't upload with their own Google identity.
 * - It only READS the main app's `users` document. New access tokens are minted from the refresh token and
 *   kept in memory; nothing is written back and nothing is ever logged.
 */
@Injectable()
export class GoogleTokenProvider {
  private readonly logger = new Logger(GoogleTokenProvider.name);
  private readonly cache = new Map<string, { token: string; expiresAt: number }>();
  private readonly inflight = new Map<string, Promise<string>>();
  private readonly scopeCache = new Map<string, { ok: boolean; known: boolean; at: number }>();

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @InjectModel(SharedChannel.name) private readonly channels: Model<SharedChannelDocument>,
    @InjectModel(SharedUser.name) private readonly users: Model<SharedUserDocument>,
  ) {}

  /** Overridable in tests. */
  fetchFn: typeof fetch = (input, init) => fetch(input, init);

  async identity(channelId: string): Promise<ChannelIdentity> {
    const channel = await this.channels.findById(channelId).lean();
    if (!channel) throw new PublishError('fatal', 'Channel not found');
    return {
      channelId,
      userId: String(channel.userId),
      youtubeChannelId: channel.youtubeChannelId,
      name: channel.name,
      handle: channel.handle,
    };
  }

  /** A valid access token for the channel's owner. `forceRefresh` skips the stored/cached one (used after a 401). */
  async getAccessToken(channelId: string, opts: { forceRefresh?: boolean } = {}): Promise<string> {
    const { userId } = await this.identity(channelId);
    const cached = this.cache.get(userId);
    if (!opts.forceRefresh && cached && cached.expiresAt - Date.now() > MIN_REMAINING_MS) return cached.token;

    const pending = this.inflight.get(userId);
    if (pending && !opts.forceRefresh) return pending;
    const run = this.resolve(userId, !!opts.forceRefresh).finally(() => this.inflight.delete(userId));
    this.inflight.set(userId, run);
    return run;
  }

  private async resolve(userId: string, forceRefresh: boolean): Promise<string> {
    const user = await this.users
      .findById(new Types.ObjectId(userId))
      .select('+accessToken +refreshToken +tokenExpiresAt')
      .lean();
    if (!user || (!user.accessToken && !user.refreshToken)) {
      throw new PublishError('auth', 'The channel owner has no Google connection. Reconnect Google in the app.', 'no_token');
    }

    const expiresAt = user.tokenExpiresAt ? new Date(user.tokenExpiresAt).getTime() : 0;
    if (!forceRefresh && user.accessToken && expiresAt - Date.now() > MIN_REMAINING_MS) {
      this.cache.set(userId, { token: user.accessToken, expiresAt });
      return user.accessToken;
    }
    if (!user.refreshToken) {
      throw new PublishError('auth', 'Google session expired and there is no refresh token. Reconnect Google in the app.', 'no_refresh_token');
    }
    return this.refresh(userId, user.refreshToken);
  }

  private async refresh(userId: string, refreshToken: string): Promise<string> {
    if (!this.cfg.GOOGLE_CLIENT_ID || !this.cfg.GOOGLE_CLIENT_SECRET) {
      throw new PublishError('fatal', 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured for the reel service', 'no_client');
    }
    let res: Response;
    try {
      res = await this.fetchFn(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.cfg.GOOGLE_CLIENT_ID,
          client_secret: this.cfg.GOOGLE_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new PublishError('transient', `Could not reach Google to refresh the token: ${(err as Error).message}`);
    }
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = String(body.error ?? res.status);
      if (code === 'invalid_grant' || code === 'invalid_request' || code === 'unauthorized_client') {
        this.cache.delete(userId);
        throw new PublishError('auth', 'Google rejected the stored login (expired or revoked). Reconnect Google in the app.', code, res.status);
      }
      throw new PublishError(res.status >= 500 ? 'transient' : 'fatal', `Token refresh failed (${code})`, code, res.status);
    }
    const expiresIn = Number(body.expires_in ?? 3600);
    const token = String(body.access_token);
    this.cache.set(userId, { token, expiresAt: Date.now() + expiresIn * 1000 });
    return token;
  }

  /**
   * Best-effort check that the token's scopes allow uploading. `known: false` means Google could not tell us
   * (network); callers should then just try — a real permission problem surfaces as a 403 on upload.
   */
  async canUpload(accessToken: string): Promise<{ ok: boolean; known: boolean; scopes: string[] }> {
    const hit = this.scopeCache.get(accessToken);
    if (hit && Date.now() - hit.at < 30 * 60_000) return { ok: hit.ok, known: hit.known, scopes: [] };
    try {
      const res = await this.fetchFn(`${TOKENINFO_URL}?access_token=${encodeURIComponent(accessToken)}`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`tokeninfo ${res.status}`);
      const info: any = await res.json();
      const scopes = String(info.scope ?? '').split(/\s+/).filter(Boolean);
      const ok = scopes.some((s) => UPLOAD_SCOPES.includes(s));
      this.scopeCache.set(accessToken, { ok, known: true, at: Date.now() });
      return { ok, known: true, scopes };
    } catch (err) {
      this.logger.warn(`Scope check unavailable: ${(err as Error).message}`);
      return { ok: true, known: false, scopes: [] };
    }
  }
}
