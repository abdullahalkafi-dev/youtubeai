import { Types } from 'mongoose';
import { AutoPublishService } from './auto-publish.service';
import { nyToUtc } from './auto-plan';

const oid = () => new Types.ObjectId();
const chain = <T>(rows: T[]) => {
  const q: any = { select: () => q, sort: () => q, limit: () => q, lean: async () => rows };
  return q;
};

interface FakeReel {
  _id: Types.ObjectId;
  campaignId: Types.ObjectId;
  scores: { overall: number };
  critique: { verdict: string };
  packaging: { title: string };
  concept: string;
  entitySlugs: string[];
  createdAt: Date;
  status: 'todo';
}

function setup(opts: { date: string; todayCamp: Types.ObjectId; campStatus?: string; existingItems?: any[]; reels: FakeReel[]; claim?: boolean }) {
  const channelId = String(oid());
  const settings = { enabled: true, privacy: 'public', slots: ['08:00', '09:00', '20:00', '21:00', '22:00'], extraSlots: [], minScore: 65, maxPerDay: 5, spacingMin: 60, pausedReason: null, pausedAt: null };
  const day = opts.existingItems ? { _id: oid(), status: 'planned', items: opts.existingItems, held: [] } : null;
  const created: any[] = [];
  const dayUpdates: any[] = [];
  const svc: any = Object.create(AutoPublishService.prototype);
  svc.logger = { log: jest.fn(), warn: jest.fn() };
  svc.settingsModel = { findOne: () => ({ lean: async () => ({ value: settings }) }) };
  svc.days = {
    findOne: () => ({ lean: async () => day }),
    create: jest.fn(async (d: any) => d),
    updateOne: jest.fn(async (...a: any[]) => {
      dayUpdates.push(a);
      return { modifiedCount: opts.claim === false ? 0 : 1 };
    }),
    deleteOne: jest.fn(),
  };
  svc.runs = { findOne: () => ({ lean: async () => ({ campaignId: opts.todayCamp, exploreCampaignId: null, rescueExhausted: false, fallbackCount: 0 }) }) };
  svc.campaigns = { find: () => chain([{ _id: opts.todayCamp, status: opts.campStatus ?? 'partial', track: 'main' }]) };
  svc.reels = {
    find: jest.fn((q: any) => {
      // planned reels' entities
      if (q._id && q._id.$in && !q.status) return chain(opts.reels.filter((r) => q._id.$in.some((x: Types.ObjectId) => String(x) === String(r._id))));
      const todayIds = q.campaignId?.$in?.map(String);
      const notToday = q.campaignId?.$nin?.map(String);
      const skip = new Set((q._id?.$nin ?? []).map(String));
      return chain(
        opts.reels
          .filter((r) => !skip.has(String(r._id)))
          .filter((r) => (todayIds ? todayIds.includes(String(r.campaignId)) : true))
          .filter((r) => (notToday ? !notToday.includes(String(r.campaignId)) : true))
          .sort((a, b) => b.scores.overall - a.scores.overall),
      );
    }),
  };
  svc.publish = {
    preflight: jest.fn(async () => ({ canPublish: true, issues: [] })),
    createAutoPost: jest.fn(async (_c: string, _o: string, reelId: string, o: any) => {
      created.push({ reelId, ...o });
      return { id: String(oid()) };
    }),
  };
  svc.registry = { get: () => ({ getAccountStatus: async () => ({ state: 'ok' }) }) };
  svc.channels = { findOne: () => ({ select: () => ({ lean: async () => ({ userId: oid() }) }) }) };
  svc.metrics = { find: () => chain([]) };
  svc.posts = { find: () => chain([]) };
  return { svc, channelId, created, dayUpdates };
}

const reel = (camp: Types.ObjectId, score: number, who: string[], daysAgo = 0): FakeReel => ({
  _id: oid(),
  campaignId: camp,
  scores: { overall: score },
  critique: { verdict: 'keep' },
  packaging: { title: `Reel ${score}` },
  concept: `Reel ${score}`,
  entitySlugs: who,
  createdAt: new Date(Date.now() - daysAgo * 86_400_000),
  status: 'todo',
});

describe('auto-publish fills the day', () => {
  const date = '2026-10-26';

  it('before 7 AM it plans only the reels made today, even if that is one', async () => {
    const today = oid();
    const old = oid();
    const { svc, channelId, created } = setup({ date, todayCamp: today, reels: [reel(today, 80, ['diddy']), reel(old, 90, ['tupac'], 5)] });
    const out = await svc.plan(channelId, nyToUtc(date, '05:10'));
    expect(out).toMatchObject({ status: 'planned', planned: 1, fromStock: 0 });
    expect(created).toHaveLength(1);
    expect(created[0].track).toBe('main');
  });

  it('before 7 AM it waits while today\'s campaigns are still making reels', async () => {
    const today = oid();
    const { svc, channelId, created } = setup({ date, todayCamp: today, campStatus: 'composing', reels: [reel(today, 80, ['diddy'])] });
    expect(await svc.plan(channelId, nyToUtc(date, '05:10'))).toEqual({ status: 'still-making' });
    expect(created).toHaveLength(0);
  });

  it('after 7 AM the empty slots are filled from the stock, best first, two per person at most', async () => {
    const today = oid();
    const old = oid();
    const fresh = reel(today, 78, ['julio-foolio']);
    const stock = [reel(old, 90, ['diddy', 'unique-mecca-audio'], 6), reel(old, 88, ['diddy', 'unique-mecca-audio'], 6), reel(old, 87, ['diddy'], 6), reel(old, 70, ['tupac'], 4), reel(old, 69, ['50-cent'], 3)];
    const { svc, channelId, created } = setup({ date, todayCamp: today, reels: [fresh, ...stock] });
    const out = await svc.plan(channelId, nyToUtc(date, '07:30'));
    expect(out).toMatchObject({ status: 'planned', planned: 5, fromStock: 4 });
    expect(created.map((c) => c.track).sort()).toEqual(['main', 'stock', 'stock', 'stock', 'stock']);
    const planned = created.map((c) => c.reelId);
    expect(planned).toContain(String(fresh._id));
    // three Diddy reels exist, only two are used while others are available
    const diddy = stock.slice(0, 3).filter((r) => planned.includes(String(r._id)));
    expect(diddy).toHaveLength(2);
    // every post got its own slot, all in the future
    expect(new Set(created.map((c) => c.slot)).size).toBe(5);
  });

  it('later calls add to the same day and never reuse a taken slot', async () => {
    const today = oid();
    const old = oid();
    const existing = [{ reelId: oid(), postId: oid(), slot: '08:00', runAt: nyToUtc(date, '08:00'), score: 80, track: 'main', title: 'x' }];
    const { svc, channelId, created } = setup({ date, todayCamp: today, existingItems: existing, reels: [reel(old, 75, ['a']), reel(old, 74, ['b']), reel(old, 73, ['c']), reel(old, 72, ['d']), reel(old, 71, ['e'])] });
    const out = await svc.plan(channelId, nyToUtc(date, '07:30'));
    expect(out).toMatchObject({ status: 'planned', planned: 4 });
    expect(created.map((c) => c.slot).sort()).toEqual(['09:00', '20:00', '21:00', '22:00']);
  });

  it('with no empty slot left it does nothing', async () => {
    const today = oid();
    const existing = ['08:00', '09:00', '20:00', '21:00', '22:00'].map((slot) => ({ reelId: oid(), postId: oid(), slot, runAt: nyToUtc(date, slot), score: 80, track: 'main', title: slot }));
    const { svc, channelId, created } = setup({ date, todayCamp: today, existingItems: existing, reels: [reel(today, 80, ['x'])] });
    expect(await svc.plan(channelId, nyToUtc(date, '05:00'))).toEqual({ status: 'already-planned' });
    expect(created).toHaveLength(0);
  });

  it('late in the day only the slots still ahead are filled', async () => {
    const today = oid();
    const old = oid();
    const existing = ['08:00', '09:00'].map((slot) => ({ reelId: oid(), postId: oid(), slot, runAt: nyToUtc(date, slot), score: 80, track: 'main', title: slot }));
    const { svc, channelId, created } = setup({ date, todayCamp: today, existingItems: existing, reels: [reel(old, 75, ['a']), reel(old, 74, ['b']), reel(old, 73, ['c'])] });
    await svc.plan(channelId, nyToUtc(date, '20:50')); // 8 PM and 9 PM are past/too close; 10 PM is ahead
    expect(created.map((c) => c.slot)).toEqual(['22:00']);
  });

  it('a pass already running for the day (claimed) is left alone', async () => {
    const today = oid();
    const { svc, channelId, created } = setup({ date, todayCamp: today, existingItems: [], reels: [reel(today, 80, ['x'])], claim: false });
    expect(await svc.plan(channelId, nyToUtc(date, '05:10'))).toEqual({ status: 'already-planned' });
    expect(created).toHaveLength(0);
  });

  it('reels below the score bar or failing the checks are never posted, stock included', async () => {
    const today = oid();
    const old = oid();
    const weak = reel(old, 50, ['a'], 3);
    const { svc, channelId, created } = setup({ date, todayCamp: today, reels: [weak, reel(old, 80, ['b'], 3)] });
    await svc.plan(channelId, nyToUtc(date, '07:30'));
    expect(created.map((c) => c.reelId)).not.toContain(String(weak._id));
    expect(created).toHaveLength(1);
  });
});
