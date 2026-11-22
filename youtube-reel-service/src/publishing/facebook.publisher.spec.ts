import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Types } from 'mongoose';
import { classifyFacebookError, FACEBOOK_REELS_PER_24H, FacebookPublisher, mapReelStatus, videoIdOf } from './facebook.publisher';
import { PublisherRegistry } from './registry';
import { PostMetadata, PublishError, ReelFacts } from './types';

const PAGE = 'PAGE1';
const TOKEN = 'PAGE_TOKEN_SECRET';
const GRAPH = 'https://graph.facebook.com/v26.0';
const SESSION = 'https://rupload.facebook.com/video-upload/v26.0/555';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const gerr = (status: number, code: number, extra: any = {}) => json({ error: { message: 'boom', code, ...extra } }, status);

/** A tiny in-memory model of the Page Reels endpoints (start / upload / finish / status / insights). */
class FakeFacebook {
  calls: Array<{ method: string; url: string; headers: any; body?: any }> = [];
  received = 0;
  videoStatus: any = { video_status: 'processing' };
  uploadFailures: Array<'network' | '503' | '401'> = [];
  sessionGone = false;
  finishFailure: 'none' | '500' = 'none';
  insights: Record<string, any> = {};
  node: any = { likes: { summary: { total_count: 7 } }, comments: { summary: { total_count: 2 } } };
  nodeError: Response | null = null;
  /** How many comment attempts fail first (Facebook refuses comments while the reel is still processing). */
  commentFailures = 0;

  fetch = async (input: any, init: any = {}): Promise<Response> => {
    const url = String(input);
    const method = init.method ?? 'GET';
    this.calls.push({ method, url, headers: init.headers ?? {}, body: init.body });

    if (url === `${GRAPH}/555/comments` && method === 'POST') {
      if (this.commentFailures > 0) {
        this.commentFailures--;
        return gerr(400, 100, { message: 'Unsupported post request' });
      }
      return json({ id: '555_9' });
    }

    if (url === `${GRAPH}/${PAGE}/video_reels` && method === 'POST') {
      const p = init.body as URLSearchParams;
      if (p.get('upload_phase') === 'start') return json({ video_id: '555', upload_url: SESSION });
      if (p.get('upload_phase') === 'finish') {
        if (this.finishFailure === '500') return gerr(500, 2);
        this.videoStatus = { video_status: 'ready', publishing_phase: { status: 'complete', publish_status: 'published' } };
        return json({ success: true });
      }
    }
    if (url === SESSION && method === 'POST') {
      const failure = this.uploadFailures.shift();
      if (failure === 'network') throw new TypeError('fetch failed');
      if (failure === '503') return gerr(503, 2);
      if (failure === '401') return gerr(401, 190);
      this.received = Number(init.headers.offset) + (init.body as Uint8Array).length;
      return json({ success: true });
    }
    if (url === SESSION && method === 'GET') {
      if (this.sessionGone) return new Response('{}', { status: 404 });
      return json({ start_offset: this.received });
    }
    if (url.startsWith(`${GRAPH}/555/video_insights`)) {
      const metric = new URL(url).searchParams.get('metric')!;
      if (!(metric in this.insights)) return gerr(400, 100, { message: `metric ${metric} invalid` });
      return json({ data: [{ name: metric, values: [{ value: 1 }, { value: this.insights[metric] }] }] });
    }
    if (url.startsWith(`${GRAPH}/555?`)) {
      if (this.nodeError) return this.nodeError.clone();
      if (new URL(url).searchParams.get('fields') === 'status') return json({ status: this.videoStatus, id: '555' });
      return json({ ...this.node, id: '555' });
    }
    throw new Error(`unexpected request ${method} ${url}`);
  };
}

const meta = (over: Partial<PostMetadata> = {}): PostMetadata => ({
  title: 'Unique Mecca Audio: What leaving a prison cell is worth',
  description: '🎥 FULL VIDEO: "x" → https://youtu.be/abc\n\nA man recalls the first night home.',
  tags: ['a'],
  hashtags: ['prison', 'harlem'],
  categoryId: '22',
  privacy: 'unlisted',
  scheduleAt: null,
  madeForKids: false,
  containsSyntheticMedia: false,
  notifySubscribers: false,
  ...over,
});

function setup(opts: { count?: number } = {}) {
  const fb = new FakeFacebook();
  const tokens: any = {
    page: async () => ({ pageId: PAGE, name: 'Mecca Audio Entertainment', accessToken: TOKEN }),
    identity: async () => ({ pageId: PAGE, name: 'Mecca Audio Entertainment', extraPages: 0 }),
  };
  const posts: any = { countDocuments: async () => opts.count ?? 0 };
  const p = new FacebookPublisher(tokens, new PublisherRegistry(), posts);
  p.fetchFn = fb.fetch as any;
  p.sleep = async () => undefined;
  return { p, fb, tokens };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbpub-'));
const FILE = path.join(tmp, 'reel.mp4');
const SIZE = 3000;
beforeAll(() => fs.writeFileSync(FILE, Buffer.alloc(SIZE, 7)));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function ctx(over: any = {}) {
  const saved: Array<[string | null, number]> = [];
  return {
    saved,
    ctx: { filePath: FILE, fileSize: SIZE, saveSession: async (u: string | null, b: number) => void saved.push([u, b]), shouldCancel: async () => false, ...over },
  };
}

describe('FacebookPublisher.publish', () => {
  it('starts, uploads the bytes, then publishes with the short caption', async () => {
    const { p, fb } = setup();
    const c = ctx();
    const out = await p.publish({ channelId: 'c1', metadata: meta(), ctx: c.ctx });

    expect(out).toEqual({ externalId: '555', url: 'https://www.facebook.com/reel/555', warnings: [] });
    const upload = fb.calls.find((x) => x.url === SESSION && x.method === 'POST')!;
    expect(upload.headers.offset).toBe('0');
    expect(upload.headers.file_size).toBe(String(SIZE));
    expect(upload.headers.Authorization).toBe(`OAuth ${TOKEN}`);
    expect(fb.received).toBe(SIZE);

    const finish = fb.calls.filter((x) => x.url === `${GRAPH}/${PAGE}/video_reels`)[1].body as URLSearchParams;
    expect(finish.get('video_state')).toBe('PUBLISHED');
    expect(finish.get('video_id')).toBe('555');
    expect(finish.get('description')).toBe('What leaving a prison cell is worth\n\nA man recalls the first night home.\n\n#prison #harlem');
    expect(finish.get('description')).not.toMatch(/https?:\/\//);
    expect(c.saved).toEqual([[SESSION, 0], [SESSION, SIZE]]);
  });

  it('adds the full-video YouTube link as the first comment (links in the caption are not tappable)', async () => {
    const { p, fb } = setup();
    await p.publish({ channelId: 'c1', metadata: meta(), ctx: ctx().ctx });
    const comment = fb.calls.find((x) => x.url === `${GRAPH}/555/comments`)!;
    expect((comment.body as URLSearchParams).get('message')).toBe('Watch the full video on YouTube: https://youtu.be/abc');
  });

  it('keeps retrying the comment while Facebook still processes the reel, then succeeds with no warning', async () => {
    const { p, fb } = setup();
    fb.commentFailures = 3;
    const out = await p.publish({ channelId: 'c1', metadata: meta(), ctx: ctx().ctx });
    expect(out.warnings).toEqual([]);
    expect(fb.calls.filter((x) => x.url === `${GRAPH}/555/comments`)).toHaveLength(4);
  });

  it('a comment that never goes through is a warning, not a failed post', async () => {
    const { p, fb } = setup();
    fb.commentFailures = 99;
    const out = await p.publish({ channelId: 'c1', metadata: meta(), ctx: ctx().ctx });
    expect(out.externalId).toBe('555');
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings![0]).toMatch(/link comment could not be added/);
    expect(fb.calls.filter((x) => x.url === `${GRAPH}/555/comments`)).toHaveLength(12);
  });

  it('posts no comment when the description has no YouTube link', async () => {
    const { p, fb } = setup();
    await p.publish({ channelId: 'c1', metadata: meta({ description: 'A man recalls the first night home.' }), ctx: ctx().ctx });
    expect(fb.calls.some((x) => x.url === `${GRAPH}/555/comments`)).toBe(false);
  });

  it('never puts the token in a URL', async () => {
    const { p, fb } = setup();
    await p.publish({ channelId: 'c1', metadata: meta(), ctx: ctx().ctx });
    for (const call of fb.calls) expect(call.url).not.toContain(TOKEN);
  });

  it('resumes from the offset Facebook reports, without starting a new session', async () => {
    const { p, fb } = setup();
    fb.received = 1000;
    await p.publish({ channelId: 'c1', metadata: meta(), sessionUri: SESSION, ctx: ctx().ctx });
    expect(fb.calls.some((c) => c.method === 'POST' && c.url === `${GRAPH}/${PAGE}/video_reels` && (c.body as URLSearchParams).get('upload_phase') === 'start')).toBe(false);
    const upload = fb.calls.find((c) => c.url === SESSION && c.method === 'POST')!;
    expect(upload.headers.offset).toBe('1000');
    expect((upload.body as Uint8Array).length).toBe(SIZE - 1000);
  });

  it('sends no bytes when Facebook already has the whole file', async () => {
    const { p, fb } = setup();
    fb.received = SIZE;
    const out = await p.publish({ channelId: 'c1', metadata: meta(), sessionUri: SESSION, ctx: ctx().ctx });
    expect(fb.calls.some((c) => c.url === SESSION && c.method === 'POST')).toBe(false);
    expect(out.externalId).toBe('555');
  });

  it('starts over when the saved session has expired', async () => {
    const { p, fb } = setup();
    fb.sessionGone = true;
    const c = ctx();
    await p.publish({ channelId: 'c1', metadata: meta(), sessionUri: SESSION, ctx: c.ctx });
    expect(c.saved[0]).toEqual([SESSION, 0]); // a fresh session was saved
    expect(fb.received).toBe(SIZE);
  });

  it('is cancelled before anything is sent when the user cancelled', async () => {
    const { p, fb } = setup();
    await expect(p.publish({ channelId: 'c1', metadata: meta(), ctx: ctx({ shouldCancel: async () => true }).ctx })).rejects.toMatchObject({ kind: 'cancelled' });
    expect(fb.calls).toHaveLength(0);
  });

  it('retries a transient upload failure, asks how much Facebook has, and continues', async () => {
    const { p, fb } = setup();
    fb.uploadFailures = ['503', 'network'];
    const out = await p.publish({ channelId: 'c1', metadata: meta(), ctx: ctx().ctx });
    expect(out.externalId).toBe('555');
    expect(fb.calls.filter((c) => c.url === SESSION && c.method === 'POST')).toHaveLength(3);
    expect(fb.calls.filter((c) => c.url === SESSION && c.method === 'GET').length).toBeGreaterThanOrEqual(2);
  });

  it('an expired login during the upload is an auth error (not retried)', async () => {
    const { p, fb } = setup();
    fb.uploadFailures = ['401'];
    await expect(p.publish({ channelId: 'c1', metadata: meta(), ctx: ctx().ctx })).rejects.toMatchObject({ kind: 'auth' });
    expect(fb.calls.filter((c) => c.url === SESSION && c.method === 'POST')).toHaveLength(1);
  });

  it('a retry after a lost "finish" answer succeeds when the reel is already published', async () => {
    const { p, fb } = setup();
    fb.received = SIZE;
    fb.finishFailure = '500';
    fb.videoStatus = { video_status: 'ready', publishing_phase: { status: 'complete', publish_status: 'published' } };
    const out = await p.publish({ channelId: 'c1', metadata: meta(), sessionUri: SESSION, ctx: ctx().ctx });
    expect(out.externalId).toBe('555');
  });

  it('a failed "finish" on a fresh upload is reported, not hidden', async () => {
    const { p, fb } = setup();
    fb.finishFailure = '500';
    await expect(p.publish({ channelId: 'c1', metadata: meta(), ctx: ctx().ctx })).rejects.toMatchObject({ kind: 'transient' });
  });

  it('refuses an empty caption and an empty file', async () => {
    const { p } = setup();
    await expect(p.publish({ channelId: 'c1', metadata: meta({ title: ' ', description: '', hashtags: [] }), ctx: ctx().ctx })).rejects.toMatchObject({ kind: 'invalid_metadata' });
    await expect(p.publish({ channelId: 'c1', metadata: meta(), ctx: ctx({ fileSize: 0 }).ctx })).rejects.toMatchObject({ kind: 'media' });
  });
});

describe('classifyFacebookError', () => {
  const kind = (status: number, error: any) => classifyFacebookError(status, { error }).kind;
  it('maps token and permission problems to auth', () => {
    expect(kind(400, { code: 190 })).toBe('auth');
    expect(kind(400, { code: 102 })).toBe('auth');
    expect(kind(400, { code: 200 })).toBe('auth');
    expect(kind(403, { code: 10 })).toBe('auth');
    expect(kind(401, {})).toBe('auth');
  });
  it('maps rate and usage limits to quota', () => {
    for (const code of [4, 17, 32, 613, 80001]) expect(kind(400, { code })).toBe('quota');
  });
  it('maps video rejections to media, with the resolution code from Meta\'s guide', () => {
    expect(kind(400, { code: 100, error_subcode: 1363127 })).toBe('media');
    expect(kind(400, { code: 1363127 })).toBe('media');
    expect(kind(400, { code: 100, error_subcode: 2207026 })).toBe('media');
  });
  it('maps bad parameters to invalid_metadata and a missing object to not_found', () => {
    expect(kind(400, { code: 100 })).toBe('invalid_metadata');
    const nf = classifyFacebookError(400, { error: { code: 100, error_subcode: 33 } });
    expect(nf.kind).toBe('fatal');
    expect(nf.code).toBe('not_found');
  });
  it('maps server and transient problems to transient, everything else to fatal', () => {
    expect(kind(503, {})).toBe('transient');
    expect(kind(400, { code: 2 })).toBe('transient');
    expect(kind(400, { code: 999, is_transient: true })).toBe('transient');
    expect(kind(400, { code: 368 })).toBe('fatal');
  });
  it('keeps messages short and never echoes a token', () => {
    const e = classifyFacebookError(400, { error: { code: 999, message: 'x'.repeat(1000) } });
    expect(e.message.length).toBeLessThanOrEqual(230);
    expect(e).toBeInstanceOf(PublishError);
  });
});

describe('FacebookPublisher.verify', () => {
  const input = { channelId: 'c1', externalId: '555', requestedPrivacy: 'public', scheduled: false, ageMs: 5 * 60_000 };
  it('reports published, processing and failed from the video status', async () => {
    const { p, fb } = setup();
    fb.videoStatus = { video_status: 'ready', uploading_phase: { status: 'complete' }, processing_phase: { status: 'complete' }, publishing_phase: { status: 'complete', publish_status: 'published' } };
    expect(await p.verify(input)).toMatchObject({ state: 'published', actualPrivacy: 'public' });
    fb.videoStatus = { video_status: 'processing', processing_phase: { status: 'in_progress' } };
    expect((await p.verify(input)).state).toBe('processing');
    fb.videoStatus = { video_status: 'error', processing_phase: { status: 'error', errors: [{ message: 'Unsupported codec' }] } };
    const failed = await p.verify(input);
    expect(failed.state).toBe('failed');
    expect(failed.error).toContain('Unsupported codec');
  });
  it('a video that cannot be found is still processing when young and failed when old', async () => {
    const { p, fb } = setup();
    fb.nodeError = gerr(400, 100, { error_subcode: 33 });
    expect((await p.verify(input)).state).toBe('processing');
    expect((await p.verify({ ...input, ageMs: 60 * 60_000 })).state).toBe('failed');
  });
  it('an unknown status shape is treated as still processing', () => {
    expect(mapReelStatus(undefined).state).toBe('processing');
    expect(mapReelStatus({}).state).toBe('processing');
  });
});

describe('FacebookPublisher.collectMetrics', () => {
  it('maps views, likes and comments; falls back to the next view metric', async () => {
    const { p, fb } = setup();
    fb.insights = { post_video_views: 1234, post_video_avg_time_watched: 12345 };
    const out = await p.collectMetrics({ channelId: 'c1', externalIds: ['555'] });
    expect(out.get('555')).toMatchObject({ views: 1234, likes: 7, comments: 2, avgViewDurationSec: 12.3, provisional: true, source: 'facebook-graph-api' });
  });
  it('prefers the first view metric when it answers', async () => {
    const { p, fb } = setup();
    fb.insights = { blue_reels_play_count: 999, post_video_views: 5 };
    expect((await p.collectMetrics({ channelId: 'c1', externalIds: ['555'] })).get('555')).toMatchObject({ views: 999 });
  });
  it('gives no sample when no view metric is readable yet', async () => {
    const { p } = setup();
    expect((await p.collectMetrics({ channelId: 'c1', externalIds: ['555'] })).has('555')).toBe(false);
  });
  it('marks a deleted video as removed', async () => {
    const { p, fb } = setup();
    fb.nodeError = gerr(400, 100, { error_subcode: 33 });
    expect((await p.collectMetrics({ channelId: 'c1', externalIds: ['555'] })).get('555')).toEqual({ removed: true });
  });
  it('passes an auth failure up so the metrics job can report it', async () => {
    const { p, fb } = setup();
    fb.nodeError = gerr(400, 190);
    await expect(p.collectMetrics({ channelId: 'c1', externalIds: ['555'] })).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('FacebookPublisher.preflight', () => {
  const reel: ReelFacts = { id: 'r1', durationSec: 45, width: 1080, height: 1920, sizeBytes: 20_000_000, hasAsset: true, status: 'todo', warnings: [] };
  const account: any = { platform: 'facebook', state: 'ok', externalId: PAGE, displayName: 'Page', quota: { usedToday: 0, dailyCap: FACEBOOK_REELS_PER_24H } };
  const run = (over: any = {}) => setup().p.preflight({ reel, metadata: meta(), account, hasActiveDuplicate: false, ...over });
  const codes = (issues: any[]) => issues.map((i) => i.code);

  it('accepts a normal reel even though the shared default visibility is "unlisted"', () => {
    expect(run().filter((i) => i.level === 'error')).toEqual([]);
  });
  it('blocks a too-long, too-small, horizontal or unrendered reel', () => {
    expect(codes(run({ reel: { ...reel, durationSec: 120 } }))).toContain('too_long');
    expect(codes(run({ reel: { ...reel, width: 360, height: 640 } }))).toContain('resolution_low');
    expect(codes(run({ reel: { ...reel, width: 1920, height: 1080 } }))).toContain('not_vertical');
    expect(codes(run({ reel: { ...reel, hasAsset: false } }))).toContain('not_rendered');
  });
  it('blocks a duplicate, a scheduled time (our queue decides the time) and an empty caption', () => {
    expect(codes(run({ hasActiveDuplicate: true }))).toContain('duplicate_post');
    expect(codes(run({ metadata: meta({ scheduleAt: new Date(Date.now() + 86_400_000).toISOString() }) }))).toContain('schedule_unsupported');
    expect(codes(run({ metadata: meta({ title: ' ', description: '', hashtags: [] }) }))).toEqual(expect.arrayContaining(['title_empty', 'caption_empty']));
  });
  it('uses Facebook wording for the 24-hour limit and the rights warning, and drops the YouTube-only warnings', () => {
    const full = run({ account: { ...account, quota: { usedToday: 30, dailyCap: 30 } }, metadata: meta({ tags: Array.from({ length: 80 }, (_, i) => `tag-number-${i}`) }) });
    expect(full.find((i) => i.code === 'daily_cap')?.message).toContain('24 hours');
    expect(full.find((i) => i.code === 'daily_cap')?.message).not.toContain('Pacific');
    expect(codes(full)).not.toContain('tags_trimmed');
    const rights = run().find((i) => i.code === 'rights');
    expect(rights?.level).toBe('warning');
    expect(rights?.message).toContain('Facebook');
    expect(rights?.message).not.toContain('Unlisted');
  });
  it('errors when the Page is missing or needs reconnecting', () => {
    expect(codes(run({ account: { ...account, state: 'missing' } }))).toContain('account_missing');
    expect(codes(run({ account: { ...account, state: 'needs_reconnect' } }))).toContain('account_reconnect');
  });
});

describe('FacebookPublisher.getAccountStatus', () => {
  it('is "missing" when Facebook is not connected', async () => {
    const { p, tokens } = setup();
    tokens.identity = async () => null;
    expect((await p.getAccountStatus('c1')).state).toBe('missing');
  });
  it('reports the Page and the moving 24-hour count', async () => {
    const { p } = setup({ count: 4 });
    expect(await p.getAccountStatus(new Types.ObjectId().toString())).toMatchObject({ platform: 'facebook', state: 'ok', externalId: PAGE, displayName: 'Mecca Audio Entertainment', quota: { usedToday: 4, dailyCap: 30 } });
  });
  it('needs a reconnect once the login has expired', async () => {
    const { p, tokens } = setup();
    tokens.identity = async () => ({ pageId: PAGE, name: 'P', extraPages: 0, tokenExpiresAt: new Date(Date.now() - 1000) });
    expect((await p.getAccountStatus(new Types.ObjectId().toString())).state).toBe('needs_reconnect');
  });
  it('never throws, so one Facebook problem cannot hide the YouTube account', async () => {
    const { p, tokens } = setup();
    tokens.identity = async () => {
      throw new Error('db down');
    };
    expect((await p.getAccountStatus(new Types.ObjectId().toString())).state).toBe('missing');
  });
  it('registers itself with the publisher registry', () => {
    const registry = new PublisherRegistry();
    const p = new FacebookPublisher({} as any, registry, {} as any);
    p.onModuleInit();
    expect(registry.get('facebook')).toBe(p);
    expect(registry.planned()).not.toContain('facebook');
  });
});

describe('videoIdOf', () => {
  it('reads the video id from the upload URL', () => {
    expect(videoIdOf('https://rupload.facebook.com/video-upload/v26.0/555?x=1')).toBe('555');
    expect(videoIdOf('https://example.com/x')).toBeNull();
  });
});
