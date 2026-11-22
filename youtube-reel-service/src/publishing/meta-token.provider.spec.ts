import { Types } from 'mongoose';
import { MetaTokenProvider, pickPage } from './meta-token.provider';
import { SharedMetaConnectionSchema } from '../db/schemas/shared.readonly';

const SECRET_PAGE_TOKEN = 'PAGE_TOKEN_SECRET_123';

function harness(conn: any) {
  const ownerId = new Types.ObjectId();
  const seen: any = { connQuery: null, writes: 0 };
  const channels: any = { findById: () => ({ select: () => ({ lean: async () => ({ userId: ownerId }) }) }) };
  const connections: any = {
    findOne: (q: any) => {
      seen.connQuery = q;
      return { select: () => ({ lean: async () => conn }) };
    },
    updateOne: () => void seen.writes++,
    findOneAndUpdate: () => void seen.writes++,
    create: () => void seen.writes++,
  };
  return { provider: new MetaTokenProvider(channels, connections), seen, ownerId };
}

const page = (over: any = {}) => ({ pageId: '219', name: 'Mecca Audio Entertainment', accessToken: SECRET_PAGE_TOKEN, ...over });

describe('pickPage', () => {
  it('uses the first Page that has an id and a token', () => {
    expect(pickPage([{ pageId: '', name: 'x', accessToken: 't' }, page(), page({ pageId: '2' })] as any)?.pageId).toBe('219');
  });
  it('is null when there is nothing usable', () => {
    expect(pickPage([])).toBeNull();
    expect(pickPage(undefined)).toBeNull();
    expect(pickPage([{ pageId: '1', name: 'x', accessToken: '' }] as any)).toBeNull();
  });
});

describe('MetaTokenProvider', () => {
  it('resolves the connection from the channel OWNER and writes nothing', async () => {
    const h = harness({ pages: [page()] });
    await h.provider.page('c1');
    expect(h.seen.connQuery.userId.toString()).toBe(h.ownerId.toString());
    expect(h.seen.writes).toBe(0);
  });

  it('returns the Page id and its token for publishing', async () => {
    const h = harness({ pages: [page()] });
    expect(await h.provider.page('c1')).toEqual({ pageId: '219', name: 'Mecca Audio Entertainment', accessToken: SECRET_PAGE_TOKEN });
  });

  it('identity never carries a token', async () => {
    const h = harness({ pages: [page({ instagram: { id: 'ig1' } }), page({ pageId: '2' })], userTokenExpiresAt: new Date(Date.now() + 86_400_000) });
    const id = await h.provider.identity('c1');
    expect(id).toMatchObject({ pageId: '219', name: 'Mecca Audio Entertainment', instagramId: 'ig1', extraPages: 1 });
    expect(JSON.stringify(id)).not.toContain(SECRET_PAGE_TOKEN);
    expect(Object.keys(id!)).not.toContain('accessToken');
  });

  it('identity is null and page() is an auth error when Facebook is not connected', async () => {
    const none = harness(null);
    expect(await none.provider.identity('c1')).toBeNull();
    await expect(none.provider.page('c1')).rejects.toMatchObject({ kind: 'auth', code: 'no_meta_connection' });
    const empty = harness({ pages: [] });
    await expect(empty.provider.page('c1')).rejects.toMatchObject({ kind: 'auth' });
  });

  it('page() is an auth error once the login has expired', async () => {
    const h = harness({ pages: [page()], userTokenExpiresAt: new Date(Date.now() - 1000) });
    await expect(h.provider.page('c1')).rejects.toMatchObject({ kind: 'auth', code: 'meta_token_expired' });
  });

  it('error messages never contain the token', async () => {
    const h = harness({ pages: [page()], userTokenExpiresAt: new Date(Date.now() - 1000) });
    await expect(h.provider.page('c1')).rejects.toThrow(/^(?!.*PAGE_TOKEN_SECRET).*$/s);
  });
});

describe('SharedMetaConnection schema', () => {
  it('keeps the Pages (and their tokens) out of every query by default', () => {
    expect((SharedMetaConnectionSchema.path('pages') as any).options.select).toBe(false);
  });
  it('maps the backend collection read-only', () => {
    expect((SharedMetaConnectionSchema as any).options.collection).toBe('meta_connections');
    const hooks: any = (SharedMetaConnectionSchema as any).s.hooks;
    expect(hooks.hasHooks('save')).toBe(true);
    expect(hooks.hasHooks('updateOne')).toBe(true);
    expect(hooks.hasHooks('deleteMany')).toBe(true);
  });
});
