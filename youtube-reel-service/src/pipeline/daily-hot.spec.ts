import { Types } from 'mongoose';
import { DailyService } from './daily.service';

const oid = () => new Types.ObjectId();

/** A DailyService with everything around runForChannel stubbed: what is checked is how the day is shared between the hot videos and the topic brain. */
function make(opts: { hot: { reels: number; campaigns: any[] }; news?: number; hotMode?: boolean; stock?: number }) {
  const created: any[] = [];
  const runUpdates: any[] = [];
  const svc: any = Object.create(DailyService.prototype);
  svc.logger = { log: jest.fn(), warn: jest.fn() };
  svc.cfg = { REEL_HOT_MODE: opts.hotMode ?? true, REEL_DAILY_REELS: 3, REELS_ENABLED: true, REEL_WORK_DIR: '.', REEL_MIN_FREE_DISK_GB: 0, REEL_EXPLORE_ENABLED: false, REEL_MAX_REELS_PER_CAMPAIGN: 8 };
  svc.isEnabled = async () => true;
  const runId = oid();
  svc.runs = {
    findOne: async () => null,
    create: jest.fn(async () => ({ _id: runId })),
    updateOne: jest.fn(async (...a: any[]) => runUpdates.push(a)),
    findById: () => ({ lean: async () => ({ _id: runId }) }),
  };
  const db = {
    collection: (name: string) => ({
      findOne: async () => ({ userId: oid() }),
      countDocuments: async () => (name === 'reels' ? opts.stock ?? 20 : 0),
    }),
  };
  svc.campaigns = {
    db,
    find: () => ({ select: () => ({ lean: async () => Array.from({ length: opts.news ?? 0 }, () => ({ settings: { targetReels: 1 } })) }) }),
    create: jest.fn(async (doc: any) => {
      created.push(doc);
      return { _id: oid(), ...doc };
    }),
    updateOne: jest.fn(),
  };
  svc.queues = { campaign: jest.fn() };
  svc.lanes = { hotForDay: jest.fn(async () => ({ groups: [], ...opts.hot })), createForDay: jest.fn(async () => []), backupForDay: jest.fn(async () => null) };
  const topic = { c: { name: 'Topic', brief: 'b', why: 'w', keywords: ['k'], signal: 'trend', pillar: null, entity: null }, score: 40, ev: { moments: 20, videos: 5, strongMoments: 10, minableVideos: 0, anchors: [] } };
  svc.decide = jest.fn(async () => ({ main: topic, explore: null, mainReels: 3, exploreReels: 0, candidates: [], degraded: [] }));
  return { svc, created, runUpdates };
}

const hotCamp = (reels: number, entity: string | null = 'yella beezy') => ({ campaignId: String(oid()), name: 'Yella Beezy Gets Life', reels, videos: ['a'], entity });

describe('the daily run with hot videos first (Nov 17 2026)', () => {
  it('when the hot videos give all 3 reels the topic brain is not asked at all', async () => {
    const { svc, runUpdates } = make({ hot: { reels: 3, campaigns: [hotCamp(2), hotCamp(1, 'lil durk')] } });
    await svc.runForChannel(String(oid()), 'schedule');
    expect(svc.decide).not.toHaveBeenCalled();
    expect(svc.campaigns.create).not.toHaveBeenCalled();
    const set = runUpdates.map((a) => a[1].$set).find((x) => x?.status === 'started');
    expect(set.topic.name).toContain('Newest videos');
    expect(set.mainReels).toBe(3);
    expect(set.campaignId).toBeDefined();
  });

  it('the new-video lane counts: its reel is taken off what the hot videos and the topic have to make', async () => {
    const { svc } = make({ hot: { reels: 2, campaigns: [hotCamp(2)] }, news: 1 });
    await svc.runForChannel(String(oid()), 'schedule');
    expect(svc.lanes.hotForDay).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.anything(), { target: 3, newsReels: 1 });
    expect(svc.decide).not.toHaveBeenCalled(); // 1 news + 2 hot = 3
  });

  it('the topic brain only makes what the hot videos could not, and the old lanes stay off', async () => {
    const { svc, created } = make({ hot: { reels: 2, campaigns: [hotCamp(2)] } });
    await svc.runForChannel(String(oid()), 'schedule');
    expect(svc.decide).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
    expect(created[0].settings.targetReels).toBe(1);
    expect(svc.lanes.createForDay).not.toHaveBeenCalled();
  });

  it('with no hot videos the day runs the old way: 3 reels on the topic', async () => {
    const { svc, created } = make({ hot: { reels: 0, campaigns: [] } });
    await svc.runForChannel(String(oid()), 'schedule');
    expect(created).toHaveLength(1);
    expect(created[0].settings.targetReels).toBe(3);
    expect(svc.lanes.createForDay).not.toHaveBeenCalled();
  });

  it('hot mode off: exactly as before, the hot allocation is never asked', async () => {
    const { svc, created } = make({ hot: { reels: 3, campaigns: [hotCamp(3)] }, hotMode: false });
    await svc.runForChannel(String(oid()), 'schedule');
    expect(svc.lanes.hotForDay).not.toHaveBeenCalled();
    expect(created[0].settings.targetReels).toBe(3);
  });

  it('a failure in the hot allocation does not stop the day: the topic brain runs it', async () => {
    const { svc, created } = make({ hot: { reels: 0, campaigns: [] } });
    svc.lanes.hotForDay = jest.fn(async () => {
      throw new Error('catalog unavailable');
    });
    await svc.runForChannel(String(oid()), 'schedule');
    expect(created).toHaveLength(1);
    expect(created[0].settings.targetReels).toBe(3);
  });

  it('the early backup is not started on top of hot campaigns', async () => {
    const { svc } = make({ hot: { reels: 2, campaigns: [hotCamp(2)] }, stock: 0 });
    await svc.runForChannel(String(oid()), 'schedule');
    expect(svc.lanes.backupForDay).not.toHaveBeenCalled();
  });
});
