import { Types } from 'mongoose';
import { LanesService } from './lanes.service';
import { laneResearch } from './campaign-runner.service';
import { LaneVideo } from './lanes';

const oid = () => new Types.ObjectId();
const lv = (id: string, over: Partial<LaneVideo> = {}): LaneVideo => ({
  youtubeId: id, videoId: `db-${id}`, title: `Video ${id}`, publishedAt: new Date(Date.now() - 3 * 86_400_000), views: 10_000, durationSec: 1200, analyzed: false, strongMoments: 0, usedMoments: 0, ...over,
});

function make(opts: { catalog: LaneVideo[]; stock: number; existing?: boolean; sources?: string[] }) {
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
  };
  svc.reels = { countDocuments: jest.fn(async () => opts.stock) };
  svc.sources = { find: () => ({ select: () => ({ lean: async () => (opts.sources ?? []).map((youtubeId) => ({ youtubeId })) }) }) };
  svc.settings = { findOne: () => ({ lean: async () => null }), updateOne: jest.fn() };
  svc.queues = { campaign: jest.fn() };
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
    expect(created[0].settings.targetReels).toBe(3);
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

  it('never creates a lane twice for the same day, and skips a lane with no material', async () => {
    const again = make({ catalog: [lv('a')], stock: 0, existing: true });
    expect(await again.svc.createForDay(channel, '2026-10-26', oid())).toEqual([]);
    const none = make({ catalog: [lv('old', { publishedAt: new Date('2025-01-01') })], stock: 0 });
    expect(await none.svc.createForDay(channel, '2026-10-26', oid())).toEqual([]);
  });

  it('queues analysis for new uploads nobody has downloaded, at most three at a time', async () => {
    const cat = ['a', 'b', 'c', 'd', 'e'].map((id, i) => lv(id, { publishedAt: new Date(Date.now() - (i + 1) * 86_400_000) }));
    const { svc } = make({ catalog: cat, stock: 0, sources: ['b'] });
    expect(await svc.analyzeNewUploads(true)).toBe(3);
    expect(svc.runner.kickSource.mock.calls.map((c: any[]) => c[0].youtubeId)).toEqual(['a', 'c', 'd']);
  });

  it('a campaign for a lane needs no web research', () => {
    const r = laneResearch('Make reels from the newest videos');
    expect(r.topicSummary).toContain('newest videos');
    expect(r.angles).toEqual([]);
  });
});
