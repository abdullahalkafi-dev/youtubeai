import { Types } from 'mongoose';
import { advance, checkpointAt, checkpointLabel, CHECKPOINT_HOURS, firstCheckpointAt } from './checkpoints';
import { GoogleTokenProvider } from './google-token.provider';
import { buildDescription, buildInsertBody, fitTags, sanitizeTitle, truncateBytes } from './youtube-metadata';
import { preflightChecks, hasErrors } from './preflight';
import { msUntilPacificMidnight, pacificDate } from './publish-quota.service';
import { parseYouTubeId, parsePeriodDays } from './publish.service';
import { PublisherRegistry } from './registry';
import { YouTubePublisher } from './youtube.publisher';
import { PostMetadata, PublishError, PublisherCapabilities, ReelFacts } from './types';
import { SharedUserSchema } from '../db/schemas/shared.readonly';

const meta = (o: Partial<PostMetadata> = {}): PostMetadata => ({
  title: 'The first night inside',
  description: 'He explains what happens at intake.\n\nFull breakdown: https://youtu.be/abc',
  tags: ['prison', 'intake'],
  hashtags: ['#prison'],
  categoryId: '22',
  privacy: 'unlisted',
  scheduleAt: null,
  madeForKids: false,
  containsSyntheticMedia: false,
  notifySubscribers: false,
  ...o,
});

describe('YouTube metadata → single videos.insert body', () => {
  it('puts everything in the insert call and always carries #shorts', () => {
    const { body } = buildInsertBody(meta());
    expect(body.snippet.title).toBe('The first night inside');
    expect(body.snippet.description).toMatch(/#prison #shorts$/);
    expect(body.snippet.categoryId).toBe('22');
    expect(body.status).toEqual({ privacyStatus: 'unlisted', selfDeclaredMadeForKids: false, containsSyntheticMedia: false });
  });

  it('schedules as private + publishAt (YouTube flips it public later)', () => {
    const now = Date.parse('2026-10-16T10:00:00Z');
    const { body } = buildInsertBody(meta({ privacy: 'public', scheduleAt: '2026-10-17T15:00:00Z' }), now);
    expect(body.status.privacyStatus).toBe('private');
    expect(body.status.publishAt).toBe('2026-10-17T15:00:00.000Z');
  });

  it('refuses a schedule less than 5 minutes ahead or invalid', () => {
    const now = Date.parse('2026-10-16T10:00:00Z');
    expect(() => buildInsertBody(meta({ scheduleAt: '2026-10-16T10:02:00Z' }), now)).toThrow(/5 minutes/);
    expect(() => buildInsertBody(meta({ scheduleAt: 'nonsense' }), now)).toThrow(/Invalid/);
  });

  it('strips angle brackets and enforces length limits', () => {
    expect(sanitizeTitle('  A <b>bold</b>   title ')).toBe('A bbold/b title');
    expect(sanitizeTitle('x'.repeat(150)).length).toBeLessThanOrEqual(100);
    const d = buildDescription('é'.repeat(4000), ['#a']);
    expect(Buffer.byteLength(d.text, 'utf8')).toBeLessThanOrEqual(5000);
    expect(d.truncated).toBe(true);
    expect(truncateBytes('日本語日本語', 7)).toBe('日本');
  });

  it('fits tags into the 500-character budget, de-duplicated', () => {
    const many = Array.from({ length: 200 }, (_, i) => `tag number ${i}`);
    const r = fitTags(['Prison', 'prison', ...many]);
    expect(r.tags.filter((t) => t.toLowerCase() === 'prison')).toHaveLength(1);
    expect(r.dropped).toBeGreaterThan(0);
    const used = r.tags.reduce((n, t, i) => n + t.length + (t.includes(' ') ? 2 : 0) + (i ? 1 : 0), 0);
    expect(used).toBeLessThanOrEqual(500);
  });
});

describe('checkpoints', () => {
  const t0 = new Date('2026-10-16T00:00:00Z');
  it('schedules dense early, sparse later, and stops after 90 days', () => {
    expect(firstCheckpointAt(t0)!.toISOString()).toBe('2026-10-16T01:00:00.000Z');
    expect(checkpointAt(t0, 4)!.toISOString()).toBe('2026-10-17T00:00:00.000Z');
    expect(checkpointAt(t0, CHECKPOINT_HOURS.length)).toBeUndefined();
    expect(checkpointAt(t0, 11, 30)).toBeUndefined(); // 90d checkpoint beyond a 30d window
    expect(checkpointLabel(6)).toBe('6h');
    expect(checkpointLabel(24)).toBe('24h');
    expect(checkpointLabel(168)).toBe('7d');
  });
  it('one snapshot covers every overdue checkpoint (no catch-up spam)', () => {
    const now = new Date(t0.getTime() + 30 * 3_600_000); // 30h later: 1h,3h,6h,12h,24h all overdue
    const a = advance(t0, now);
    expect(a.label).toBe('24h');
    expect(CHECKPOINT_HOURS[a.next!]).toBe(48);
  });
  it('ends tracking after the last checkpoint', () => {
    const a = advance(t0, new Date(t0.getTime() + 100 * 86_400_000));
    expect(a.next).toBeUndefined();
  });
});

describe('Pacific-time quota day', () => {
  it('rolls over at midnight Pacific, not UTC (PDT = UTC-7)', () => {
    expect(pacificDate(new Date('2026-10-16T06:59:00Z'))).toBe('2026-10-15');
    expect(pacificDate(new Date('2026-10-16T07:01:00Z'))).toBe('2026-10-16');
  });
  it('computes the wait until the next reset', () => {
    const ms = msUntilPacificMidnight(new Date('2026-10-16T06:00:00Z')); // 23:00 PDT → 1h + margin
    expect(ms).toBeGreaterThan(3_600_000);
    expect(ms).toBeLessThan(3_600_000 + 5 * 60_000);
  });
});

describe('preflight', () => {
  const caps: PublisherCapabilities = {
    label: 'YouTube Shorts', maxDurationSec: 180, aspect: 'vertical-or-square', maxFileMB: 1000, titleMax: 100, descriptionMax: 5000,
    visibilities: ['private', 'unlisted', 'public'], supportsSchedule: true, delivery: 'push-bytes', metrics: ['views'],
  };
  const reel: ReelFacts = { id: 'r', durationSec: 45, width: 1080, height: 1920, sizeBytes: 15e6, hasAsset: true, status: 'todo', warnings: [] };
  const ok = { platform: 'youtube' as const, state: 'ok' as const, quota: { usedToday: 0, dailyCap: 10 } };
  const run = (o: Partial<Parameters<typeof preflightChecks>[0]> = {}) =>
    preflightChecks({ caps, reel, metadata: meta(), account: ok, hasActiveDuplicate: false, now: Date.parse('2026-10-16T10:00:00Z'), ...o });

  it('passes a normal vertical reel', () => expect(hasErrors(run())).toBe(false));
  it('blocks when the account needs reconnecting', () => expect(run({ account: { ...ok, state: 'needs_reconnect' } }).map((i) => i.code)).toContain('account_reconnect'));
  it('blocks at the daily cap', () => expect(run({ account: { ...ok, quota: { usedToday: 10, dailyCap: 10 } } }).map((i) => i.code)).toContain('daily_cap'));
  it('blocks non-vertical or over-long video', () => {
    expect(run({ reel: { ...reel, width: 1920, height: 1080 } }).map((i) => i.code)).toContain('not_vertical');
    expect(run({ reel: { ...reel, durationSec: 200 } }).map((i) => i.code)).toContain('too_long');
  });
  it('blocks a reel that is not rendered, an empty title, a duplicate and a past schedule', () => {
    expect(run({ reel: { ...reel, hasAsset: false } }).map((i) => i.code)).toContain('not_rendered');
    expect(run({ metadata: meta({ title: '  ' }) }).map((i) => i.code)).toContain('title_empty');
    expect(run({ hasActiveDuplicate: true }).map((i) => i.code)).toContain('duplicate_post');
    expect(run({ metadata: meta({ scheduleAt: '2026-10-16T10:01:00Z' }) }).map((i) => i.code)).toContain('schedule_past');
  });
  it('warns (does not block) about copyright when going public immediately', () => {
    const issues = run({ metadata: meta({ privacy: 'public' }) });
    expect(issues.find((i) => i.code === 'rights')?.level).toBe('warning');
    expect(hasErrors(issues)).toBe(false);
  });
});

describe('parsing helpers', () => {
  it('extracts a YouTube id from every common link shape', () => {
    for (const u of ['https://www.youtube.com/shorts/AbC_123-xyZ', 'https://youtu.be/AbC_123-xyZ?t=5', 'https://www.youtube.com/watch?v=AbC_123-xyZ&feature=share', 'https://youtube.com/watch?foo=1&v=AbC_123-xyZ']) {
      expect(parseYouTubeId(u)).toBe('AbC_123-xyZ');
    }
    expect(parseYouTubeId('https://example.com/x')).toBeUndefined();
    expect(parsePeriodDays('30d')).toBe(30);
  });
});

/** ---- GoogleTokenProvider: isolation guarantees ---- */
function tokenHarness(user: any) {
  const ownerId = new Types.ObjectId();
  const calls = { userFind: [] as string[], writes: 0, fetch: [] as string[] };
  const channels: any = { findById: () => ({ lean: async () => ({ _id: 'c1', userId: ownerId, name: 'Unique Mecca Audio', youtubeChannelId: 'UC123', handle: '@x' }) }) };
  const users: any = {
    findById: (id: any) => {
      calls.userFind.push(String(id));
      return { select: (_f: string) => ({ lean: async () => user(ownerId) }) };
    },
    updateOne: () => void calls.writes++,
    findOneAndUpdate: () => void calls.writes++,
  };
  const provider = new GoogleTokenProvider({ GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec' } as any, channels, users);
  provider.fetchFn = (async (url: any, init: any) => {
    calls.fetch.push(String(url) + (init?.body ? ` ${init.body}` : ''));
    if (String(url).includes('tokeninfo')) return new Response(JSON.stringify({ scope: 'https://www.googleapis.com/auth/youtube.force-ssl email' }), { status: 200 });
    return new Response(JSON.stringify({ access_token: 'minted', expires_in: 3600 }), { status: 200 });
  }) as any;
  return { provider, calls, ownerId };
}

describe('GoogleTokenProvider', () => {
  const inFuture = (min: number) => new Date(Date.now() + min * 60_000);

  it('uses the stored access token while it has life left (no Google call, nothing written)', async () => {
    const h = tokenHarness(() => ({ accessToken: 'stored', refreshToken: 'r', tokenExpiresAt: inFuture(40) }));
    expect(await h.provider.getAccessToken('c1')).toBe('stored');
    expect(h.calls.fetch).toHaveLength(0);
    expect(h.calls.writes).toBe(0);
  });

  it('resolves the token from the channel OWNER, never from the caller', async () => {
    const h = tokenHarness(() => ({ accessToken: 'stored', refreshToken: 'r', tokenExpiresAt: inFuture(40) }));
    await h.provider.getAccessToken('c1');
    expect(h.calls.userFind).toEqual([String(h.ownerId)]);
  });

  it('mints a new access token from the refresh token when near expiry, in memory only', async () => {
    const h = tokenHarness(() => ({ accessToken: 'old', refreshToken: 'the-refresh', tokenExpiresAt: inFuture(2) }));
    expect(await h.provider.getAccessToken('c1')).toBe('minted');
    expect(h.calls.fetch[0]).toContain('grant_type=refresh_token');
    expect(h.calls.fetch[0]).toContain('refresh_token=the-refresh');
    expect(h.calls.writes).toBe(0); // the main app's user document is never written
    expect(await h.provider.getAccessToken('c1')).toBe('minted'); // cached
    expect(h.calls.fetch).toHaveLength(1);
  });

  it('forceRefresh skips both the stored and the cached token', async () => {
    const h = tokenHarness(() => ({ accessToken: 'stored', refreshToken: 'r', tokenExpiresAt: inFuture(40) }));
    expect(await h.provider.getAccessToken('c1', { forceRefresh: true })).toBe('minted');
  });

  it('turns invalid_grant into an auth error (account needs reconnecting)', async () => {
    const h = tokenHarness(() => ({ accessToken: 'old', refreshToken: 'dead', tokenExpiresAt: inFuture(-5) }));
    h.provider.fetchFn = (async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })) as any;
    await expect(h.provider.getAccessToken('c1')).rejects.toMatchObject({ kind: 'auth', code: 'invalid_grant' });
  });

  it('reports no connection when the owner has no tokens', async () => {
    const h = tokenHarness(() => ({}));
    await expect(h.provider.getAccessToken('c1')).rejects.toMatchObject({ kind: 'auth' });
  });

  it('accepts youtube.force-ssl as an upload scope (the main app\'s existing grant)', async () => {
    const h = tokenHarness(() => ({}));
    expect(await h.provider.canUpload('tok')).toMatchObject({ ok: true, known: true });
  });

  it('keeps the token fields out of every query by default', () => {
    for (const f of ['accessToken', 'refreshToken', 'tokenExpiresAt']) expect((SharedUserSchema.path(f) as any).options.select).toBe(false);
  });
});

/** ---- YouTubePublisher: verify + the free metrics join ---- */
function publisher(fetchImpl: (url: string) => Response, models: { videos?: any[]; daily?: any[] } = {}) {
  const tokens: any = { getAccessToken: async () => 'tok', identity: async () => ({}) };
  const find = (rows: any[]) => ({ find: () => ({ select: () => ({ lean: async () => rows }), lean: async () => rows }) });
  const p = new YouTubePublisher({ PUBLISH_CHUNK_MB: 1, PUBLISH_YT_DAILY_CAP: 10 } as any, tokens, { usedToday: async () => 0, dailyCap: 10 } as any, new PublisherRegistry(), find(models.videos ?? []) as any, find(models.daily ?? []) as any);
  p.fetchFn = (async (url: any) => fetchImpl(String(url))) as any;
  return p;
}
const videoResponse = (item: any) => new Response(JSON.stringify({ items: item ? [item] : [] }), { status: 200 });
const verifyInput = { channelId: new Types.ObjectId().toString(), externalId: 'vid', requestedPrivacy: 'unlisted' as const, scheduled: false, ageMs: 5 * 60_000 };

describe('YouTubePublisher.verify', () => {
  it('published + visibility honoured', async () => {
    const r = await publisher(() => videoResponse({ status: { uploadStatus: 'processed', privacyStatus: 'unlisted' }, processingDetails: { processingStatus: 'succeeded' }, statistics: { viewCount: '3' } })).verify(verifyInput);
    expect(r.state).toBe('published');
    expect(r.warnings).toEqual([]);
    expect(r.stats?.views).toBe(3);
  });
  it('flags YouTube forcing a video private (unaudited-project policy)', async () => {
    const r = await publisher(() => videoResponse({ status: { uploadStatus: 'processed', privacyStatus: 'private' } })).verify({ ...verifyInput, requestedPrivacy: 'public' });
    expect(r.state).toBe('published');
    expect(r.warnings[0]).toMatch(/PRIVATE/);
  });
  it('a scheduled upload is expected to be private until its time', async () => {
    const r = await publisher(() => videoResponse({ status: { uploadStatus: 'processed', privacyStatus: 'private' } })).verify({ ...verifyInput, requestedPrivacy: 'public', scheduled: true });
    expect(r.warnings).toEqual([]);
  });
  it('still processing', async () => {
    expect((await publisher(() => videoResponse({ status: { uploadStatus: 'uploaded' } })).verify(verifyInput)).state).toBe('processing');
  });
  it('rejected / failed carry a readable reason', async () => {
    const dup = await publisher(() => videoResponse({ status: { uploadStatus: 'rejected', rejectionReason: 'duplicate' } })).verify(verifyInput);
    expect(dup).toMatchObject({ state: 'failed' });
    expect(dup.error).toMatch(/duplicate/);
    const bad = await publisher(() => videoResponse({ status: { uploadStatus: 'failed', failureReason: 'codec' } })).verify(verifyInput);
    expect(bad.error).toMatch(/codec/);
  });
  it('a video that is not found yet is processing when new, failed when old', async () => {
    expect((await publisher(() => videoResponse(null)).verify(verifyInput)).state).toBe('processing');
    expect((await publisher(() => videoResponse(null)).verify({ ...verifyInput, ageMs: 60 * 60_000 })).state).toBe('failed');
  });
  it('quota errors surface as typed errors', async () => {
    const p = publisher(() => new Response(JSON.stringify({ error: { message: 'q', errors: [{ reason: 'quotaExceeded' }] } }), { status: 403 }));
    await expect(p.verify(verifyInput)).rejects.toBeInstanceOf(PublishError);
  });
});

describe('YouTubePublisher.collectMetrics (read-only join with the main app\'s sync)', () => {
  const vid = new Types.ObjectId();
  const today = new Date().toISOString().slice(0, 10);
  const old = '2026-01-01';

  it('combines lifetime counters with daily rows; marks the newest days provisional', async () => {
    const p = publisher(() => videoResponse(null), {
      videos: [{ _id: vid, youtubeId: 'vid', viewCount: 900, likeCount: 40, commentCount: 5, lastSyncedAt: new Date() }],
      daily: [
        { videoId: vid, date: old, views: 600, watchMinutes: 100, retentionPct: 60, likes: 20, subsGained: 3 },
        { videoId: vid, date: today, views: 300, watchMinutes: 50, retentionPct: 80, likes: 20, subsGained: 2 },
      ],
    });
    const out = await p.collectMetrics({ channelId: new Types.ObjectId().toString(), externalIds: ['vid'] });
    const s: any = out.get('vid');
    expect(s.views).toBe(900);
    expect(s.likes).toBe(40);
    expect(s.watchMinutes).toBe(150);
    expect(s.subscribersGained).toBe(5);
    expect(s.avgViewPct).toBeCloseTo(66.7, 1); // weighted by daily views: (60*600 + 80*300) / 900
    expect(s.provisional).toBe(true);
  });

  it('has no sample for a video the main app has not synced yet, and flags deleted ones', async () => {
    const none = await publisher(() => videoResponse(null)).collectMetrics({ channelId: new Types.ObjectId().toString(), externalIds: ['missing'] });
    expect(none.size).toBe(0);
    const gone = await publisher(() => videoResponse(null), { videos: [{ _id: vid, youtubeId: 'vid', deletedFromYoutube: true }] }).collectMetrics({ channelId: new Types.ObjectId().toString(), externalIds: ['vid'] });
    expect(gone.get('vid')).toEqual({ removed: true });
  });
});

describe('YouTubePublisher.postComment', () => {
  const cid = new Types.ObjectId().toString();

  it('sends a top-level comment on the video and reports success as null', async () => {
    let seen: any;
    const p = publisher(() => new Response('{}', { status: 200 }));
    p.fetchFn = (async (url: any, init: any) => {
      seen = { url: String(url), body: JSON.parse(init.body), auth: init.headers.Authorization };
      return new Response('{}', { status: 200 });
    }) as any;
    expect(await p.postComment(cid, 'vid1', 'Would you take the plea?\n\nFull video is in the description.')).toBeNull();
    expect(seen.url).toContain('/youtube/v3/commentThreads?part=snippet');
    expect(seen.auth).toBe('Bearer tok');
    expect(seen.body).toEqual({ snippet: { videoId: 'vid1', topLevelComment: { snippet: { textOriginal: 'Would you take the plea?\n\nFull video is in the description.' } } } });
  });

  it('returns a readable reason when YouTube refuses (the upload is unaffected)', async () => {
    const p = publisher(() => new Response(JSON.stringify({ error: { message: 'Insufficient Permission', errors: [{ reason: 'insufficientPermissions' }] } }), { status: 403 }));
    expect(await p.postComment(cid, 'vid1', 'q')).toBe('insufficientPermissions: Insufficient Permission');
  });
});
