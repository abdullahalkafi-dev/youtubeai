/**
 * Facebook posts must never leak into what the YouTube side learns from or is guarded by (client decision 2026-11-23).
 * Every test below plants HOSTILE Facebook rows (even ones that claim source:'auto') next to normal YouTube rows and checks that the
 * YouTube numbers, guards and learning come out exactly as if Facebook did not exist.
 */
import * as fs from 'fs';
import * as os from 'os';
import { Types } from 'mongoose';
import { AnalyticsService } from './analytics.service';
import { AutoPublishService } from './auto-publish.service';
import { LearningService } from './learning.service';
import { PublishService } from './publish.service';
import { PillarService } from '../pipeline/pillars.service';
import { opsIssues, OpsReportBody } from '../pipeline/ops-report';

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
        case '$lte': return v != null && num(v) <= num(arg);
        case '$exists': return (v !== undefined) === arg;
        default: throw new Error(`unsupported operator ${op}`);
      }
    });
  });
}
const chain = (rows: any[]) => {
  const q: any = { select: () => q, sort: () => q, limit: () => q, lean: async () => rows };
  return q;
};
const find = (rows: any[]) => (q: any) => chain(rows.filter((r) => match(r, q)));

const CH = oid();
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

function post(over: any) {
  return { _id: oid(), channelId: CH, reelId: oid(), status: 'published', source: 'auto', platform: 'youtube', createdAt: ago(5), updatedAt: ago(5), publishedAt: ago(5), warnings: [], latestMetrics: { views: 1000 }, ...over };
}

describe('YouTube auto-publish ignores Facebook posts', () => {
  const build = (rows: any[], snaps: any[] = []) => {
    const svc: any = Object.create(AutoPublishService.prototype);
    svc.logger = { log: jest.fn(), warn: jest.fn() };
    svc.posts = { find: find(rows) };
    svc.metrics = { find: (q: any) => chain(snaps.filter((s) => match(s, q))) };
    svc.settingsModel = { findOne: () => ({ lean: async () => ({ value: { enabled: true } }) }), updateOne: jest.fn() };
    svc.pause = jest.fn();
    return svc;
  };

  it('the "normal views" baseline is YouTube-only (9 huge Facebook posts that claim source:auto change nothing)', async () => {
    const yt = Array.from({ length: 8 }, (_, i) => post({ publishedAt: ago(5 + i) }));
    const fb = Array.from({ length: 9 }, (_, i) => post({ platform: 'facebook', publishedAt: ago(5 + i) }));
    const snaps = [...yt.map((p) => ({ postId: p._id, checkpoint: '24h', views: 1000 })), ...fb.map((p) => ({ postId: p._id, checkpoint: '24h', views: 1_000_000 }))];
    expect(await build([...yt, ...fb], snaps).shortsBaseline(String(CH))).toBe(1000);
  });

  it('a Facebook rejection or removal never stops YouTube auto-publish', async () => {
    const svc = build([
      post({ platform: 'facebook', status: 'failed', errorCode: 'rejected' }),
      post({ platform: 'facebook', status: 'removed' }),
      post({ platform: 'facebook', warnings: ['Copyright claim: this video was blocked'] }),
    ]);
    expect(await svc.guard(String(CH))).toBeNull();
    expect(svc.pause).not.toHaveBeenCalled();
  });

  it('the same problem on a YouTube post still stops it (the guard is not weakened)', async () => {
    const svc = build([post({ status: 'failed', errorCode: 'rejected' })]);
    expect(await svc.guard(String(CH))).toMatch(/YouTube flagged/);
    expect(svc.pause).toHaveBeenCalled();
  });

  it('the slot test (which posting time works) only reads YouTube posts', async () => {
    const yt = post({ autoPlan: { slot: '21:00', planDate: '2026-11-20' }, publishedAt: ago(4) });
    const fb = post({ platform: 'facebook', autoPlan: { slot: '15:00', planDate: '2026-11-20' }, publishedAt: ago(4) });
    const snaps = [yt, fb].map((p) => ({ postId: p._id, checkpoint: '24h', views: 500 }));
    const out = await build([yt, fb], snaps).slotPosts(String(CH));
    expect(out.map((p: any) => p.slot)).toEqual(['21:00']);
  });
});

describe('the weekly review learns from YouTube only', () => {
  it('counts and tables are asked for YouTube, and only channels that publish on YouTube get a review', async () => {
    const svc: any = Object.create(LearningService.prototype);
    svc.logger = { warn: jest.fn() };
    const distinct = jest.fn(async () => []);
    const countDocuments = jest.fn(async () => 0);
    const breakdown = jest.fn(async () => ({ rows: [] }));
    svc.posts = { distinct, countDocuments };
    svc.analytics = { breakdown };
    svc.reviews = { exists: async () => null, create: jest.fn(), findOne: () => ({ sort: () => ({ lean: async () => null }) }) };
    await svc.runWeekly();
    expect(distinct).toHaveBeenCalledWith('channelId', { platform: 'youtube', status: 'published' });
    await svc.review(String(CH));
    expect(breakdown).toHaveBeenCalled();
    for (const call of breakdown.mock.calls as any[][]) expect(call[3]).toBe('youtube');
    expect((countDocuments.mock.calls as any[][])[0][0]).toMatchObject({ platform: 'youtube', status: 'published' });
  });
});

describe('pillar lift learns from YouTube views only', () => {
  it('asks for published YouTube posts', async () => {
    const svc: any = Object.create(PillarService.prototype);
    const postsFind = jest.fn(() => chain([]));
    svc.list = async () => [{ key: 'p1' }];
    svc.reels = { aggregate: async () => [], find: () => chain([]) };
    svc.videoPillars = { find: () => chain([]) };
    svc.videos = { find: () => chain([]) };
    svc.posts = { find: postsFind };
    await svc.state(CH);
    expect((postsFind.mock.calls as any[][])[0][0]).toMatchObject({ platform: 'youtube', status: 'published' });
  });
});

describe('analytics: optional platform filter, and the campaign verdict compares YouTube with YouTube', () => {
  const build = () => {
    const svc: any = Object.create(AnalyticsService.prototype);
    const aggregate = jest.fn(async () => []);
    const postsFind = jest.fn(() => chain([]));
    svc.posts = { aggregate, find: postsFind };
    svc.metrics = { aggregate: async () => [] };
    svc.reels = { db: { collection: () => ({ find: () => ({ toArray: async () => [] }) }) } };
    return { svc, aggregate, postsFind };
  };

  it('overview: every number is narrowed when a platform is asked for, and mixed (as before) when not', async () => {
    const only = build();
    await only.svc.overview(String(CH), '30d', 'facebook');
    for (const call of only.aggregate.mock.calls as any[][]) expect(call[0][0].$match.platform).toBe('facebook');
    expect((only.postsFind.mock.calls as any[][])[0][0].platform).toBe('facebook');

    const all = build();
    await all.svc.overview(String(CH), '30d');
    for (const call of all.aggregate.mock.calls as any[][]) expect(call[0][0].$match).not.toHaveProperty('platform');
  });

  it('breakdown: filtered by platform when asked', async () => {
    const b = build();
    await b.svc.breakdown(String(CH), 'shape', '30d', 'youtube');
    expect((b.aggregate.mock.calls as any[][])[0][0][0].$match.platform).toBe('youtube');
  });

  it('the "beat the channel" comparison only looks at other YouTube posts', async () => {
    const b = build();
    await b.svc.compareWithChannel(CH, [oid()], [oid()], 100);
    expect((b.postsFind.mock.calls as any[][])[0][0]).toMatchObject({ platform: 'youtube', status: 'published' });
  });
});

describe('a Facebook post never changes the reel (so the reel stays available to YouTube)', () => {
  const build = (status: string) => {
    const svc: any = Object.create(PublishService.prototype);
    svc.logger = { log: jest.fn(), warn: jest.fn() };
    svc.youtubePublishedHooks = [];
    const updateReel = jest.fn();
    const reelId = oid();
    const doc = { _id: oid(), reelId, channelId: CH, platform: status, externalId: 'x1', url: 'https://u', createdAt: new Date(), warnings: [], requestedPrivacy: 'public', metadata: { privacy: 'public', scheduleAt: null } };
    svc.posts = { findOne: async () => doc, updateOne: jest.fn() };
    svc.reels = { updateOne: updateReel };
    svc.queues = { publish: jest.fn() };
    svc.registry = { get: () => ({ verify: async () => ({ state: 'published', warnings: [] }) }) };
    return { svc, updateReel, doc };
  };

  it('a published Facebook post leaves the reel alone and does not fire the YouTube listeners', async () => {
    const { svc, updateReel, doc } = build('facebook');
    const hook = jest.fn(async () => undefined);
    svc.onYoutubePublished(hook);
    await svc.runVerify(String(doc._id), 0);
    expect(updateReel).not.toHaveBeenCalled();
    await new Promise((r) => setImmediate(r));
    expect(hook).not.toHaveBeenCalled();
  });

  it('a published YouTube post still marks the reel posted (unchanged) and fires the listeners with its facts', async () => {
    const { svc, updateReel, doc } = build('youtube');
    const hook = jest.fn(async () => undefined);
    svc.onYoutubePublished(hook);
    await svc.runVerify(String(doc._id), 0);
    expect(updateReel).toHaveBeenCalledTimes(1);
    expect((updateReel.mock.calls[0] as any[])[1].$set.status).toBe('posted');
    await new Promise((r) => setImmediate(r));
    expect(hook).toHaveBeenCalledWith(expect.objectContaining({ id: String(doc._id), reelId: String(doc.reelId), channelId: String(CH) }));
  });

  it('a listener that throws cannot fail or delay the YouTube post', async () => {
    const { svc, doc } = build('youtube');
    svc.onYoutubePublished(async () => {
      throw new Error('facebook is down');
    });
    await expect(svc.runVerify(String(doc._id), 0)).resolves.toBeUndefined();
    await new Promise((r) => setImmediate(r));
    expect(svc.logger.warn).toHaveBeenCalledWith(expect.stringContaining('after-publish listener failed'));
  });

  it('a scheduled YouTube post does not fire the listeners until it is live', async () => {
    const { svc, doc } = build('youtube');
    (doc.metadata as any).scheduleAt = new Date(Date.now() + 3_600_000).toISOString();
    const hook = jest.fn(async () => undefined);
    svc.onYoutubePublished(hook);
    await svc.runVerify(String(doc._id), 0);
    await new Promise((r) => setImmediate(r));
    expect(hook).not.toHaveBeenCalled();
  });

  describe('YouTube\'s daily upload cap', () => {
    const upload = (platform: string) => {
      const svc: any = Object.create(PublishService.prototype);
      svc.logger = { log: jest.fn(), warn: jest.fn() };
      svc.cfg = { REEL_WORK_DIR: os.tmpdir() };
      const doc = { _id: oid(), platform, channelId: CH, reelId: oid(), assetKey: 'k', metadata: {}, warnings: [], attempts: 1, uploadSessionUri: undefined };
      const publish = jest.fn(async () => ({ externalId: 'ext1', url: 'https://u', warnings: [] }));
      const updateOne = jest.fn();
      svc.posts = { findOneAndUpdate: () => ({ select: async () => doc }), updateOne, exists: async () => null };
      svc.quota = { hasRoom: jest.fn(async () => false), dailyCap: 10 };
      svc.storage = { getFile: async (_b: string, _k: string, dest: string) => fs.writeFileSync(dest, 'video') };
      svc.queues = { publish: jest.fn() };
      svc.registry = { get: () => ({ publish }) };
      svc.applyThumbnail = jest.fn();
      svc.applyComment = jest.fn();
      return { svc, doc, publish, updateOne };
    };

    it('does not hold back a Facebook upload', async () => {
      const { svc, doc, publish } = upload('facebook');
      await svc.runUpload(String(doc._id));
      expect(svc.quota.hasRoom).not.toHaveBeenCalled();
      expect(publish).toHaveBeenCalledTimes(1);
      expect(svc.applyThumbnail).not.toHaveBeenCalled(); // YouTube-only steps stay YouTube-only
      expect(svc.applyComment).not.toHaveBeenCalled();
    });

    it('still blocks a YouTube upload when its own cap is reached (unchanged)', async () => {
      const { svc, doc, publish, updateOne } = upload('youtube');
      await svc.runUpload(String(doc._id));
      expect(publish).not.toHaveBeenCalled();
      expect(updateOne.mock.calls.some((c: any[]) => c[1]?.$set?.errorCode === 'daily_cap')).toBe(true);
    });
  });
});

describe('the developer ops report keeps Facebook apart from YouTube', () => {
  const base = (): OpsReportBody => ({
    target: 3,
    made: 3,
    run: { status: 'done', reason: null, topic: 't', fallbacks: [], backup: 'none' },
    topics: [],
    campaigns: [],
    stuckSources: [],
    failedSources: [],
    downloads: { count: 0, heights: {}, lowRes: 0 },
    session: { status: 'ok', cookiesUpdatedAt: new Date(), lastCheckAt: null, lastError: null },
    renders: { failed: 0, fullscreenFallbacks: [] },
    stock: { todo: 20, queuedPosts: 0, daysLeft: 10 },
    posting: { published: 2, failed: [] },
    wasted: { promptTokens: 0, sttMinutes: 0 },
  });

  it('a healthy Facebook section adds no issue', () => {
    expect(opsIssues({ ...base(), facebook: { enabled: true, paused: false, pausedReason: null, posted: 5, published: 5, failed: [] } })).toEqual([]);
  });

  it('a paused lane and failed Facebook posts are reported, and say YouTube is not affected', () => {
    const issues = opsIssues({ ...base(), facebook: { enabled: true, paused: true, pausedReason: 'Facebook refused the login', posted: 2, published: 1, failed: [{ postId: 'p', source: 'fb-backlog', errorCode: 'rejected', error: 'x' }] } });
    expect(issues.join('\n')).toMatch(/Facebook lane is PAUSED: Facebook refused the login/);
    expect(issues.join('\n')).toMatch(/YouTube is not affected/);
    expect(issues.join('\n')).toMatch(/1 Facebook post\(s\) failed: fb-backlog rejected/);
  });
});
