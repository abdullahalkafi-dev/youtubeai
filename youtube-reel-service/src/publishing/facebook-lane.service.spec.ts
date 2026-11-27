import { Types } from 'mongoose';
import { nyToUtc } from './auto-plan';
import { FacebookLaneService } from './facebook-lane.service';
import { laneConfig } from './facebook-lane';

/* ---------------------------------------------------------------- a tiny in-memory Mongo, just enough for the lane's queries */

const oid = () => new Types.ObjectId();
const num = (x: any) => (x instanceof Date ? x.getTime() : x);
const same = (a: any, b: any) => (a instanceof Date || b instanceof Date ? new Date(a).getTime() === new Date(b).getTime() : String(a) === String(b));
const getPath = (doc: any, path: string) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), doc);
const isOp = (c: any) => c && typeof c === 'object' && !(c instanceof Types.ObjectId) && !(c instanceof Date) && !Array.isArray(c);

function match(doc: any, q: Record<string, any>): boolean {
  return Object.entries(q).every(([k, cond]) => {
    const v = getPath(doc, k);
    if (!isOp(cond)) return same(cond, v);
    return Object.entries(cond).every(([op, arg]: [string, any]) => {
      switch (op) {
        case '$in': return arg.some((a: any) => same(a, v));
        case '$nin': return !arg.some((a: any) => same(a, v));
        case '$ne': return !same(arg, v);
        case '$gte': return v != null && num(v) >= num(arg);
        case '$lt': return v != null && num(v) < num(arg);
        case '$exists': return (v !== undefined) === arg;
        default: throw new Error(`fake mongo: unsupported operator ${op}`);
      }
    });
  });
}

function setPath(doc: any, path: string, value: any) {
  const keys = path.split('.');
  let o = doc;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys[keys.length - 1]] = value;
}
function delPath(doc: any, path: string) {
  const keys = path.split('.');
  let o = doc;
  for (const k of keys.slice(0, -1)) o = o?.[k];
  if (o) delete o[keys[keys.length - 1]];
}

const query = (rows: any[]) => {
  let r = [...rows];
  const q: any = {
    sort: (s: Record<string, number>) => {
      const [k, d] = Object.entries(s)[0];
      r.sort((a, b) => (num(getPath(a, k)) - num(getPath(b, k))) * d);
      return q;
    },
    limit: (n: number) => ((r = r.slice(0, n)), q),
    select: () => q,
    lean: async () => r,
  };
  return q;
};

/* ---------------------------------------------------------------- the world */

const DATE = '2026-11-24';
const at = (hhmm: string) => nyToUtc(DATE, hhmm);
const CH = oid();
const CHID = String(CH);
const day = (now: Date, n: number) => new Date(now.getTime() - n * 86_400_000);

function world(o: { now?: Date; env?: Record<string, any>; accountState?: 'ok' | 'needs_reconnect' | 'missing'; goLive?: Date | null } = {}) {
  const now = o.now ?? at('13:00');
  const posts: any[] = [];
  const reels: any[] = [];
  const videos: any[] = [];
  const settings: any[] = [];
  const cancelled: string[] = [];
  const created: any[] = [];
  const failFor = new Map<string, Error>();

  const svc: any = Object.create(FacebookLaneService.prototype);
  svc.logger = { log: jest.fn(), warn: jest.fn() };
  svc.cfg = { FACEBOOK_AUTO_SINCE: '' };
  svc.lane = laneConfig(o.env ?? {});
  svc.posts = {
    find: (q: any) => query(posts.filter((p) => match(p, q))),
    findById: (id: any) => ({ select: () => ({ lean: async () => posts.find((p) => same(p._id, id)) ?? null }) }),
    exists: async (q: any) => (posts.some((p) => match(p, q)) ? { _id: 1 } : null),
    aggregate: async (pipeline: any[]) => {
      const rows = posts.filter((p) => match(p, pipeline[0].$match));
      const sum = (k: string) => rows.reduce((n, p) => n + (p.latestMetrics?.[k] ?? 0), 0);
      return rows.length ? [{ _id: null, posts: rows.length, views: sum('views'), likes: sum('likes'), comments: sum('comments') }] : [];
    },
  };
  svc.reels = {
    find: (q: any) => query(reels.filter((r) => match(r, q))),
    findById: async (id: any) => reels.find((r) => same(r._id, id)) ?? null,
    distinct: async () => [CH],
  };
  svc.videos = { find: (q: any) => query(videos.filter((v) => match(v, q))) };
  svc.channels = { findOne: () => ({ select: () => ({ lean: async () => ({ _id: CH, userId: oid() }) }) }) };
  svc.settings = {
    findOne: (q: any) => query(settings.filter((d) => match(d, q))).limit(1) && { lean: async () => settings.find((d) => match(d, q)) ?? null },
    updateOne: async (filter: any, update: any, opts: any = {}) => {
      const { key, ...rest } = filter;
      const doc = settings.find((d) => d.key === key);
      const apply = (d: any, inserting: boolean) => {
        for (const [p, v] of Object.entries(update.$set ?? {})) setPath(d, p, v);
        for (const p of Object.keys(update.$unset ?? {})) delPath(d, p);
        if (inserting) for (const [p, v] of Object.entries(update.$setOnInsert ?? {})) setPath(d, p, v);
      };
      if (doc && match(doc, rest)) {
        apply(doc, false);
        return { modifiedCount: 1, upsertedCount: 0 };
      }
      if (doc) {
        if (opts.upsert) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
        return { modifiedCount: 0, upsertedCount: 0 };
      }
      if (opts.upsert) {
        const d = { key };
        apply(d, true);
        settings.push(d);
        return { modifiedCount: 0, upsertedCount: 1 };
      }
      return { modifiedCount: 0, upsertedCount: 0 };
    },
  };
  svc.publish = {
    onYoutubePublished: jest.fn(),
    lookAllowedIds: jest.fn(async (ids: string[]) => new Set(ids.filter((id) => reels.find((r) => String(r._id) === id)?.look === 'fullscreen'))),
    defaultMetadata: jest.fn(async (reel: any) => ({ title: reel.packaging?.title ?? 'T', description: 'd', tags: [], hashtags: ['#shorts', '#fresh'], categoryId: '24', privacy: 'unlisted', scheduleAt: null, madeForKids: false, containsSyntheticMedia: false, notifySubscribers: false })),
    createFacebookPost: jest.fn(async (channelId: string, owner: string, reelId: string, p: any) => {
      const err = failFor.get(reelId);
      if (err) throw err;
      const doc = { _id: oid(), reelId: new Types.ObjectId(reelId), channelId: CH, platform: 'facebook', source: p.source, status: 'queued', createdAt: now, updatedAt: now, autoPlan: { runAt: p.runAt, slot: p.slot }, metadata: { title: p.metadata.title, hashtags: p.metadata.hashtags }, warnings: [] };
      posts.push(doc);
      created.push({ ...p, reelId });
      return { id: String(doc._id) };
    }),
    cancel: jest.fn(async (_c: string, id: string) => {
      cancelled.push(id);
      const p = posts.find((x) => String(x._id) === id);
      if (p) p.status = 'cancelled';
    }),
  };
  svc.facebook = {
    getAccountStatus: jest.fn(async () => ({ platform: 'facebook', state: o.accountState ?? 'ok', externalId: 'PAGE1', displayName: 'Mecca Audio Entertainment' })),
    pageFollowers: jest.fn(async () => ({ followers: 202, fetchedAt: now })),
  };

  if (o.goLive !== null) settings.push({ key: `facebook-lane:${CHID}`, value: { goLiveAt: o.goLive ?? day(now, 1), pausedReason: null, pausedAt: null } });

  const youtube = (reelId: Types.ObjectId, ageDays: number, over: any = {}) => {
    const p = { _id: oid(), reelId, channelId: CH, platform: 'youtube', status: 'published', source: 'auto', externalId: `yt-${String(reelId)}`, createdAt: day(now, ageDays), updatedAt: day(now, ageDays), publishedAt: day(now, ageDays), url: `https://www.youtube.com/shorts/${String(reelId).slice(-6)}`, metadata: { title: `Reel ${String(reelId).slice(-4)}`, description: 'x', hashtags: ['#shorts', '#story'], tags: [], categoryId: '24' }, ...over };
    posts.push(p);
    return p;
  };
  const reel = (over: any = {}) => {
    const r = { _id: oid(), channelId: CH, status: 'posted', look: 'fullscreen', createdAt: day(now, 2), packaging: { title: 'A reel' }, scores: { overall: 80 }, critique: { verdict: 'keep' }, ...over };
    reels.push(r);
    return r;
  };
  const fbPost = (reelId: Types.ObjectId, over: any = {}) => {
    const p = { _id: oid(), reelId, channelId: CH, platform: 'facebook', source: 'fb-backlog', status: 'published', createdAt: now, updatedAt: now, warnings: [], ...over };
    posts.push(p);
    return p;
  };
  /** The main app's hourly analytics for the reel's YouTube video (retentionPercent = average view %). */
  const video = (reelId: Types.ObjectId, retentionPercent: number | undefined, over: any = {}) => {
    const v = { _id: oid(), youtubeId: `yt-${String(reelId)}`, retentionPercent, viewCount: 1000, lastAnalyticsSync: now, ...over };
    videos.push(v);
    return v;
  };
  return { svc, now, posts, reels, settings, cancelled, created, failFor, youtube, reel, fbPost, video, videos };
}

const lanePosts = (w: ReturnType<typeof world>, source?: string) => w.posts.filter((p) => p.platform === 'facebook' && String(p.source).startsWith('fb-') && (!source || p.source === source));

describe('only full-screen reels are candidates (SOCIAL_LOOK_ONLY)', () => {
  it('the backlog pool and the extra pool leave out classic and no-look reels', async () => {
    const w = world({ now: at('14:30') });
    const good = w.reel({ status: 'posted', createdAt: day(w.now, 3) });
    const classic = w.reel({ status: 'posted', createdAt: day(w.now, 4), look: 'classic' });
    const none = w.reel({ status: 'posted', createdAt: day(w.now, 5), look: undefined });
    for (const r of [good, classic, none]) w.youtube(r._id, 2);
    expect((await w.svc.backlogPool(CHID, w.now)).map((c: any) => c.reelId)).toEqual([String(good._id)]);

    const w2 = world({ now: at('14:30') });
    const g2 = w2.reel({ status: 'todo', createdAt: day(w2.now, 0.5) });
    w2.reel({ status: 'todo', createdAt: day(w2.now, 0.6), look: 'classic' });
    w2.reel({ status: 'todo', createdAt: day(w2.now, 0.7), look: undefined });
    expect((await w2.svc.extraPool(CHID, w2.now)).map((c: any) => c.reelId)).toEqual([String(g2._id)]);
  });
});

/* ---------------------------------------------------------------- the mirror */

describe('FacebookLaneService.mirror (every YouTube post that goes live is mirrored)', () => {
  const live = (w: ReturnType<typeof world>, over: any = {}) => {
    const r = w.reel();
    const yt = w.youtube(r._id, 0, over);
    return { r, yt, hook: { id: String(yt._id), reelId: String(r._id), channelId: CHID, publishedAt: new Date() } };
  };

  it('never mirrors a reel that is not in the full-screen look (classic, or no look recorded)', async () => {
    for (const look of ['classic', undefined]) {
      const w = world({ now: new Date() });
      const { hook } = live(w, {});
      w.reels[0].look = look;
      expect(await w.svc.mirror(hook)).toBe('skipped');
      expect(w.created).toHaveLength(0);
    }
  });

  it('queues the same reel on Facebook at once, with the YouTube metadata minus #shorts', async () => {
    const w = world({ now: new Date() });
    const { r, hook } = live(w);
    expect(await w.svc.mirror(hook)).toBe('posted');
    expect(w.created).toHaveLength(1);
    expect(w.created[0]).toMatchObject({ source: 'fb-mirror', reelId: String(r._id) });
    expect(w.created[0].metadata.hashtags).toEqual(['#story']);
    expect(Math.abs(w.created[0].runAt.getTime() - Date.now())).toBeLessThan(5_000);
  });

  it('never posts the same reel twice (a second hook, or a reel already on Facebook, is skipped)', async () => {
    const w = world({ now: new Date() });
    const { hook } = live(w);
    expect(await w.svc.mirror(hook)).toBe('posted');
    expect(await w.svc.mirror(hook)).toBe('skipped');
    expect(w.created).toHaveLength(1);

    const manual = world({ now: new Date() });
    const { r: r2, hook: hook2 } = live(manual);
    manual.fbPost(r2._id, { source: 'api' }); // posted by hand earlier, like the first Lewisburg reel
    expect(await manual.svc.mirror(hook2)).toBe('skipped');
  });

  it('only mirrors YouTube posts that went live AFTER go-live', async () => {
    const w = world({ now: new Date(), goLive: new Date(Date.now() + 60_000) });
    const { hook } = live(w);
    expect(await w.svc.mirror(hook)).toBe('skipped');
    expect(w.created).toHaveLength(0);
  });

  it('starts at the first YouTube post when the lane has never run (go-live = first sight)', async () => {
    const w = world({ now: new Date(), goLive: null });
    const { hook } = live(w);
    expect(await w.svc.mirror(hook)).toBe('posted');
    expect(w.settings.find((s) => s.key === `facebook-lane:${CHID}`).value.goLiveAt).toEqual(hook.publishedAt);
  });

  it('does nothing while the lane is paused or switched off (FACEBOOK_AUTO=off)', async () => {
    const paused = world({ now: new Date() });
    paused.settings[0].value.pausedReason = 'Facebook refused the login';
    expect(await paused.svc.mirror(live(paused).hook)).toBe('skipped');
    expect(paused.created).toHaveLength(0);

    const off = world({ now: new Date(), env: { FACEBOOK_AUTO: 'off' } });
    expect(await off.svc.mirror(live(off).hook)).toBe('skipped');
    expect(off.created).toHaveLength(0);
  });

  it('stops at the hard daily cap of 5', async () => {
    const w = world({ now: new Date() });
    for (let i = 0; i < 5; i++) w.fbPost(oid(), { source: i < 3 ? 'fb-mirror' : 'fb-backlog', createdAt: new Date() });
    expect(await w.svc.mirror(live(w).hook)).toBe('skipped');
    expect(w.created).toHaveLength(0);
  });
});

/* ---------------------------------------------------------------- the day's slots */

describe('FacebookLaneService.plan: backlog lane', () => {
  it('at the 12:30 slot takes the NEWEST reel from the last 30 days that is not on Facebook, and ignores older and already-posted ones', async () => {
    const w = world();
    const [a, b, c, old, onfb] = [w.reel(), w.reel(), w.reel(), w.reel(), w.reel()];
    w.youtube(a._id, 3);
    w.youtube(b._id, 1);
    w.youtube(c._id, 12);
    w.youtube(old._id, 31);
    w.youtube(onfb._id, 0.2);
    w.fbPost(onfb._id, { source: 'api' });
    expect(await w.svc.plan(CHID, w.now)).toMatchObject({ status: 'planned', planned: 1 });
    expect(w.created).toHaveLength(1);
    expect(w.created[0]).toMatchObject({ source: 'fb-backlog', reelId: String(b._id) });
    expect(w.created[0].runAt.getTime()).toBeGreaterThanOrEqual(w.now.getTime() + 3 * 60_000);
  });

  describe('order by YouTube retention (FACEBOOK_BACKLOG_ORDER)', () => {
    const order = async (w: ReturnType<typeof world>) => (await w.svc.backlogPool(CHID, w.now)).map((c: any) => c.reelId);

    it('puts the reels YouTube viewers watched most first, no-number reels next, clearly weak reels last', async () => {
      const w = world();
      const [newestUnknown, high, mid, weak, noViews] = [w.reel(), w.reel(), w.reel(), w.reel(), w.reel()];
      w.youtube(newestUnknown._id, 1); // no analytics yet
      w.youtube(high._id, 5);
      w.video(high._id, 130);
      w.youtube(mid._id, 2);
      w.video(mid._id, 95);
      w.youtube(weak._id, 3);
      w.video(weak._id, 49);
      w.youtube(noViews._id, 4);
      w.video(noViews._id, 140, { viewCount: 120 }); // too few views to trust: counts as "no numbers"
      expect(await order(w)).toEqual([high, mid, newestUnknown, noViews, weak].map((r) => String(r._id)));
    });

    it('is the original newest-first order with FACEBOOK_BACKLOG_ORDER=newest, and the pool reports the retention as its score', async () => {
      const w = world({ env: { FACEBOOK_BACKLOG_ORDER: 'newest' } });
      const [a, b] = [w.reel(), w.reel()];
      w.youtube(a._id, 4);
      w.video(a._id, 140);
      w.youtube(b._id, 1);
      w.video(b._id, 70);
      expect(await order(w)).toEqual([b, a].map((r) => String(r._id)));

      const r = world();
      const x = r.reel();
      r.youtube(x._id, 2);
      r.video(x._id, 111);
      expect((await r.svc.backlogPool(CHID, r.now))[0].score).toBe(111);
    });

    it('ignores a video with no analytics sync, and falls back to newest-first when the lookup fails (never blocks a post)', async () => {
      const w = world();
      const [a, b] = [w.reel(), w.reel()];
      w.youtube(a._id, 4);
      w.video(a._id, 140, { lastAnalyticsSync: undefined });
      w.youtube(b._id, 1);
      expect(await order(w)).toEqual([b, a].map((r) => String(r._id)));

      w.video(a._id, 140);
      w.svc.videos = { find: () => { throw new Error('mongo down'); } };
      expect(await order(w)).toEqual([b, a].map((r) => String(r._id)));
      expect(w.svc.logger.warn).toHaveBeenCalled();
    });
  });

  it('a slot is claimed atomically: planning again does not create a second post', async () => {
    const w = world();
    w.youtube(w.reel()._id, 1);
    w.youtube(w.reel()._id, 2);
    await w.svc.plan(CHID, w.now);
    expect(await w.svc.plan(CHID, w.now)).toEqual({ status: 'nothing-due' });
    expect(w.created).toHaveLength(1);
  });

  it('two workers racing for the same slot create one post', async () => {
    const w = world();
    w.youtube(w.reel()._id, 1);
    w.youtube(w.reel()._id, 2);
    await Promise.all([w.svc.plan(CHID, w.now), w.svc.plan(CHID, w.now)]);
    expect(w.created).toHaveLength(1);
  });

  it('gives 2 backlog posts a day, never a third', async () => {
    const w = world({ now: at('21:00') });
    for (let i = 0; i < 6; i++) w.youtube(w.reel()._id, 1 + i);
    await w.svc.plan(CHID, w.now);
    expect(lanePosts(w, 'fb-backlog')).toHaveLength(2);
    expect(lanePosts(w, 'fb-extra')).toHaveLength(1); // no fresh reel, so the extra slot took a backlog reel
    expect(lanePosts(w)).toHaveLength(3);
    expect(await w.svc.plan(CHID, new Date(w.now.getTime() + 600_000))).toEqual({ status: 'nothing-due' });
  });

  it('a used-up backlog is just an empty slot, not an error, and the lane carries on', async () => {
    const w = world();
    const r = w.reel();
    w.youtube(r._id, 1);
    w.fbPost(r._id); // already on Facebook
    expect(await w.svc.plan(CHID, w.now)).toMatchObject({ status: 'planned', planned: 0 });
    expect(w.created).toHaveLength(0);
    const day = w.settings.find((s) => s.key === `facebook-lane-day:${CHID}:${DATE}`);
    expect(Object.values(day.value.slots as Record<string, any>).map((s) => s.state)).toContain('empty');
  });

  it('skips a reel Facebook cannot take and tries the next one', async () => {
    const w = world();
    const bad = w.reel();
    const good = w.reel();
    w.youtube(bad._id, 1);
    w.youtube(good._id, 2);
    w.failFor.set(String(bad._id), new Error('The video is 400×800. Facebook Reels need at least 540×960.'));
    await w.svc.plan(CHID, w.now);
    expect(w.created.map((c) => c.reelId)).toEqual([String(good._id)]);
  });

  it('stops at Facebook\'s own 24-hour limit instead of trying every reel', async () => {
    const w = world();
    for (let i = 0; i < 4; i++) w.youtube(w.reel()._id, i + 1);
    const limit: any = new Error('limit');
    limit.getResponse = () => ({ issues: [{ code: 'daily_cap' }] });
    for (const r of w.reels) w.failFor.set(String(r._id), limit);
    await w.svc.plan(CHID, w.now);
    expect(w.svc.publish.createFacebookPost).toHaveBeenCalledTimes(1);
  });

  it('a pass that fails before posting releases the slot so the next pass retries it', async () => {
    const w = world();
    w.youtube(w.reel()._id, 1);
    w.svc.owner = jest.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue('u1');
    await expect(w.svc.plan(CHID, w.now)).rejects.toThrow('db down');
    expect((await w.svc.plan(CHID, w.now)).status).toBe('planned');
    expect(w.created).toHaveLength(1);
  });
});

describe('FacebookLaneService.plan: extra lane', () => {
  it('at 15:00 posts the newest good fresh reel that is on neither YouTube nor Facebook', async () => {
    const w = world({ now: at('14:30') });
    const weak = w.reel({ status: 'todo', createdAt: day(w.now, 0.1), scores: { overall: 40 } }); // fails the quality gate
    const onYt = w.reel({ status: 'todo', createdAt: day(w.now, 0.2) });
    w.posts.push({ _id: oid(), reelId: onYt._id, channelId: CH, platform: 'youtube', status: 'queued', source: 'auto', createdAt: w.now });
    const good = w.reel({ status: 'todo', createdAt: day(w.now, 0.5), packaging: { title: 'The good one' } });
    const older = w.reel({ status: 'todo', createdAt: day(w.now, 2) });
    expect(weak && older).toBeTruthy();
    await w.svc.plan(CHID, w.now);
    const extra = lanePosts(w, 'fb-extra');
    expect(extra).toHaveLength(1);
    expect(String(extra[0].reelId)).toBe(String(good._id));
    // a reel with no YouTube post takes the reel's own packaging metadata, still without #shorts
    expect(w.created[0].metadata.hashtags).toEqual(['#fresh']);
  });

  it('with no fresh reel it falls back to the next backlog reel so Facebook still reaches its total', async () => {
    const w = world({ now: at('14:30') });
    const newer = w.reel();
    const older = w.reel();
    w.youtube(newer._id, 1);
    w.youtube(older._id, 2);
    await w.svc.plan(CHID, w.now);
    // 12:30 backlog slot takes the newest; the 15:00 extra slot has no fresh reel, so it takes the next backlog reel
    expect(lanePosts(w, 'fb-backlog').map((p) => String(p.reelId))).toEqual([String(newer._id)]);
    expect(lanePosts(w, 'fb-extra').map((p) => String(p.reelId))).toEqual([String(older._id)]);
  });

  it('does not add an extra when YouTube mirrors already fill the 3 new slots', async () => {
    const w = world({ now: at('14:30') });
    for (let i = 0; i < 3; i++) w.fbPost(oid(), { source: 'fb-mirror', createdAt: w.now });
    w.reel({ status: 'todo', createdAt: day(w.now, 0.1) });
    await w.svc.plan(CHID, w.now);
    expect(lanePosts(w, 'fb-extra')).toHaveLength(0);
    expect(w.created).toHaveLength(0);
  });

  it('never changes the reel it posts (it stays to-do for YouTube)', async () => {
    const w = world({ now: at('14:30') });
    const r = w.reel({ status: 'todo', createdAt: day(w.now, 0.1) });
    await w.svc.plan(CHID, w.now);
    expect(r.status).toBe('todo');
  });
});

describe('the lane stops by itself, and only the lane', () => {
  it('a Facebook login error pauses it, cancels what waits, and nothing is planned or mirrored until resume', async () => {
    const w = world();
    const queued = w.fbPost(oid(), { status: 'queued', source: 'fb-mirror' });
    w.fbPost(oid(), { status: 'blocked', errorCode: 'needs_reconnect', source: 'fb-backlog' });
    w.youtube(w.reel()._id, 1);
    expect(await w.svc.tick(CHID, w.now)).toMatchObject({ status: 'paused' });
    expect(w.cancelled).toContain(String(queued._id));
    expect(w.settings.find((s) => s.key === `facebook-lane:${CHID}`).value.pausedReason).toMatch(/reconnect Facebook/);
    expect(w.created).toHaveLength(0);

    const r = w.reel();
    const yt = w.youtube(r._id, 0);
    expect(await w.svc.mirror({ id: String(yt._id), reelId: String(r._id), channelId: CHID, publishedAt: new Date() })).toBe('skipped');

    // the pause cancelled the waiting and blocked posts, so after the developer reconnects and resumes the lane starts clean
    await w.svc.resume(CHID);
    expect(await w.svc.guard(CHID, w.now)).toBeNull();
    expect(w.settings.find((s) => s.key === `facebook-lane:${CHID}`).value.pausedReason).toBeNull();
  });

  it('two rejections in a day pause it; one does not', async () => {
    const one = world();
    one.fbPost(oid(), { status: 'failed', errorCode: 'rejected' });
    expect(await one.svc.guard(CHID, one.now)).toBeNull();

    const two = world();
    two.fbPost(oid(), { status: 'failed', errorCode: 'rejected' });
    two.fbPost(oid(), { status: 'failed', errorCode: 'media' });
    expect(await two.svc.guard(CHID, two.now)).toMatch(/2 reels/);
  });

  it('does not plan while Facebook is not connected, and does not pause for it', async () => {
    const w = world({ accountState: 'needs_reconnect' });
    w.youtube(w.reel()._id, 1);
    expect(await w.svc.tick(CHID, w.now)).toEqual({ status: 'facebook-not-connected' });
    expect(w.created).toHaveLength(0);
  });

  it('FACEBOOK_AUTO=off: the periodic job does nothing at all', async () => {
    const w = world({ env: { FACEBOOK_AUTO: 'off' } });
    w.youtube(w.reel()._id, 1);
    await w.svc.runDue(w.now);
    expect(w.created).toHaveLength(0);
    expect(w.svc.facebook.getAccountStatus).not.toHaveBeenCalled();
  });
});

/* ---------------------------------------------------------------- read-only views */

describe('preview and overview', () => {
  it('preview lists what would be posted with the YouTube link and creates nothing', async () => {
    const w = world({ now: at('11:00') });
    const a = w.reel();
    const b = w.reel();
    w.youtube(a._id, 1);
    w.youtube(b._id, 2);
    const p = await w.svc.preview(CHID, w.now);
    expect(w.svc.publish.createFacebookPost).not.toHaveBeenCalled();
    expect(w.posts.filter((x) => x.platform === 'facebook')).toHaveLength(0);
    expect(p.backlogSize).toBe(2);
    const backlog = p.items.filter((i: any) => i.kind === 'backlog' && i.reelId);
    expect(backlog[0].reelId).toBe(String(a._id)); // newest first
    expect(backlog[0].youtubeUrl).toMatch(/youtube\.com\/shorts\//);
    expect(new Set(p.items.filter((i: any) => i.reelId).map((i: any) => i.reelId)).size).toBe(p.items.filter((i: any) => i.reelId).length); // no reel twice
  });

  it('overview has the agreed shape, counts today and the backlog, and never contains a token', async () => {
    const w = world();
    const r1 = w.reel();
    const r2 = w.reel();
    w.youtube(r1._id, 1);
    w.fbPost(r2._id, { source: 'fb-mirror', url: 'https://www.facebook.com/reel/1', publishedAt: w.now, latestMetrics: { views: 120, likes: 9, comments: 2 }, metadata: { title: 'Posted one' }, accessToken: 'SECRET-TOKEN', uploadSessionUri: 'https://rupload/SECRET' });
    const o = await w.svc.overview(CHID, w.now);
    expect(o).toMatchObject({
      connected: true,
      state: 'ok',
      page: { id: 'PAGE1', name: 'Mecca Audio Entertainment', followers: 202 },
      lanes: { enabled: true, paused: false, pausedReason: null, newPerDay: 3, backlogPerDay: 2, backlogRemaining: 1, dailyCap: 5 },
      totals: { posts: 1, views: 120, likes: 9, comments: 2 },
    });
    expect(typeof o.page.fetchedAt).toBe('string');
    expect(o.recent[0]).toEqual({ postId: expect.any(String), reelId: String(r2._id), title: 'Posted one', url: 'https://www.facebook.com/reel/1', status: 'published', source: 'fb-mirror', publishedAt: w.now.toISOString(), views: 120, likes: 9, comments: 2 });
    expect(JSON.stringify(o)).not.toMatch(/SECRET|accessToken|uploadSessionUri|access_token/);
  });

  it('followers degrade to null when Facebook errors; a missing connection gives page null', async () => {
    const w = world();
    w.svc.facebook.pageFollowers.mockResolvedValue({ followers: null, fetchedAt: w.now });
    expect((await w.svc.overview(CHID, w.now)).page.followers).toBeNull();
    const none = world({ accountState: 'missing' });
    const o = await none.svc.overview(CHID, none.now);
    expect(o).toMatchObject({ connected: false, state: 'missing', page: null });
    expect(none.svc.facebook.pageFollowers).not.toHaveBeenCalled();
  });

  it('shows a paused lane with its reason', async () => {
    const w = world();
    w.settings[0].value.pausedReason = 'Facebook rejected or flagged 2 reels today';
    expect((await w.svc.overview(CHID, w.now)).lanes).toMatchObject({ paused: true, pausedReason: 'Facebook rejected or flagged 2 reels today' });
  });
});
