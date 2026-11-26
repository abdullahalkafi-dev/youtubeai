import { BuzzsproutClient, BuzzsproutError } from './buzzsprout.client';

function reply(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
}

function make(responses: Response[]) {
  const calls: Array<{ url: string; init: any }> = [];
  const fetchImpl = (async (url: string, init: any) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (!r) throw new Error('no more mocked responses');
    return r;
  }) as unknown as typeof fetch;
  const sleeps: number[] = [];
  const client = new BuzzsproutClient({ apiKey: 'SECRET', podcastId: '77', fetchImpl, sleep: async (ms) => void sleeps.push(ms), maxRetries: 3 });
  return { client, calls, sleeps };
}

describe('BuzzsproutClient', () => {
  it('sends the token and a User-Agent, and creates the episode PRIVATE as a full episode', async () => {
    const { client, calls } = make([reply(201, { id: 5, title: 'T' })]);
    const ep = await client.createEpisode({ title: 'T', description: '<p>d</p>', tags: 'a, b', artist: 'X' });
    expect(ep.id).toBe(5);
    expect(calls[0].url).toBe('https://www.buzzsprout.com/api/77/episodes');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers.Authorization).toBe('Token token=SECRET');
    expect(calls[0].init.headers['User-Agent']).toMatch(/UMA-Podcast/);
    expect(JSON.parse(calls[0].init.body)).toEqual({ title: 'T', description: '<p>d</p>', tags: 'a, b', artist: 'X', private: true, episode_type: 'full' });
  });

  it('retries 429 (honouring Retry-After) and 5xx, then succeeds', async () => {
    const { client, calls, sleeps } = make([reply(429, 'slow down', { 'retry-after': '3' }), reply(503, 'oops'), reply(200, [{ id: 1, title: 'a' }])]);
    const list = await client.listEpisodes();
    expect(list).toHaveLength(1);
    expect(calls).toHaveLength(3);
    expect(sleeps[0]).toBe(3000);
  });

  it('does not retry a validation error and marks it permanent', async () => {
    const { client, calls } = make([reply(422, { error: { code: 'invalid' } })]);
    await expect(client.createEpisode({ title: '', description: '' })).rejects.toMatchObject({ status: 422, permanent: true });
    expect(calls).toHaveLength(1);
  });

  it('gives up after the retries and the error is not permanent', async () => {
    const { client } = make([reply(500, 'x'), reply(500, 'x'), reply(500, 'x'), reply(500, 'x')]);
    const err = await client.listEpisodes().catch((e) => e);
    expect(err).toBeInstanceOf(BuzzsproutError);
    expect(err.permanent).toBe(false);
  });

  it('never leaks the API key in an error message', async () => {
    const { client } = make([reply(401, 'bad token')]);
    const err = await client.listEpisodes().catch((e) => e);
    expect(String(err.message)).not.toContain('SECRET');
  });

  it('start upload reads the nested upload object and refuses multipart', async () => {
    const a = make([reply(201, { upload: { id: 'u1', upload_url: 'https://s3.example/put?sig=1', multipart: false } })]);
    expect(await a.client.startUpload(5, { filename: 'a.mp3', byteSize: 10, type: 'audio/mpeg' })).toMatchObject({ id: 'u1', upload_url: 'https://s3.example/put?sig=1' });
    expect(JSON.parse(a.calls[0].init.body)).toEqual({ filename: 'a.mp3', byte_size: 10, type: 'audio/mpeg' });
    const b = make([reply(201, { upload: { id: 'u2', upload_url: 'x', multipart: true } })]);
    await expect(b.client.startUpload(5, { filename: 'a.mp3', byteSize: 10, type: 'audio/mpeg' })).rejects.toThrow(/multipart/);
  });

  it('url-encodes the upload id when completing', async () => {
    const { client, calls } = make([reply(200, { id: 5 })]);
    await client.completeUpload(5, 'a/b c');
    expect(calls[0].url).toBe('https://www.buzzsprout.com/api/77/episodes/5/uploads/a%2Fb%20c/complete');
  });

  it('waits until duration is positive', async () => {
    const { client, sleeps } = make([reply(200, { id: 5, duration: -1 }), reply(200, { id: 5, duration: -1 }), reply(200, { id: 5, duration: 2847, audio_url: 'u.mp3' })]);
    const ep = await client.waitProcessed(5, 60_000, 10);
    expect(ep.duration).toBe(2847);
    expect(sleeps.filter((s) => s === 10)).toHaveLength(2);
  });

  it('sends chapters as HH:MM:SS and publish as a public episode with a time', async () => {
    const { client, calls } = make([reply(200, {}), reply(200, { id: 5 })]);
    await client.putChapters(5, [{ title: 'Intro', startSec: 0 }, { title: 'Later', startSec: 3725 }]);
    expect(calls[0].init.method).toBe('PUT');
    expect(JSON.parse(calls[0].init.body)).toEqual({ chapters: [{ title: 'Intro', start_time: '00:00:00' }, { title: 'Later', start_time: '01:02:05' }] });
    await client.publish(5, new Date('2026-11-27T12:00:00Z'));
    expect(calls[1].init.method).toBe('PATCH');
    expect(JSON.parse(calls[1].init.body)).toEqual({ private: false, published_at: '2026-11-27T12:00:00.000Z' });
  });
});
