import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Types } from 'mongoose';
import { buildInstagramCaption, BIO_LINE } from './instagram-caption';
import { classifyInstagramError, containerIdOf, insightValue, InstagramPublisher } from './instagram.publisher';
import { jitterRunAt, JITTER_MIN, nyToUtc } from './auto-plan';
import { countsOf } from './facebook-lane';
import { instagramLaneConfig } from './instagram-lane.service';
import { PublisherRegistry } from './registry';
import { PostMetadata, PublishError, ReelFacts } from './types';

const IG = '1789000000000001';
const CH = '6a81e0e956c00363be7b404e';
const TOKEN = 'PAGE_TOKEN_SECRET';
const GRAPH = 'https://graph.facebook.com/v26.0';
const CONTAINER = '9001';
const URI = `https://rupload.facebook.com/ig-api-upload/v26.0/${CONTAINER}`;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const gerr = (status: number, code: number, extra: any = {}) => json({ error: { message: 'boom', code, ...extra } }, status);

/** A tiny in-memory model of the Instagram publishing endpoints (container / upload / status / publish / insights). */
class FakeInstagram {
  calls: Array<{ method: string; url: string; headers: any; body?: any }> = [];
  statusCodes: string[] = ['IN_PROGRESS', 'FINISHED'];
  uploaded = false;
  uploadFailures: Array<'network' | '503'> = [];
  publishError: Response | null = null;
  insights: Record<string, any> = { 'views,reach,saved,shares': { data: [{ name: 'views', values: [{ value: 1200 }] }, { name: 'reach', values: [{ value: 900 }] }, { name: 'saved', values: [{ value: 14 }] }, { name: 'shares', values: [{ value: 6 }] }] } };

  fetch = async (input: any, init: any = {}): Promise<Response> => {
    const url = String(input);
    const method = init.method ?? 'GET';
    this.calls.push({ method, url, headers: init.headers ?? {}, body: init.body });
    if (url === `${GRAPH}/${IG}/media` && method === 'POST') return json({ id: CONTAINER, uri: URI });
    if (url === URI && method === 'POST') {
      const f = this.uploadFailures.shift();
      if (f === 'network') throw new TypeError('fetch failed');
      if (f === '503') return gerr(503, 2);
      this.uploaded = true;
      return json({ success: true, message: 'Upload successful.' });
    }
    if (url.startsWith(`${GRAPH}/${CONTAINER}?`)) {
      const code = this.statusCodes.length > 1 ? this.statusCodes.shift()! : this.statusCodes[0];
      return json({ id: CONTAINER, status_code: code, status: code === 'ERROR' ? 'Error: bad video' : 'ok', video_status: { uploading_phase: { status: this.uploaded ? 'complete' : 'in_progress' } } });
    }
    if (url === `${GRAPH}/${IG}/media_publish` && method === 'POST') return this.publishError ?? json({ id: '18000000000000001' });
    if (url.startsWith(`${GRAPH}/18000000000000001/insights?`)) {
      const metric = new URL(url).searchParams.get('metric') as string;
      return this.insights[metric] ? json(this.insights[metric]) : gerr(400, 100, { message: 'unknown metric' });
    }
    if (url.startsWith(`${GRAPH}/18000000000000001?`)) {
      const fields = new URL(url).searchParams.get('fields');
      if (fields === 'permalink') return json({ permalink: 'https://www.instagram.com/reel/ABC123/' });
      if (fields === 'like_count,comments_count') return json({ like_count: 40, comments_count: 3 });
      return json({ id: '18000000000000001', permalink: 'https://www.instagram.com/reel/ABC123/' });
    }
    if (url.startsWith(`${GRAPH}/${IG}?`)) return json({ followers_count: 24200, media_count: 410 });
    return gerr(404, 100, { error_subcode: 33 });
  };
}

const tokens = { instagram: jest.fn() };
const countDocuments = jest.fn().mockResolvedValue(0);
let fake: FakeInstagram;
let pub: InstagramPublisher;
let dir: string;
let file: string;

const metadata: PostMetadata = {
  title: 'Honey Buns: the night everything changed',
  description: 'He thought it was a normal night until the call came in.\n\n🎥 FULL VIDEO: https://youtu.be/abc123def45?t=10',
  tags: [],
  hashtags: ['#Shorts', '#PrisonStories', '#HoneyBuns'],
  categoryId: '24',
  privacy: 'public',
  scheduleAt: null,
  madeForKids: false,
  containsSyntheticMedia: false,
  notifySubscribers: false,
};
const ctxOf = (over: Partial<Parameters<InstagramPublisher['publish']>[0]['ctx']> = {}) => ({
  filePath: file,
  fileSize: fs.statSync(file).size,
  saveSession: jest.fn().mockResolvedValue(undefined),
  shouldCancel: jest.fn().mockResolvedValue(false),
  ...over,
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-'));
  file = path.join(dir, 'reel.mp4');
  fs.writeFileSync(file, Buffer.alloc(2048, 1));
  fake = new FakeInstagram();
  tokens.instagram.mockResolvedValue({ igId: IG, username: 'uniquemeccaaudio', pageId: 'P1', pageName: 'Unique Mecca Audio', accessToken: TOKEN });
  pub = new InstagramPublisher(tokens as any, new PublisherRegistry(), { countDocuments } as any);
  pub.fetchFn = fake.fetch as any;
  pub.sleep = async () => undefined;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('buildInstagramCaption', () => {
  it('is a short hook, one context line, the bio pointer and up to 5 hashtags, with no links and no long dashes', () => {
    const c = buildInstagramCaption({ title: 'Honey Buns — the night everything changed', description: metadata.description, hashtags: ['#Shorts', '#a', '#b', '#c', '#d', '#e', '#f'] });
    expect(c).toContain(BIO_LINE);
    expect(c).not.toMatch(/https?:\/\//);
    expect(c).not.toMatch(/[—–]/);
    expect(c.split('\n').pop()!.split(' ')).toHaveLength(5);
    expect(c.length).toBeLessThanOrEqual(500);
  });
  it('does not say "link in bio" for a reel that has no full video on YouTube', () => {
    expect(buildInstagramCaption({ title: 'Hook', description: 'Just a line of context here for the reel.', hashtags: ['#x'] })).not.toContain('link in bio');
  });
});

describe('InstagramPublisher.publish', () => {
  it('creates a resumable REELS container, sends the bytes, waits for FINISHED, publishes and returns the permalink', async () => {
    const ctx = ctxOf();
    const out = await pub.publish({ channelId: 'c', metadata, ctx });
    expect(out).toEqual({ externalId: '18000000000000001', url: 'https://www.instagram.com/reel/ABC123/', warnings: [] });
    const create = fake.calls.find((c) => c.url === `${GRAPH}/${IG}/media`)!;
    const p = create.body as URLSearchParams;
    expect(p.get('media_type')).toBe('REELS');
    expect(p.get('upload_type')).toBe('resumable');
    expect(p.get('caption')).toContain('Honey Buns');
    expect(p.get('access_token')).toBe(TOKEN); // in the body, never in the URL
    const up = fake.calls.find((c) => c.url === URI)!;
    expect(up.headers).toEqual({ Authorization: `OAuth ${TOKEN}`, offset: '0', file_size: '2048' }); // nothing else: extra headers broke the live upload
    expect(ctx.saveSession).toHaveBeenCalledWith(URI, 0);
    expect(ctx.saveSession).toHaveBeenLastCalledWith(URI, 2048);
    expect(fake.calls.filter((c) => c.method === 'POST').some((c) => c.url.includes(TOKEN))).toBe(false);
    expect(fake.calls.findIndex((c) => c.url === URI)).toBeLessThan(fake.calls.findIndex((c) => c.url === `${GRAPH}/${IG}/media_publish`));
  });

  it('retries a failed upload and still publishes once', async () => {
    fake.uploadFailures = ['network', '503'];
    const out = await pub.publish({ channelId: 'c', metadata, ctx: ctxOf() });
    expect(out.externalId).toBe('18000000000000001');
    expect(fake.calls.filter((c) => c.url === `${GRAPH}/${IG}/media_publish`)).toHaveLength(1);
  });

  it('fails with a media error when Instagram reports ERROR while processing', async () => {
    fake.statusCodes = ['ERROR'];
    await expect(pub.publish({ channelId: 'c', metadata, ctx: ctxOf() })).rejects.toMatchObject({ kind: 'media', code: 'processing_error' });
    expect(fake.calls.some((c) => c.url.endsWith('/media_publish'))).toBe(false);
  });

  it('a retry with a saved container does not create or upload twice', async () => {
    fake.uploaded = true;
    fake.statusCodes = ['FINISHED'];
    await pub.publish({ channelId: 'c', metadata, sessionUri: URI, ctx: ctxOf() });
    expect(fake.calls.some((c) => c.url === `${GRAPH}/${IG}/media`)).toBe(false);
    expect(fake.calls.some((c) => c.url === URI)).toBe(false);
  });

  it('gives up waiting as a retry (transient), keeping the container', async () => {
    fake.statusCodes = ['IN_PROGRESS'];
    let t = 0;
    const real = Date.now;
    Date.now = () => (t += 120_000);
    try {
      await expect(pub.publish({ channelId: 'c', metadata, ctx: ctxOf() })).rejects.toMatchObject({ kind: 'transient', code: 'still_processing' });
    } finally {
      Date.now = real;
    }
  });

  it('a lost answer to media_publish is not published twice: the PUBLISHED container is matched by its caption', async () => {
    fake.statusCodes = ['PUBLISHED'];
    const caption = buildInstagramCaption(metadata);
    const base = fake.fetch;
    pub.fetchFn = (async (input: any, init: any) => {
      if (String(input).startsWith(`${GRAPH}/${IG}/media?fields`)) return json({ data: [{ id: '777', caption, permalink: 'https://www.instagram.com/reel/OLD/' }] });
      return base(input, init);
    }) as any;
    const out = await pub.publish({ channelId: 'c', metadata, sessionUri: URI, ctx: ctxOf() });
    expect(out.externalId).toBe('777');
    expect(fake.calls.some((c) => c.url.endsWith('/media_publish'))).toBe(false);
  });

  it('a missing or expired login is an auth error before anything is sent', async () => {
    tokens.instagram.mockResolvedValue(null);
    await expect(pub.publish({ channelId: 'c', metadata, ctx: ctxOf() })).rejects.toMatchObject({ kind: 'auth' });
    tokens.instagram.mockResolvedValue({ igId: IG, username: 'x', pageId: 'P', pageName: 'N', accessToken: TOKEN, tokenExpiresAt: new Date(Date.now() - 1000) });
    await expect(pub.publish({ channelId: 'c', metadata, ctx: ctxOf() })).rejects.toMatchObject({ kind: 'auth', code: 'meta_token_expired' });
    expect(fake.calls).toHaveLength(0);
  });
});

describe('InstagramPublisher account, verify and metrics', () => {
  it('reports the account with its handle and the 24-hour quota', async () => {
    countDocuments.mockResolvedValueOnce(4);
    expect(await pub.getAccountStatus(CH)).toMatchObject({ platform: 'instagram', state: 'ok', externalId: IG, displayName: '@uniquemeccaaudio', quota: { usedToday: 4, dailyCap: 100 } });
    tokens.instagram.mockResolvedValue(null);
    expect((await pub.getAccountStatus(CH)).state).toBe('missing');
  });
  it('reads follower and post counts and never throws', async () => {
    expect(await pub.accountStats('c')).toMatchObject({ followers: 24200, mediaCount: 410 });
  });
  it('verify: a readable media is published; a missing one is processing when young and failed when old', async () => {
    expect((await pub.verify({ channelId: 'c', externalId: '18000000000000001', requestedPrivacy: 'public', scheduled: false, ageMs: 1000 })).state).toBe('published');
    expect((await pub.verify({ channelId: 'c', externalId: 'gone', requestedPrivacy: 'public', scheduled: false, ageMs: 60_000 })).state).toBe('processing');
    expect((await pub.verify({ channelId: 'c', externalId: 'gone', requestedPrivacy: 'public', scheduled: false, ageMs: 3_600_000 })).state).toBe('failed');
  });
  it('collects views, likes, comments, saves and shares, and falls back to a shorter metric list', async () => {
    const m = (await pub.collectMetrics({ channelId: 'c', externalIds: ['18000000000000001'] })).get('18000000000000001') as any;
    expect(m).toMatchObject({ views: 1200, likes: 40, comments: 3, saves: 14, shares: 6, source: 'instagram-graph-api' });
    fake.insights = { views: { data: [{ name: 'views', total_value: { value: 77 } }] } };
    const m2 = (await pub.collectMetrics({ channelId: 'c', externalIds: ['18000000000000001'] })).get('18000000000000001') as any;
    expect(m2.views).toBe(77);
  });
  it('a removed media is reported as removed', async () => {
    const out = await pub.collectMetrics({ channelId: 'c', externalIds: ['gone'] });
    expect(out.get('gone')).toEqual({ removed: true });
  });
});

describe('preflight', () => {
  const reel: ReelFacts = { id: new Types.ObjectId().toString(), durationSec: 40, width: 1080, height: 1920, sizeBytes: 9_000_000, hasAsset: true, status: 'todo', warnings: [] };
  const account = { platform: 'instagram' as const, state: 'ok' as const, externalId: IG, quota: { usedToday: 0, dailyCap: 100 } };
  it('passes a normal reel and blocks a landscape or over-long one', () => {
    expect(pub.preflight({ reel, metadata, account, hasActiveDuplicate: false }).filter((i) => i.level === 'error')).toEqual([]);
    expect(pub.preflight({ reel: { ...reel, width: 1920, height: 1080 }, metadata, account, hasActiveDuplicate: false }).some((i) => i.code === 'not_vertical')).toBe(true);
    expect(pub.preflight({ reel: { ...reel, durationSec: 200 }, metadata, account, hasActiveDuplicate: false }).some((i) => i.code === 'too_long')).toBe(true);
  });
});

describe('helpers', () => {
  it('containerIdOf / insightValue', () => {
    expect(containerIdOf(URI)).toBe(CONTAINER);
    expect(containerIdOf('https://x/y')).toBeNull();
    expect(insightValue({ data: [{ name: 'views', values: [{ value: 5 }, { value: 9 }] }] }, 'views')).toBe(9);
    expect(insightValue({ data: [] }, 'views')).toBeUndefined();
  });
  it('classifies the Instagram-specific errors and falls back to the Facebook ones', () => {
    expect(classifyInstagramError(400, { error: { code: 9007, error_subcode: 2207027, message: 'not ready' } })).toMatchObject({ kind: 'transient' });
    expect(classifyInstagramError(400, { error: { code: 1, error_subcode: 2207051, message: 'blocked' } })).toMatchObject({ kind: 'fatal', code: '2207051' });
    expect(classifyInstagramError(400, { error: { code: 190, message: 'expired' } })).toBeInstanceOf(PublishError);
    expect(classifyInstagramError(400, { error: { code: 190, message: 'expired' } }).kind).toBe('auth');
  });
});

describe('Instagram lane timing and config', () => {
  it('posts at a random second within 2 minutes of the slot, never exactly on it, and the window follows the setting', () => {
    const centre = nyToUtc('2026-11-27', '13:30').getTime();
    const times = Array.from({ length: 60 }, (_, i) => jitterRunAt({ date: '2026-11-27', slot: '13:30', seed: `s${i}`, earliest: 0, others: [], jitterMin: 2 }).getTime());
    for (const t of times) {
      expect(Math.abs(t - centre)).toBeLessThanOrEqual(2 * 60_000);
    }
    expect(times.filter((t) => t === centre)).toHaveLength(0);
    expect(new Set(times).size).toBeGreaterThan(40);
    // the default (YouTube / Facebook) window is untouched
    const wide = Array.from({ length: 60 }, (_, i) => jitterRunAt({ date: '2026-11-27', slot: '13:30', seed: `w${i}`, earliest: 0, others: [] }).getTime());
    expect(Math.max(...wide.map((t) => Math.abs(t - centre)))).toBeGreaterThan(2 * 60_000);
    expect(Math.max(...wide.map((t) => Math.abs(t - centre)))).toBeLessThanOrEqual(JITTER_MIN * 60_000);
  });
  it('the lane config is 3 new + 2 backlog, off by default, with the Instagram slots', () => {
    const base = { INSTAGRAM_AUTO: 'on' as const, INSTAGRAM_NEW_PER_DAY: 3, INSTAGRAM_BACKLOG_PER_DAY: 2, INSTAGRAM_BACKLOG_DAYS: 30, INSTAGRAM_BACKLOG_ORDER: 'retention' as const, INSTAGRAM_EXTRA_SLOT_ET: '16:30', INSTAGRAM_BACKLOG_SLOTS_ET: '13:30,19:30' };
    expect(instagramLaneConfig(base)).toMatchObject({ enabled: true, newPerDay: 3, backlogPerDay: 2, dailyCap: 5, extraSlot: '16:30', backlogSlots: ['13:30', '19:30'], backlogOrder: 'retention' });
    expect(instagramLaneConfig({ ...base, INSTAGRAM_AUTO: 'off' }).enabled).toBe(false);
  });
  it('counts Instagram posts by their own sources and ignores the Facebook ones', () => {
    expect(countsOf(['ig-mirror', 'ig-mirror', 'ig-extra', 'ig-backlog', 'fb-backlog', 'api'], 'ig')).toEqual({ mirror: 2, extra: 1, backlog: 1 });
    expect(countsOf(['ig-mirror', 'fb-mirror'])).toEqual({ mirror: 1, extra: 0, backlog: 0 });
  });
});
