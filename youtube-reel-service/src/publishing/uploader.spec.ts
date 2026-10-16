import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { classifyYouTubeError, parseRangeEnd, YouTubeUploader } from './youtube-uploader';
import { PublishError } from './types';

const MB = 1024 * 1024;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const googleError = (status: number, reason: string, message = 'boom') => json({ error: { code: status, message, errors: [{ reason, message }] } }, status);

/** A tiny in-memory model of YouTube's resumable upload protocol. */
class FakeYouTube {
  received = 0;
  total = 0;
  initiated = 0;
  resource: any = null;
  expired = false;
  failures: Array<'network' | '503' | '401' | 'quota'> = [];
  calls: Array<{ method: string; kind: 'init' | 'chunk' | 'status'; range?: string }> = [];
  initBody: any;

  fetch = async (input: any, init: any = {}): Promise<Response> => {
    const url = String(input);
    const method = init.method ?? 'GET';
    if (url.includes('uploadType=resumable')) {
      this.calls.push({ method, kind: 'init' });
      this.initiated++;
      this.total = Number(init.headers['X-Upload-Content-Length']);
      this.initBody = JSON.parse(init.body);
      this.received = 0;
      return new Response('{}', { status: 200, headers: { location: 'https://upload.test/s/1' } });
    }
    if (url === 'https://upload.test/s/1' && method === 'PUT') {
      const range: string = init.headers['Content-Range'];
      if (this.expired) return new Response('{}', { status: 404 });
      if (range.startsWith('bytes */')) {
        this.calls.push({ method, kind: 'status', range });
        if (this.resource) return json(this.resource);
        return new Response(null, { status: 308, headers: this.received ? { range: `bytes=0-${this.received - 1}` } : {} });
      }
      this.calls.push({ method, kind: 'chunk', range });
      const failure = this.failures.shift();
      if (failure === 'network') throw new TypeError('fetch failed');
      if (failure === '503') return googleError(503, 'backendError', 'try later');
      if (failure === '401') return googleError(401, 'authError', 'expired');
      if (failure === 'quota') return googleError(403, 'quotaExceeded', 'quota');
      const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(range)!;
      const start = Number(m[1]);
      const end = Number(m[2]);
      if (start !== this.received) return googleError(400, 'invalidRange', `expected offset ${this.received}, got ${start}`);
      this.received = end + 1;
      if (this.received >= this.total) {
        this.resource = { id: 'vid123', status: { privacyStatus: 'unlisted' } };
        return json(this.resource);
      }
      return new Response(null, { status: 308, headers: { range: `bytes=0-${end}` } });
    }
    throw new Error(`unexpected request ${method} ${url}`);
  };
}

function makeFile(bytes: number) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'up-')), 'reel.mp4');
  fs.writeFileSync(file, Buffer.alloc(bytes, 7));
  return file;
}

function setup(bytes = 2.5 * MB) {
  const yt = new FakeYouTube();
  const up = new YouTubeUploader(1); // 1 MiB chunks
  up.fetchFn = yt.fetch as any;
  up.sleep = async () => undefined;
  const saved: Array<[string | null, number]> = [];
  let tokenCalls = 0;
  let refreshCalls = 0;
  const base = {
    body: { snippet: { title: 't' }, status: { privacyStatus: 'unlisted' } } as any,
    notifySubscribers: false,
    filePath: makeFile(bytes),
    fileSize: bytes,
    getToken: async () => `tok-${++tokenCalls}`,
    refreshToken: async () => `fresh-${++refreshCalls}`,
    saveSession: async (u: string | null, b: number) => void saved.push([u, b]),
    shouldCancel: async () => false,
  };
  return { yt, up, base, saved, counters: () => ({ tokenCalls, refreshCalls }) };
}

describe('YouTubeUploader (resumable)', () => {
  it('uploads in chunks with correct Content-Range and persists the session after each', async () => {
    const { yt, up, base, saved } = setup();
    const r = await up.upload(base);
    expect(r.id).toBe('vid123');
    expect(yt.initiated).toBe(1);
    expect(yt.calls.filter((c) => c.kind === 'chunk').map((c) => c.range)).toEqual([
      `bytes 0-${MB - 1}/${2.5 * MB}`,
      `bytes ${MB}-${2 * MB - 1}/${2.5 * MB}`,
      `bytes ${2 * MB}-${2.5 * MB - 1}/${2.5 * MB}`,
    ]);
    expect(saved[0]).toEqual(['https://upload.test/s/1', 0]);
    expect(saved.map((s) => s[1])).toEqual([0, MB, 2 * MB, 2.5 * MB]);
    expect(yt.initBody.status.privacyStatus).toBe('unlisted');
  });

  it('resumes an existing session from the offset YouTube reports, without re-initiating', async () => {
    const { yt, up, base } = setup();
    yt.total = 2.5 * MB;
    yt.received = MB; // YouTube already holds the first MiB
    const r = await up.upload({ ...base, sessionUri: 'https://upload.test/s/1' });
    expect(r.id).toBe('vid123');
    expect(yt.initiated).toBe(0);
    const chunks = yt.calls.filter((c) => c.kind === 'chunk');
    expect(chunks[0].range).toBe(`bytes ${MB}-${2 * MB - 1}/${2.5 * MB}`);
    expect(chunks).toHaveLength(2);
  });

  it('recognises an already-finished upload and returns its id WITHOUT sending the file again (no duplicate)', async () => {
    const { yt, up, base } = setup();
    yt.resource = { id: 'already-there' };
    const r = await up.upload({ ...base, sessionUri: 'https://upload.test/s/1' });
    expect(r.id).toBe('already-there');
    expect(yt.calls.filter((c) => c.kind === 'chunk')).toHaveLength(0);
    expect(yt.initiated).toBe(0);
  });

  it('starts over when the saved session has expired', async () => {
    const { yt, up, base } = setup();
    yt.expired = true;
    // After "expiry" the new session works normally.
    const original = yt.fetch;
    let first = true;
    up.fetchFn = (async (i: any, init: any) => {
      if (String(i) === 'https://upload.test/s/1' && first) {
        first = false;
        return new Response('{}', { status: 410 });
      }
      yt.expired = false;
      return original(i, init);
    }) as any;
    const r = await up.upload({ ...base, sessionUri: 'https://upload.test/s/1' });
    expect(r.id).toBe('vid123');
    expect(yt.initiated).toBe(1);
  });

  it('recovers from a network drop mid-upload by asking YouTube where it got to', async () => {
    const { yt, up, base } = setup();
    yt.failures = [undefined as any, 'network']; // chunk 1 ok, chunk 2 throws
    const r = await up.upload(base);
    expect(r.id).toBe('vid123');
    expect(yt.calls.some((c) => c.kind === 'status')).toBe(true);
    expect(yt.initiated).toBe(1); // never a second upload
  });

  it('retries a 5xx on a chunk', async () => {
    const { yt, up, base } = setup();
    yt.failures = ['503'];
    expect((await up.upload(base)).id).toBe('vid123');
  });

  it('gives up with a transient error after too many failures', async () => {
    const { yt, up, base } = setup();
    yt.failures = Array(10).fill('503');
    await expect(up.upload(base)).rejects.toMatchObject({ kind: 'transient' });
  });

  it('refreshes the token once on a 401 and carries on', async () => {
    const { yt, up, base, counters } = setup();
    yt.failures = ['401'];
    expect((await up.upload(base)).id).toBe('vid123');
    expect(counters().refreshCalls).toBe(1);
  });

  it('fails fast (no retries) on quota exceeded', async () => {
    const { yt, up, base } = setup();
    yt.failures = ['quota'];
    await expect(up.upload(base)).rejects.toMatchObject({ kind: 'quota' });
    expect(yt.calls.filter((c) => c.kind === 'chunk')).toHaveLength(1);
  });

  it('stops between chunks when cancelled and keeps the session for a later resume', async () => {
    const { yt, up, base, saved } = setup();
    let n = 0;
    await expect(up.upload({ ...base, shouldCancel: async () => ++n > 1 })).rejects.toMatchObject({ kind: 'cancelled' });
    expect(yt.calls.filter((c) => c.kind === 'chunk')).toHaveLength(1);
    expect(saved.at(-1)![1]).toBe(MB);
  });

  it('rejects an empty file', async () => {
    const { up, base } = setup();
    await expect(up.upload({ ...base, fileSize: 0 })).rejects.toBeInstanceOf(PublishError);
  });
});

describe('classifyYouTubeError', () => {
  const cases: Array<[number, string, string, string]> = [
    [401, 'authError', 'auth', ''],
    [403, 'insufficientPermissions', 'auth', 'Insufficient Permission'],
    [403, 'quotaExceeded', 'quota', ''],
    [403, 'uploadLimitExceeded', 'channel_limit', ''],
    [400, 'invalidTitle', 'invalid_metadata', ''],
    [400, 'invalidTags', 'invalid_metadata', ''],
    [400, 'invalidPublishAt', 'invalid_metadata', ''],
    [400, 'mediaBodyRequired', 'media', ''],
    [403, 'youtubeSignupRequired', 'fatal', ''],
    [500, 'backendError', 'transient', ''],
    [429, 'rateLimitExceeded', 'transient', ''],
    [404, 'videoNotFound', 'fatal', ''],
  ];
  it.each(cases)('HTTP %i %s → %s', (status, reason, kind, message) => {
    const e = classifyYouTubeError(status, { error: { message: message || 'x', errors: [{ reason }] } });
    expect(e.kind).toBe(kind);
  });
});

describe('parseRangeEnd', () => {
  it('turns Range into the next offset', () => {
    expect(parseRangeEnd('bytes=0-1048575')).toBe(1048576);
    expect(parseRangeEnd(null)).toBe(0);
  });
});
