import { ServiceUnavailableException } from '@nestjs/common';
import { MetaService } from './meta.service';
import { createMetaState } from './meta-state';

const USER = '64b7f0c2a1b2c3d4e5f60718';
const ENV: Record<string, string> = {
  META_APP_ID: 'app-id',
  META_APP_SECRET: 'app-secret',
  META_REDIRECT_URI: 'https://meccaaudio.com/api/auth/meta/callback',
  JWT_SECRET: 'jwt-secret',
};

function makeService(env: Record<string, string> = ENV) {
  const model = {
    findOneAndUpdate: jest.fn().mockResolvedValue({}),
    findOne: jest.fn(),
    findOneAndDelete: jest.fn(),
  };
  const config = { get: (k: string) => env[k] };
  const service = new MetaService(model as never, config as never);
  return { service, model };
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

describe('MetaService', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  describe('buildAuthUrl', () => {
    it('throws a clear error when env is missing', () => {
      const { service } = makeService({});
      expect(service.isConfigured()).toBe(false);
      expect(() => service.buildAuthUrl(USER)).toThrow(ServiceUnavailableException);
    });

    it('uses the scope list by default', () => {
      const url = new URL(makeService().service.buildAuthUrl(USER));
      expect(url.origin + url.pathname).toBe('https://www.facebook.com/v26.0/dialog/oauth');
      expect(url.searchParams.get('client_id')).toBe('app-id');
      expect(url.searchParams.get('redirect_uri')).toBe(ENV.META_REDIRECT_URI);
      expect(url.searchParams.get('scope')).toContain('instagram_content_publish');
      expect(url.searchParams.get('config_id')).toBeNull();
      expect(url.searchParams.get('state')).toBeTruthy();
      expect(url.toString()).not.toContain('app-secret');
    });

    it('uses config_id when a Configuration is set', () => {
      const { service } = makeService({ ...ENV, META_LOGIN_CONFIG_ID: '12345' });
      const url = new URL(service.buildAuthUrl(USER));
      expect(url.searchParams.get('config_id')).toBe('12345');
      expect(url.searchParams.get('override_default_response_type')).toBe('true');
      expect(url.searchParams.get('scope')).toBeNull();
    });
  });

  describe('handleCallback', () => {
    it('reports not_configured', async () => {
      const { service } = makeService({});
      expect(await service.handleCallback({ code: 'c', state: 's' })).toEqual({ ok: false, reason: 'not_configured' });
    });

    it('rejects a bad state before any network call', async () => {
      global.fetch = jest.fn();
      const { service } = makeService();
      expect(await service.handleCallback({ code: 'c', state: 'forged.value' })).toEqual({ ok: false, reason: 'invalid_state' });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('reports access_denied when the user declines', async () => {
      global.fetch = jest.fn();
      const { service } = makeService();
      const state = createMetaState(USER, 'jwt-secret');
      expect(await service.handleCallback({ state, error: 'access_denied', error_reason: 'user_denied' })).toEqual({
        ok: false,
        reason: 'access_denied',
      });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('reports missing_code', async () => {
      const { service } = makeService();
      const state = createMetaState(USER, 'jwt-secret');
      expect(await service.handleCallback({ state })).toEqual({ ok: false, reason: 'missing_code' });
    });

    it('exchanges the code, extends the token, stores Pages and Instagram', async () => {
      const calls: string[] = [];
      global.fetch = jest.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.includes('grant_type=fb_exchange_token')) return jsonResponse({ access_token: 'LONG', expires_in: 5184000 });
        if (url.includes('/oauth/access_token')) return jsonResponse({ access_token: 'SHORT' });
        if (url.includes('/me/accounts')) {
          return jsonResponse({
            data: [
              {
                id: 'p1',
                name: 'Client Page',
                access_token: 'PAGE_TOKEN',
                instagram_business_account: { id: 'ig1', username: 'client', followers_count: 10 },
              },
              { id: 'p2', name: 'No IG', access_token: 'PAGE2' },
            ],
          });
        }
        return jsonResponse({ id: 'meta-user-1' });
      }) as never;

      const { service, model } = makeService();
      const state = createMetaState(USER, 'jwt-secret');
      expect(await service.handleCallback({ code: 'the-code', state })).toEqual({ ok: true, pages: 2 });

      const [filter, update] = model.findOneAndUpdate.mock.calls[0];
      expect(String(filter.userId)).toBe(USER);
      expect(update.metaUserId).toBe('meta-user-1');
      expect(update.userAccessToken).toBe('LONG');
      expect(update.userTokenExpiresAt).toBeInstanceOf(Date);
      expect(update.pages).toHaveLength(2);
      expect(update.pages[0]).toMatchObject({
        pageId: 'p1',
        accessToken: 'PAGE_TOKEN',
        instagram: { id: 'ig1', username: 'client', followersCount: 10 },
      });
      expect(update.pages[1].instagram).toBeUndefined();
      expect(calls[0]).toContain('code=the-code');
      expect(calls[0]).toContain('https://graph.facebook.com/v26.0/oauth/access_token');
    });

    it('falls back to the short token when the long-lived swap fails', async () => {
      global.fetch = jest.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('grant_type=fb_exchange_token')) return jsonResponse({ error: { message: 'nope' } }, 400);
        if (url.includes('/oauth/access_token')) return jsonResponse({ access_token: 'SHORT', expires_in: 3600 });
        if (url.includes('/me/accounts')) return jsonResponse({ data: [] });
        return jsonResponse({ id: 'u' });
      }) as never;
      const { service, model } = makeService();
      const state = createMetaState(USER, 'jwt-secret');
      expect(await service.handleCallback({ code: 'c', state })).toEqual({ ok: true, pages: 0 });
      expect(model.findOneAndUpdate.mock.calls[0][1].userAccessToken).toBe('SHORT');
    });

    it('returns exchange_failed and stores nothing when Meta rejects the code', async () => {
      global.fetch = jest.fn(async () => jsonResponse({ error: { message: 'Invalid verification code' } }, 400)) as never;
      const { service, model } = makeService();
      const state = createMetaState(USER, 'jwt-secret');
      expect(await service.handleCallback({ code: 'bad', state })).toEqual({ ok: false, reason: 'exchange_failed' });
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('listAccounts', () => {
    it('returns not connected when there is no document', async () => {
      const { service, model } = makeService();
      model.findOne.mockReturnValue({ lean: async () => null });
      expect(await service.listAccounts(USER)).toEqual({ connected: false, pages: [] });
    });

    it('never returns tokens', async () => {
      const { service, model } = makeService();
      model.findOne.mockReturnValue({
        lean: async () => ({
          userAccessToken: 'SECRET_USER',
          connectedAt: new Date(),
          pages: [{ pageId: 'p1', name: 'P', accessToken: 'SECRET_PAGE', instagram: { id: 'ig1' } }],
        }),
      });
      const result = await service.listAccounts(USER);
      expect(JSON.stringify(result)).not.toContain('SECRET');
      expect(result.pages[0]).toEqual({ pageId: 'p1', name: 'P', instagram: { id: 'ig1' } });
    });
  });

  describe('disconnect', () => {
    it('deletes the data and asks Meta to revoke', async () => {
      global.fetch = jest.fn(async () => jsonResponse({ success: true })) as never;
      const { service, model } = makeService();
      model.findOneAndDelete.mockReturnValue({ lean: async () => ({ userAccessToken: 'TOK' }) });
      expect(await service.disconnect(USER)).toEqual({ disconnected: true });
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(String(url)).toContain('/me/permissions');
      expect(init.method).toBe('DELETE');
    });

    it('still succeeds when the revoke call fails', async () => {
      global.fetch = jest.fn(async () => {
        throw new Error('network');
      }) as never;
      const { service, model } = makeService();
      model.findOneAndDelete.mockReturnValue({ lean: async () => ({ userAccessToken: 'TOK' }) });
      expect(await service.disconnect(USER)).toEqual({ disconnected: true });
    });

    it('reports nothing to disconnect', async () => {
      const { service, model } = makeService();
      model.findOneAndDelete.mockReturnValue({ lean: async () => null });
      expect(await service.disconnect(USER)).toEqual({ disconnected: false });
    });
  });
});
