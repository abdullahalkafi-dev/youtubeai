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
    // find(...).sort(...).lean() for listAccounts, find(...).lean() for disconnect-all
    find: jest.fn(),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
    createIndexes: jest.fn().mockResolvedValue(undefined),
    collection: { indexes: jest.fn().mockResolvedValue([]), dropIndex: jest.fn().mockResolvedValue(undefined) },
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
      expect(filter.metaUserId).toBe('meta-user-1'); // one document per Meta account
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

    it('a second Meta account is stored next to the first and never replaces it', async () => {
      const login = (metaId: string, pageId: string) =>
        jest.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes('grant_type=fb_exchange_token')) return jsonResponse({ access_token: `LONG_${metaId}`, expires_in: 5184000 });
          if (url.includes('/oauth/access_token')) return jsonResponse({ access_token: 'SHORT' });
          if (url.includes('/me/accounts')) return jsonResponse({ data: [{ id: pageId, name: `Page ${pageId}`, access_token: `PT_${pageId}` }] });
          return jsonResponse({ id: metaId });
        }) as never;

      const { service, model } = makeService();
      const state = createMetaState(USER, 'jwt-secret');
      global.fetch = login('acct-A', 'pA');
      await service.handleCallback({ code: 'a', state });
      global.fetch = login('acct-B', 'pB');
      await service.handleCallback({ code: 'b', state });

      const [first, second] = model.findOneAndUpdate.mock.calls;
      expect(first[0].metaUserId).toBe('acct-A');
      expect(second[0].metaUserId).toBe('acct-B');
      expect(first[1].pages[0].pageId).toBe('pA');
      expect(second[1].pages[0].pageId).toBe('pB');
      // upsert, filtered by the Meta account: nothing here can touch the other account's document
      expect(second[2]).toMatchObject({ upsert: true });
    });

    it('reconnecting the same Meta account renews that one document (same filter)', async () => {
      global.fetch = jest.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('grant_type=fb_exchange_token')) return jsonResponse({ access_token: 'LONG' });
        if (url.includes('/oauth/access_token')) return jsonResponse({ access_token: 'SHORT' });
        if (url.includes('/me/accounts')) return jsonResponse({ data: [] });
        return jsonResponse({ id: 'acct-A' });
      }) as never;
      const { service, model } = makeService();
      const state = createMetaState(USER, 'jwt-secret');
      await service.handleCallback({ code: 'a1', state });
      await service.handleCallback({ code: 'a2', state });
      expect(model.findOneAndUpdate.mock.calls[0][0].metaUserId).toBe(model.findOneAndUpdate.mock.calls[1][0].metaUserId);
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

  const found = (model: ReturnType<typeof makeService>['model'], docs: unknown[]) =>
    model.find.mockReturnValue({ sort: () => ({ lean: async () => docs }), lean: async () => docs });

  describe('listAccounts', () => {
    it('returns not connected when there are no documents', async () => {
      const { service, model } = makeService();
      found(model, []);
      expect(await service.listAccounts(USER)).toEqual({ connected: false, pages: [], logins: [] });
    });

    it('never returns tokens', async () => {
      const { service, model } = makeService();
      found(model, [
        {
          metaUserId: 'acct-A',
          userAccessToken: 'SECRET_USER',
          connectedAt: new Date(),
          pages: [{ pageId: 'p1', name: 'P', accessToken: 'SECRET_PAGE', instagram: { id: 'ig1' } }],
        },
      ]);
      const result = await service.listAccounts(USER);
      expect(JSON.stringify(result)).not.toContain('SECRET');
      expect(result.pages[0]).toEqual({ pageId: 'p1', name: 'P', instagram: { id: 'ig1' }, loginId: 'acct-A' });
    });

    it('keeps the old top-level shape for one login and adds logins', async () => {
      const { service, model } = makeService();
      const connectedAt = new Date('2026-11-11T13:12:22Z');
      const tokenExpiresAt = new Date('2027-01-10T13:12:20Z');
      found(model, [{ metaUserId: 'acct-A', userAccessToken: 'T', connectedAt, userTokenExpiresAt: tokenExpiresAt, pages: [{ pageId: 'p1', name: 'P', accessToken: 'X' }] }]);
      const r = await service.listAccounts(USER);
      expect(r).toMatchObject({ connected: true, connectedAt, tokenExpiresAt });
      expect(r.pages).toEqual([{ pageId: 'p1', name: 'P', instagram: undefined, loginId: 'acct-A' }]);
      expect(r.logins).toEqual([{ loginId: 'acct-A', connectedAt, tokenExpiresAt, pages: [{ pageId: 'p1', name: 'P', instagram: undefined }] }]);
    });

    it('merges two logins: all Pages flattened with their loginId, newest connectedAt, soonest expiry', async () => {
      const { service, model } = makeService();
      found(model, [
        { metaUserId: 'acct-A', userAccessToken: 'TA', connectedAt: new Date('2026-11-11'), userTokenExpiresAt: new Date('2027-01-10'), pages: [{ pageId: 'p1', name: 'Reels Page', accessToken: 'PA' }] },
        { metaUserId: 'acct-B', userAccessToken: 'TB', connectedAt: new Date('2026-11-24'), userTokenExpiresAt: new Date('2027-01-23'), pages: [{ pageId: 'p2', name: 'Instagram Page', accessToken: 'PB', instagram: { id: 'ig9', username: 'uniquemeccaaudio', followersCount: 24200 } }] },
      ]);
      const r = await service.listAccounts(USER);
      expect(r.logins).toHaveLength(2);
      expect(r.pages.map((p: { pageId: string; loginId: string }) => `${p.pageId}@${p.loginId}`)).toEqual(['p1@acct-A', 'p2@acct-B']);
      expect(r.connectedAt).toEqual(new Date('2026-11-24'));
      expect(r.tokenExpiresAt).toEqual(new Date('2027-01-10'));
      expect(r.pages[1].instagram).toMatchObject({ username: 'uniquemeccaaudio' });
      expect(JSON.stringify(r)).not.toMatch(/"(TA|TB|PA|PB)"/);
    });
  });

  describe('disconnect', () => {
    it('with no loginId removes every login of the user and revokes each', async () => {
      global.fetch = jest.fn(async () => jsonResponse({ success: true })) as never;
      const { service, model } = makeService();
      found(model, [{ userAccessToken: 'TOK_A' }, { userAccessToken: 'TOK_B' }]);
      expect(await service.disconnect(USER)).toEqual({ disconnected: true });
      expect(String(model.deleteMany.mock.calls[0][0].userId)).toBe(USER);
      expect(model.deleteMany.mock.calls[0][0].metaUserId).toBeUndefined();
      const calls = (global.fetch as jest.Mock).mock.calls;
      expect(calls).toHaveLength(2);
      expect(String(calls[0][0])).toContain('/me/permissions');
      expect(calls[0][1].method).toBe('DELETE');
    });

    it('with a loginId removes only that Meta account', async () => {
      global.fetch = jest.fn(async () => jsonResponse({ success: true })) as never;
      const { service, model } = makeService();
      model.findOneAndDelete.mockReturnValue({ lean: async () => ({ userAccessToken: 'TOK_B' }) });
      expect(await service.disconnect(USER, 'acct-B')).toEqual({ disconnected: true });
      const filter = model.findOneAndDelete.mock.calls[0][0];
      expect(String(filter.userId)).toBe(USER);
      expect(filter.metaUserId).toBe('acct-B');
      expect(model.deleteMany).not.toHaveBeenCalled();
      expect((global.fetch as jest.Mock).mock.calls).toHaveLength(1);
    });

    it('still succeeds when a revoke call fails', async () => {
      global.fetch = jest.fn(async () => {
        throw new Error('network');
      }) as never;
      const { service, model } = makeService();
      found(model, [{ userAccessToken: 'TOK' }]);
      expect(await service.disconnect(USER)).toEqual({ disconnected: true });
      expect(model.deleteMany).toHaveBeenCalled();
    });

    it('reports nothing to disconnect', async () => {
      const { service, model } = makeService();
      found(model, []);
      expect(await service.disconnect(USER)).toEqual({ disconnected: false });
      expect(model.deleteMany).not.toHaveBeenCalled();
      model.findOneAndDelete.mockReturnValue({ lean: async () => null });
      expect(await service.disconnect(USER, 'acct-Z')).toEqual({ disconnected: false });
    });
  });

  describe('ensureIndexes (one login per user -> one per Meta account)', () => {
    const idx = (name: string, key: Record<string, number>, unique = false) => ({ name, key, unique });

    it('drops the old unique userId index, then creates the schema indexes', async () => {
      const { service, model } = makeService();
      model.collection.indexes.mockResolvedValue([idx('_id_', { _id: 1 }), idx('userId_1', { userId: 1 }, true)]);
      await service.ensureIndexes();
      expect(model.collection.dropIndex).toHaveBeenCalledTimes(1);
      expect(model.collection.dropIndex).toHaveBeenCalledWith('userId_1');
      expect(model.createIndexes).toHaveBeenCalledTimes(1);
    });

    it('does nothing destructive when the old index is already gone', async () => {
      const { service, model } = makeService();
      model.collection.indexes.mockResolvedValue([idx('_id_', { _id: 1 }), idx('userId_1_metaUserId_1', { userId: 1, metaUserId: 1 }, true)]);
      await service.ensureIndexes();
      await service.ensureIndexes(); // idempotent
      expect(model.collection.dropIndex).not.toHaveBeenCalled();
      expect(model.createIndexes).toHaveBeenCalledTimes(2);
    });

    it('never drops a non-unique userId index or a differently named one', async () => {
      const { service, model } = makeService();
      model.collection.indexes.mockResolvedValue([idx('userId_1', { userId: 1 }, false), idx('other_unique', { userId: 1 }, true)]);
      await service.ensureIndexes();
      expect(model.collection.dropIndex).not.toHaveBeenCalled();
    });

    it('never throws when the index cannot be listed or dropped, and still tries to create the new one', async () => {
      const { service, model } = makeService();
      model.collection.indexes.mockRejectedValueOnce(new Error('not authorized'));
      await expect(service.ensureIndexes()).resolves.toBeUndefined();

      model.collection.indexes.mockResolvedValue([idx('userId_1', { userId: 1 }, true)]);
      model.collection.dropIndex.mockRejectedValue(new Error('index busy'));
      model.createIndexes.mockRejectedValue(new Error('build failed'));
      await expect(service.ensureIndexes()).resolves.toBeUndefined();
      expect(model.createIndexes).toHaveBeenCalledTimes(2);
    });

    it('runs at module start and cannot stop the app from booting', async () => {
      const { service, model } = makeService();
      model.collection.indexes.mockRejectedValue(new Error('down'));
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });
});
