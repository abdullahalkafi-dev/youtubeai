import { Types } from 'mongoose';
import { MetaTokenProvider, pickPage } from './meta-token.provider';
import { SharedMetaConnectionSchema } from '../db/schemas/shared.readonly';

const SECRET_PAGE_TOKEN = 'PAGE_TOKEN_SECRET_123';

/** `conn` is one login document, a list of logins (oldest first), or null for "nothing connected". */
function harness(conn: any) {
  const ownerId = new Types.ObjectId();
  const seen: any = { connQuery: null, writes: 0 };
  const logins = conn === null || conn === undefined ? [] : Array.isArray(conn) ? conn : [conn];
  const channels: any = { findById: () => ({ select: () => ({ lean: async () => ({ userId: ownerId }) }) }) };
  const connections: any = {
    find: (q: any) => {
      seen.connQuery = q;
      return { select: () => ({ sort: () => ({ lean: async () => logins }) }) };
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
  it('uses the pinned Page even when it is not first', () => {
    const pages = [page({ pageId: '2', name: 'Instagram-only Page' }), page()] as any;
    expect(pickPage(pages, '219')?.name).toBe('Mecca Audio Entertainment');
    expect(pickPage(pages)?.pageId).toBe('2');
  });
  it('never falls back to another Page when the pinned one is missing', () => {
    expect(pickPage([page({ pageId: '2' })] as any, '219')).toBeNull();
  });
  it('is null when there is nothing usable', () => {
    expect(pickPage([])).toBeNull();
    expect(pickPage(undefined)).toBeNull();
    expect(pickPage([{ pageId: '1', name: 'x', accessToken: '' }] as any)).toBeNull();
  });
});

describe('MetaTokenProvider with a pinned Page', () => {
  it('publishes to the pinned Page even though another Page comes first, and refuses when it is not shared', async () => {
    const conn = { pages: [page({ pageId: '2', name: 'Instagram-only Page', accessToken: 'OTHER' }), page()] };
    const h = harness(conn);
    const pinned = new MetaTokenProvider((h.provider as any).channels, (h.provider as any).connections, { FACEBOOK_PAGE_ID: '219' } as any);
    expect(await pinned.page('c1')).toEqual({ pageId: '219', name: 'Mecca Audio Entertainment', accessToken: SECRET_PAGE_TOKEN });
    expect((await pinned.identity('c1'))?.pageId).toBe('219');

    const missing = new MetaTokenProvider((h.provider as any).channels, (h.provider as any).connections, { FACEBOOK_PAGE_ID: '999' } as any);
    await expect(missing.page('c1')).rejects.toMatchObject({ kind: 'auth', code: 'no_meta_connection' });
  });
});

describe('MetaTokenProvider with two Facebook logins side by side', () => {
  const future = new Date(Date.now() + 86_400_000);
  const past = new Date(Date.now() - 1000);
  // login A runs the reels Page, login B runs the Instagram Page (the real setup)
  const loginA = (over: any = {}) => ({ metaUserId: 'A', userTokenExpiresAt: future, pages: [page()], ...over });
  const loginB = (over: any = {}) => ({
    metaUserId: 'B',
    userTokenExpiresAt: future,
    pages: [page({ pageId: '777', name: 'Unique Mecca Audio', accessToken: 'TOKEN_B', instagram: { id: 'ig9', username: 'uniquemeccaaudio' } })],
    ...over,
  });
  const withPin = (h: ReturnType<typeof harness>, pin?: string) =>
    new MetaTokenProvider((h.provider as any).channels, (h.provider as any).connections, pin ? ({ FACEBOOK_PAGE_ID: pin } as any) : undefined);

  it('with no pin the first Page of the first (oldest) login is used, and the others count as extra', async () => {
    const h = harness([loginA(), loginB()]);
    expect(await h.provider.page('c1')).toMatchObject({ pageId: '219', accessToken: SECRET_PAGE_TOKEN });
    expect(await h.provider.identity('c1')).toMatchObject({ pageId: '219', extraPages: 1 });
  });

  it('the pinned Page is found in whichever login holds it and its own token is used', async () => {
    const h = harness([loginA(), loginB()]);
    expect(await withPin(h, '777').page('c1')).toEqual({ pageId: '777', name: 'Unique Mecca Audio', accessToken: 'TOKEN_B' });
    expect(await withPin(h, '219').page('c1')).toMatchObject({ pageId: '219', accessToken: SECRET_PAGE_TOKEN });
    // the pin lives in the SECOND login even though the first one comes first
    const second = harness([loginB(), loginA()]);
    expect((await withPin(second, '219').page('c1')).accessToken).toBe(SECRET_PAGE_TOKEN);
  });

  it('a pinned Page that no login holds still stops publishing (no fallback to another Page)', async () => {
    const h = harness([loginA(), loginB()]);
    await expect(withPin(h, '999').page('c1')).rejects.toMatchObject({ kind: 'auth', code: 'no_meta_connection' });
    expect(await withPin(h, '999').identity('c1')).toBeNull();
  });

  it('an expired login only affects its own Pages', async () => {
    const h = harness([loginA(), loginB({ userTokenExpiresAt: past })]);
    expect((await withPin(h, '219').page('c1')).pageId).toBe('219'); // reels keep going
    await expect(withPin(h, '777').page('c1')).rejects.toMatchObject({ kind: 'auth', code: 'meta_token_expired' });

    const aExpired = harness([loginA({ userTokenExpiresAt: past }), loginB()]);
    await expect(withPin(aExpired, '219').page('c1')).rejects.toMatchObject({ code: 'meta_token_expired' });
    expect((await withPin(aExpired, '777').page('c1')).pageId).toBe('777');
  });

  it('when the same Page sits in two logins the one with a valid login is used', async () => {
    const h = harness([loginA({ userTokenExpiresAt: past }), loginB({ pages: [page({ accessToken: 'FRESH' })] })]);
    expect((await withPin(h, '219').page('c1')).accessToken).toBe('FRESH');
  });

  it('identity reports the Instagram of the chosen Page and never any token', async () => {
    const h = harness([loginA(), loginB()]);
    const id = await withPin(h, '777').identity('c1');
    expect(id).toMatchObject({ pageId: '777', instagramId: 'ig9', extraPages: 1 });
    expect(JSON.stringify(id)).not.toMatch(/TOKEN_B|PAGE_TOKEN_SECRET/);
  });

  it('queries every login of the channel OWNER and writes nothing', async () => {
    const h = harness([loginA(), loginB()]);
    await h.provider.page('c1');
    expect(h.seen.connQuery.userId.toString()).toBe(h.ownerId.toString());
    expect(h.seen.writes).toBe(0);
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
