import { Types } from 'mongoose';
import { nyToUtc } from './auto-plan';
import { FacebookReplyService } from './facebook-reply.service';
import { PublishError } from './types';

/* ---------------------------------------------------------------- a tiny in-memory Mongo, just enough for the reply lane's queries */

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
const query = (rows: any[]) => {
  let r = [...rows];
  const q: any = {
    sort: (s: Record<string, number>) => {
      const [k, d] = Object.entries(s)[0];
      r.sort((a, b) => ((num(getPath(a, k)) ?? 0) - (num(getPath(b, k)) ?? 0)) * d);
      return q;
    },
    limit: (n: number) => ((r = r.slice(0, n)), q),
    select: () => q,
    lean: async () => r,
    then: (res: any, rej: any) => Promise.resolve(r).then(res, rej),
  };
  return q;
};
function collection(rows: any[], keyOf: (f: any) => string) {
  return {
    find: (q: any) => query(rows.filter((d) => match(d, q))),
    countDocuments: async (q: any) => rows.filter((d) => match(d, q)).length,
    findOne: (q: any) => ({ lean: async () => rows.find((d) => match(d, q)) ?? null }),
    distinct: async (field: string, q: any) => [...new Set(rows.filter((d) => match(d, q)).map((d) => d[field]))],
    updateMany: async (q: any, u: any) => {
      const hit = rows.filter((d) => match(d, q));
      for (const d of hit) for (const [p, v] of Object.entries(u.$set ?? {})) setPath(d, p, v);
      return { modifiedCount: hit.length };
    },
    updateOne: async (q: any, u: any, opts: any = {}) => {
      let d = rows.find((x) => match(x, q));
      if (!d && opts.upsert) {
        d = { _id: oid(), ...Object.fromEntries(Object.entries(q).filter(([, v]) => !isOp(v))) };
        d.createdAt = new Date();
        rows.push(d);
      }
      if (d) for (const [p, v] of Object.entries(u.$set ?? {})) setPath(d, p, v);
      return { modifiedCount: d ? 1 : 0 };
    },
  };
}

/* ---------------------------------------------------------------- the world */

const CH = oid();
const CHID = String(CH);
const PAGE = 'PAGE1';
const GRAPH = 'https://graph.facebook.com/v26.0';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const D = '2026-11-27';
const at = (hhmm: string) => nyToUtc(D, hhmm);
const iso = (d: Date) => d.toISOString();

interface World {
  svc: any;
  replies: any[];
  posts: any[];
  settings: any[];
  graphCalls: Array<{ method: string; url: string; body?: any }>;
  fbComments: Record<string, any[]>;
  commentNodes: Record<string, any>;
  modelOut: { items: any[] } | Error;
  modelCalls: any[];
  postError: PublishError | null;
}

function world(o: { mode?: 'off' | 'dry' | 'on'; cap?: number } = {}): World {
  const w: World = { svc: null, replies: [], posts: [], settings: [], graphCalls: [], fbComments: {}, commentNodes: {}, modelOut: { items: [] }, modelCalls: [], postError: null };
  const now = at('13:00');
  w.posts.push({ _id: oid(), channelId: CH, reelId: oid(), platform: 'facebook', status: 'published', externalId: 'V1', metadata: { title: 'Federal Prison: Why 10 Honey Buns Matter' }, publishedAt: new Date(now.getTime() - 2 * 86_400_000) });

  const svc: any = Object.create(FacebookReplyService.prototype);
  svc.logger = { log: jest.fn(), warn: jest.fn() };
  svc.cfg = { FACEBOOK_REPLY_AUTO: o.mode ?? 'on', FACEBOOK_REPLY_DAILY_CAP: o.cap ?? 35, FACEBOOK_REPLY_REEL_DAYS: 7 };
  svc.replies = collection(w.replies, (f) => f.commentId);
  svc.posts = collection(w.posts, (f) => String(f._id));
  svc.settings = collection(w.settings, (f) => f.key);
  svc.tokens = { page: async () => ({ pageId: PAGE, name: 'Page', accessToken: 'TOK' }) };
  svc.facebook = { getAccountStatus: async () => ({ state: 'ok' }) };
  svc.ai = {
    generateJson: async (opts: any) => {
      w.modelCalls.push(opts);
      if (w.modelOut instanceof Error) throw w.modelOut;
      return w.modelOut;
    },
  };
  svc.fetchFn = async (input: any, init: any = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    w.graphCalls.push({ method, url, body: init.body });
    const comments = /\/(V\d+)\/comments\?/.exec(url);
    if (comments && method === 'GET') return json({ data: w.fbComments[comments[1]] ?? [] });
    const node = /\/graph\.facebook\.com\/v26\.0\/([^/?]+)\?/.exec(url) ?? /v26\.0\/([^/?]+)\?/.exec(url);
    if (node && method === 'GET') {
      const n = w.commentNodes[decodeURIComponent(node[1])];
      return n === 'gone' ? json({ error: { message: 'gone', code: 100, error_subcode: 33 } }, 400) : json(n ?? { id: node[1], comment_count: 0 });
    }
    if (method === 'POST' && /\/comments$/.test(url)) {
      if (w.postError) return json({ error: { message: w.postError.message, code: w.postError.code === 'auth' ? 190 : 368 } }, w.postError.kind === 'auth' ? 401 : 400);
      return json({ id: `${url.split('/').slice(-2)[0]}_r1` });
    }
    return json({}, 404);
  };
  w.svc = svc;
  return w;
}

const cm = (id: string, message: string, minsAgo: number, extra: any = {}) => ({ id, message, created_time: iso(new Date(at('13:00').getTime() - minsAgo * 60_000)), comment_count: 0, from: { id: 'USER' }, ...extra });
const reply = (commentId: string, replyText: string, o: any = {}) => ({ commentId, action: 'reply', skipReason: '', tone: 'thanks', replyText, ...o });
const skip = (commentId: string, skipReason: string) => ({ commentId, action: 'skip', skipReason, tone: '', replyText: '' });
const row = (w: World, id: string) => w.replies.find((r) => r.commentId === id);

describe('FacebookReplyService.discover (read comments, decide, queue)', () => {
  it('queues the model replies, records skips, drops what the rules forbid before the model, and never sends those to the model', async () => {
    const w = world();
    w.fbComments.V1 = [
      cm('c1', 'Commissary is very necessary', 10),
      cm('c2', '❤️🔥🔥', 20),
      cm('c3', 'U a fuck boy for saying that', 30),
      cm('c4', 'Watch the full video on YouTube: https://youtu.be/abc', 600, { from: { id: PAGE } }),
      cm('c5', 'visit mysite.com for free money', 40),
      cm('c6', 'someone answered me already', 50, { comment_count: 2 }),
      cm('c7', 'what was his name?', 60),
    ];
    w.modelOut = { items: [reply('c1', 'It really is. That little bag of snacks holds a week together.'), reply('c2', 'Love it, thank you for tapping in.'), skip('c7', 'off_topic')] };
    const out = await w.svc.discover(CHID, at('13:00'));
    expect(out).toMatchObject({ candidates: 3, queued: 2, skipped: 5 });
    expect(row(w, 'c1')).toMatchObject({ decision: 'queued', replyText: 'It really is. That little bag of snacks holds a week together.', mode: 'on' });
    expect(row(w, 'c2').decision).toBe('queued');
    expect(row(w, 'c3')).toMatchObject({ decision: 'skipped', skipReason: 'abuse' });
    expect(row(w, 'c4')).toMatchObject({ decision: 'skipped', skipReason: 'own_comment' });
    expect(row(w, 'c5')).toMatchObject({ decision: 'skipped', skipReason: 'spam' });
    expect(row(w, 'c6')).toMatchObject({ decision: 'skipped', skipReason: 'has_replies' });
    expect(row(w, 'c7')).toMatchObject({ decision: 'skipped', skipReason: 'off_topic' });
    const sent = JSON.parse(w.modelCalls[0].user);
    expect(sent.comments.map((c: any) => c.commentId).sort()).toEqual(['c1', 'c2', 'c7']); // only what the rules let through
    expect(sent.comments[0].reelTitle).toContain('Honey Buns');
    expect(w.graphCalls.some((c) => c.method === 'POST')).toBe(false); // discovering never posts
  });

  it('a reply the rules reject after the model wrote it is skipped, not queued', async () => {
    const w = world();
    w.fbComments.V1 = [cm('c1', 'nice one', 5), cm('c2', 'facts', 6), cm('c3', 'good stuff', 7)];
    w.modelOut = { items: [reply('c1', 'As an AI I hear you, my friend'), reply('c2', 'Check https://youtu.be/x'), reply('c3', 'Appreciate you watching.')] };
    await w.svc.discover(CHID, at('13:00'));
    expect(row(w, 'c1')).toMatchObject({ decision: 'skipped', skipReason: 'reply_forbidden_phrase' });
    expect(row(w, 'c2')).toMatchObject({ decision: 'skipped', skipReason: 'reply_link' });
    expect(row(w, 'c3').decision).toBe('queued');
  });

  it('two replies that are alike are not both queued', async () => {
    const w = world();
    w.fbComments.V1 = [cm('c1', 'good stuff', 5), cm('c2', 'great one', 6)];
    w.modelOut = { items: [reply('c1', 'Appreciate you watching.'), reply('c2', 'Appreciate you watching, my friend.')] };
    await w.svc.discover(CHID, at('13:00'));
    expect([row(w, 'c1').decision, row(w, 'c2').decision].sort()).toEqual(['queued', 'skipped']);
  });

  it('handles each comment once: a second pass neither asks the model again nor queues a duplicate', async () => {
    const w = world();
    w.fbComments.V1 = [cm('c1', 'good stuff', 5)];
    w.modelOut = { items: [reply('c1', 'Appreciate you watching.')] };
    await w.svc.discover(CHID, at('13:00'));
    await w.svc.discover(CHID, at('13:10'));
    expect(w.modelCalls).toHaveLength(1);
    expect(w.replies).toHaveLength(1);
  });

  it('comments older than the window are ignored, and a model outage records nothing so the next pass tries again', async () => {
    const w = world();
    w.fbComments.V1 = [cm('old', 'good stuff', 9 * 24 * 60), cm('c1', 'good stuff', 5)];
    w.modelOut = new Error('insufficient credits');
    const out = await w.svc.discover(CHID, at('13:00'));
    expect(out).toMatchObject({ note: 'model unavailable', queued: 0 });
    expect(w.replies).toHaveLength(0);
    w.modelOut = { items: [reply('c1', 'Appreciate you watching.')] };
    await w.svc.discover(CHID, at('13:10'));
    expect(row(w, 'c1').decision).toBe('queued');
    expect(row(w, 'old')).toBeUndefined();
  });

  it('reads the reels read longest ago first and stamps them', async () => {
    const w = world();
    const second = { _id: oid(), channelId: CH, reelId: oid(), platform: 'facebook', status: 'published', externalId: 'V2', metadata: { title: 'Two' }, publishedAt: new Date(at('13:00').getTime() - 86_400_000), commentsCheckedAt: new Date(at('12:00').getTime()) };
    w.posts.push(second);
    w.fbComments.V1 = [];
    w.fbComments.V2 = [];
    await w.svc.discover(CHID, at('13:00'));
    expect(w.posts[0].commentsCheckedAt).toBeTruthy();
    expect(new Date(w.posts[1].commentsCheckedAt).getTime()).toBe(at('13:00').getTime());
    const urls = w.graphCalls.map((c) => c.url);
    expect(urls.findIndex((u) => u.includes('/V1/comments'))).toBeLessThan(urls.findIndex((u) => u.includes('/V2/comments'))); // V1 was never checked
  });

  it('stops queuing at the daily cap', async () => {
    const w = world({ cap: 1 });
    w.fbComments.V1 = [cm('c1', 'good stuff', 5), cm('c2', 'great one', 6)];
    w.modelOut = { items: [reply('c1', 'Appreciate you watching.'), reply('c2', 'Love it, thank you.')] };
    const out = await w.svc.discover(CHID, at('13:00'));
    expect(out.queued).toBe(1);
    expect(row(w, 'c2')).toBeUndefined(); // decided again later, not lost
  });
});

describe('dry mode', () => {
  it('writes what it would post and sends nothing; going live later answers those comments for real', async () => {
    const w = world({ mode: 'dry' });
    w.fbComments.V1 = [cm('c1', 'good stuff', 5)];
    w.modelOut = { items: [reply('c1', 'Appreciate you watching.')] };
    await w.svc.tick(CHID, at('13:00'));
    expect(row(w, 'c1')).toMatchObject({ decision: 'dry_run', mode: 'dry' });
    expect(w.graphCalls.some((c) => c.method === 'POST')).toBe(false);
    // still dry: not asked again
    await w.svc.tick(CHID, at('13:20'));
    expect(w.modelCalls).toHaveLength(1);
    // switched on: the rehearsal row does not count as handled
    w.svc.cfg.FACEBOOK_REPLY_AUTO = 'on';
    w.modelOut = { items: [reply('c1', 'Thank you for watching, brother.')] };
    await w.svc.tick(CHID, at('13:40'));
    expect(row(w, 'c1')).toMatchObject({ decision: 'queued', mode: 'on' });
    expect(w.replies).toHaveLength(1);
  });
  it('off does nothing at all', async () => {
    const w = world({ mode: 'off' });
    await w.svc.runDue(at('13:00'));
    expect(w.graphCalls).toHaveLength(0);
    expect(w.modelCalls).toHaveLength(0);
  });
});

describe('postNext (the one reply posted per pass)', () => {
  const queued = (w: World, id: string, text = 'Appreciate you watching.', queuedAt = at('12:00')) =>
    w.replies.push({ _id: oid(), channelId: CH, platform: 'facebook', commentId: id, decision: 'queued', replyText: text, queuedAt, attempts: 0 });

  it('posts the oldest queued reply as a reply to that comment and records it', async () => {
    const w = world();
    queued(w, 'c1');
    queued(w, 'c2', 'Love it.', at('12:30'));
    expect(await w.svc.postNext(CHID, at('13:00'))).toBe(1);
    const post = w.graphCalls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe(`${GRAPH}/c1/comments`);
    expect((post.body as URLSearchParams).get('message')).toBe('Appreciate you watching.');
    expect(row(w, 'c1')).toMatchObject({ decision: 'replied', replyId: 'c1_r1' });
    expect(row(w, 'c2').decision).toBe('queued');
  });

  it('waits 4 to 12 minutes after the previous reply, and then goes on', async () => {
    const w = world();
    queued(w, 'c1');
    queued(w, 'c2', 'Love it.', at('12:30'));
    await w.svc.postNext(CHID, at('13:00'));
    expect(await w.svc.postNext(CHID, at('13:02'))).toBe(0);
    expect(await w.svc.postNext(CHID, at('13:14'))).toBe(1);
    expect(row(w, 'c2').decision).toBe('replied');
  });

  it('posts at any hour and not past the daily cap', async () => {
    const w = world({ cap: 1 });
    queued(w, 'c1');
    queued(w, 'c2', 'Love it.', at('12:30'));
    expect(await w.svc.postNext(CHID, at('03:00'))).toBe(1);
    expect(await w.svc.postNext(CHID, at('15:00'))).toBe(0); // cap of 1 reached today
  });

  it('skips a comment that was deleted or already got a reply meanwhile, without posting', async () => {
    const w = world();
    queued(w, 'c1');
    w.commentNodes.c1 = 'gone';
    expect(await w.svc.postNext(CHID, at('13:00'))).toBe(0);
    expect(row(w, 'c1')).toMatchObject({ decision: 'skipped', skipReason: 'comment_gone' });
    queued(w, 'c2', 'Love it.');
    w.commentNodes.c2 = { id: 'c2', comment_count: 1 };
    await w.svc.postNext(CHID, at('13:30'));
    expect(row(w, 'c2')).toMatchObject({ decision: 'skipped', skipReason: 'has_replies' });
    expect(w.graphCalls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('drops a queued reply that waited more than a day', async () => {
    const w = world();
    queued(w, 'c1', 'Appreciate you watching.', new Date(at('13:00').getTime() - 25 * 3_600_000));
    expect(await w.svc.postNext(CHID, at('13:00'))).toBe(0);
    expect(row(w, 'c1')).toMatchObject({ decision: 'skipped', skipReason: 'stale' });
  });

  it('a login error pauses the whole lane (reply stays queued); a rate block pauses for 12 hours', async () => {
    const w = world();
    queued(w, 'c1');
    w.postError = new PublishError('auth', 'expired', 'auth');
    await w.svc.postNext(CHID, at('13:00'));
    expect(row(w, 'c1').decision).toBe('queued');
    expect((await w.svc.state(CHID)).pausedReason).toMatch(/reconnect Facebook/);
    expect(await w.svc.tick(CHID, at('13:30'))).toMatchObject({ status: 'paused' });
    await w.svc.resume(CHID);
    expect((await w.svc.state(CHID)).pausedReason).toBeNull();

    w.postError = new PublishError('fatal', 'You are temporarily blocked from commenting', '368');
    await w.svc.postNext(CHID, at('14:00'));
    const st = await w.svc.state(CHID);
    expect(st.pausedUntil!.getTime()).toBe(at('14:00').getTime() + 12 * 3_600_000);
    expect(await w.svc.tick(CHID, at('20:00'))).toMatchObject({ status: 'paused' });
    expect(await w.svc.tick(CHID, at('14:00').getTime() + 13 * 3_600_000 > 0 ? new Date(at('14:00').getTime() + 13 * 3_600_000) : at('14:00'))).not.toMatchObject({ status: 'paused' }); // the timed pause cleared itself
  });
});

describe('overview (what the operator audits)', () => {
  it('shows the mode, pause, counts and the newest decisions with the comment and the reply', async () => {
    const w = world({ mode: 'dry' });
    w.fbComments.V1 = [cm('c1', 'good stuff', 5), cm('c2', 'fuck you', 6)];
    w.modelOut = { items: [reply('c1', 'Appreciate you watching.')] };
    await w.svc.tick(CHID, at('13:00'));
    const o = await w.svc.overview(CHID, at('13:30'));
    expect(o).toMatchObject({ mode: 'dry', dailyCap: 35, paused: null, today: { dryRun: 1, replied: 0 }, totals: { replied: 0, failed: 0 } });
    expect(o.recent.map((r: any) => [r.decision, r.skipReason, r.comment, r.reply])).toEqual(
      expect.arrayContaining([['dry_run', null, 'good stuff', 'Appreciate you watching.'], ['skipped', 'abuse', 'fuck you', null]]),
    );
    expect(JSON.stringify(o)).not.toContain('TOK');
  });
});
