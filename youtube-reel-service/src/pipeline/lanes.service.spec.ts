import { Types } from 'mongoose';
import { LanesService } from './lanes.service';
import { laneResearch } from './campaign-runner.service';
import { LaneVideo } from './lanes';

const oid = () => new Types.ObjectId();
const lv = (id: string, over: Partial<LaneVideo> = {}): LaneVideo => ({
  youtubeId: id, videoId: `db-${id}`, title: `Video ${id}`, publishedAt: new Date(Date.now() - 3 * 86_400_000), views: 10_000, durationSec: 1200, analyzed: false, strongMoments: 0, usedMoments: 0, ...over,
});

function make(opts: { catalog: LaneVideo[]; stock: number; existing?: boolean; sources?: string[]; empty?: string[] }) {
  const created: any[] = [];
  const svc: any = Object.create(LanesService.prototype);
  svc.logger = { log: jest.fn(), warn: jest.fn() };
  svc.cfg = { REELS_ENABLED: true, REEL_WORK_DIR: '.', REEL_MIN_FREE_DISK_GB: 0 };
  svc.catalog = jest.fn(async () => opts.catalog);
  svc.campaigns = {
    exists: jest.fn(async () => (opts.existing ? { _id: oid() } : null)),
    create: jest.fn(async (doc: any) => {
      created.push(doc);
      return { _id: oid(), ...doc };
    }),
    distinct: jest.fn(async () => [oid()]),
    find: jest.fn(() => ({ select: () => ({ lean: async () => [] }) })),
  };
  svc.reels = { countDocuments: jest.fn(async () => opts.stock) };
  svc.sources = { find: () => ({ select: () => ({ lean: async () => (opts.sources ?? []).map((youtubeId) => ({ youtubeId })), limit: () => ({ lean: async () => (opts.empty ?? []).map((youtubeId) => ({ youtubeId, title: 'T ' + youtubeId })) }) }) }), updateOne: jest.fn() };
  svc.settings = { findOne: () => ({ lean: async () => null }), updateOne: jest.fn() };
  svc.queues = { campaign: jest.fn(), analyze: jest.fn() };
  svc.runner = { kickSource: jest.fn() };
  return { svc, created };
}

describe('footage-first lanes of the day', () => {
  const channel = oid();

  it('makes a "new videos" campaign from the newest long videos, seeded with them', async () => {
    const { svc, created } = make({ catalog: [lv('a'), lv('b', { views: 50_000 }), lv('old', { publishedAt: new Date('2025-01-01') })], stock: 20 });
    const made = await svc.createForDay(channel, '2026-10-26', oid());
    expect(made.map((m: any) => m.track)).toEqual(['fresh']);
    expect(created[0]).toMatchObject({ origin: 'daily', track: 'fresh', dailyDate: '2026-10-26', parentCampaignId: null });
    expect(created[0].settings.lane).toBe('fresh');
    expect(created[0].settings.seedVideoIds).toEqual(['b', 'a']);
    expect(created[0].settings.targetReels).toBe(5);
    expect(svc.queues.campaign).toHaveBeenCalledWith('research', expect.any(String));
  });

  it('adds the best-of-the-old campaign only when the stock of reels is low', async () => {
    const catalog = [lv('a'), lv('old1', { publishedAt: new Date('2025-02-01'), analyzed: true, strongMoments: 8 }), lv('old2', { publishedAt: new Date('2025-03-01'), analyzed: true, strongMoments: 5 })];
    const low = make({ catalog, stock: 4 });
    expect((await low.svc.createForDay(channel, '2026-10-26', oid())).map((m: any) => m.track)).toEqual(['fresh', 'bank']);
    expect(low.created[1].settings.seedVideoIds).toEqual(['old1', 'old2']);
    const full = make({ catalog, stock: 12 });
    expect((await full.svc.createForDay(channel, '2026-10-26', oid())).map((m: any) => m.track)).toEqual(['fresh']);
  });

  it('at 2 reels a day (Nov 6 test) the new-videos lane makes 2 and the older-videos lane stays off', async () => {
    const catalog = [lv('a'), lv('old1', { publishedAt: new Date('2025-02-01'), analyzed: true, strongMoments: 8 })];
    const { svc, created } = make({ catalog, stock: 0 });
    const made = await svc.createForDay(channel, '2026-11-07', oid(), { reels: 2, bank: false });
    expect(made.map((m: any) => m.track)).toEqual(['fresh']);
    expect(created[0].settings.targetReels).toBe(2);
  });

  it('never creates a lane twice for the same day, and skips a lane with no material', async () => {
    const again = make({ catalog: [lv('a')], stock: 0, existing: true });
    expect(await again.svc.createForDay(channel, '2026-10-26', oid())).toEqual([]);
    const none = make({ catalog: [lv('old', { publishedAt: new Date('2025-01-01') })], stock: 0 });
    expect(await none.svc.createForDay(channel, '2026-10-26', oid())).toEqual([]);
  });

  it('queues analysis for new uploads nobody has downloaded, at most four at a time', async () => {
    const cat = ['a', 'b', 'c', 'd', 'e'].map((id, i) => lv(id, { publishedAt: new Date(Date.now() - (i + 1) * 86_400_000) }));
    const { svc } = make({ catalog: cat, stock: 0, sources: ['b'] });
    expect(await svc.analyzeNewUploads(true)).toBe(4);
    expect(svc.runner.kickSource.mock.calls.map((c: any[]) => c[0].youtubeId)).toEqual(['a', 'c', 'd', 'e']);
  });

  it('mines a video that gave no moments one more time', async () => {
    const { svc } = make({ catalog: [], stock: 0, empty: ['wack'] });
    expect(await svc.analyzeNewUploads(true)).toBe(1);
    expect(svc.sources.updateOne).toHaveBeenCalledWith({ youtubeId: 'wack' }, { $set: { minedVersion: null, transcriptReady: false, remined: true } });
    expect(svc.queues.analyze).toHaveBeenCalledWith('wack');
  });

  it('a campaign for a lane needs no web research', () => {
    const r = laneResearch('Make reels from the newest videos');
    expect(r.topicSummary).toContain('newest videos');
    expect(r.angles).toEqual([]);
  });
});

describe('hot videos in the lanes (Nov 17 2026)', () => {
  const channel = oid();
  const now = Date.now();
  const hv = (id: string, over: Partial<LaneVideo> = {}): LaneVideo => lv(id, { analyzed: true, strongMoments: 10, views: 40_000, publishedAt: new Date(now - 2 * 86_400_000), entity: 'yella beezy', demand: 0.3, ...over });

  function hotSvc(catalog: LaneVideo[], rows: { hot?: any[]; news?: any[] } = {}, hotMode = true) {
    const { svc, created } = make({ catalog, stock: 20 });
    svc.cfg = { ...svc.cfg, REEL_HOT_MODE: hotMode };
    svc.campaigns.db = { collection: () => ({ findOne: async () => ({ userId: oid() }) }) };
    svc.campaigns.find = jest.fn((q: any) => {
      const list = q['settings.hot'] ? rows.hot ?? [] : q.track === 'news' ? rows.news ?? [] : [];
      const chain: any = { sort: () => chain, select: () => chain, lean: async () => list };
      return chain;
    });
    return { svc, created };
  }

  it('hotForDay makes one campaign per group, marked hot, on the newest videos', async () => {
    const { svc, created } = hotSvc([hv('a'), hv('b', { views: 36_000 }), hv('durk', { entity: 'lil durk', views: 9_000, publishedAt: new Date(now - 3_600_000 * 12) }), lv('old', { publishedAt: new Date('2024-01-01'), analyzed: true, strongMoments: 99 })]);
    const r = await svc.hotForDay(channel, '2026-11-17', oid(), 3);
    expect(r.reels).toBe(3);
    expect(created.length).toBe(r.campaigns.length);
    for (const c of created) expect(c).toMatchObject({ origin: 'daily', track: 'fresh', dailyDate: '2026-11-17', settings: { lane: 'fresh', hot: true } });
    expect(created.flatMap((c) => c.settings.seedVideoIds)).not.toContain('old');
    expect(created.reduce((a, c) => a + c.settings.targetReels, 0)).toBe(3);
    expect(svc.queues.campaign).toHaveBeenCalledTimes(created.length);
  });

  it('a retried run does not make the hot campaigns twice', async () => {
    const { svc, created } = hotSvc([hv('a'), hv('b')], { hot: [{ _id: oid(), name: 'x', settings: { targetReels: 2, seedVideoIds: ['a'] } }] });
    const r = await svc.hotForDay(channel, '2026-11-17', oid(), 3);
    expect(created).toHaveLength(0);
    expect(r.reels).toBe(2);
  });

  it('makes nothing when the hot videos hold too little footage, or no budget is left', async () => {
    expect((await hotSvc([hv('a', { strongMoments: 3 })]).svc.hotForDay(channel, '2026-11-17', oid(), 3)).reels).toBe(0);
    expect((await hotSvc([hv('a'), hv('b')]).svc.hotForDay(channel, '2026-11-17', oid(), 0)).reels).toBe(0);
  });

  it('the new-video lane starts with the video plus related hot videos, not the video alone', async () => {
    const fresh = hv('new', { publishedAt: new Date(now - 3_600_000 * 5), views: 5_000 });
    const { svc, created } = hotSvc([fresh, hv('rel1'), hv('rel2', { strongMoments: 6 })]);
    await svc.newsReels(new Date(now));
    const news = created.filter((c) => c.track === 'news');
    expect(news).toHaveLength(1);
    expect(news[0].settings.seedVideoIds[0]).toBe('new');
    expect(news[0].settings.seedVideoIds.length).toBeGreaterThan(1);
  });

  it('hot mode off: the new-video lane works as before (the video alone)', async () => {
    const fresh = hv('new', { publishedAt: new Date(now - 3_600_000 * 5), views: 5_000 });
    const { svc, created } = hotSvc([fresh, hv('rel1')], {}, false);
    await svc.newsReels(new Date(now));
    expect(created.filter((c) => c.track === 'news')[0].settings.seedVideoIds).toEqual(['new']);
  });

  it('a failed single-video first try gets one related-videos second try; a failed cluster first try gets none', async () => {
    const fresh = hv('new', { publishedAt: new Date(now - 3_600_000 * 5), views: 5_000 });
    const single = hotSvc([fresh, hv('rel1')], { news: [{ status: 'failed', settings: { seedVideoIds: ['new'] } }] });
    await single.svc.newsReels(new Date(now));
    expect(single.created.filter((c) => c.track === 'news')).toHaveLength(1);
    const cluster = hotSvc([fresh, hv('rel1')], { news: [{ status: 'failed', settings: { seedVideoIds: ['new', 'rel1'] } }] });
    await cluster.svc.newsReels(new Date(now));
    expect(cluster.created.filter((c) => c.track === 'news')).toHaveLength(0);
  });

  it('the backup takes the hot videos even if today used them, but not the ones of a failed campaign', async () => {
    const { svc, created } = hotSvc([hv('a'), hv('b'), hv('c')]);
    svc.campaigns.find = jest.fn(() => {
      const chain: any = { select: () => chain, lean: async () => [{ status: 'completed', settings: { seedVideoIds: ['a'] }, sources: [] }, { status: 'failed', settings: { seedVideoIds: ['b'] }, sources: [] }] };
      return chain;
    });
    await svc.backupForDay(channel, '2026-11-17', oid(), 1);
    const seeds = created[0].settings.seedVideoIds;
    expect(seeds).toContain('a');
    expect(seeds).not.toContain('b');
  });
});
