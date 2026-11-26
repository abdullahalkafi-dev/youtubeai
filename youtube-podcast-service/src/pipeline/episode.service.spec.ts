import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BuzzsproutError } from '../buzzsprout/buzzsprout.client';
import { EpisodeService } from './episode.service';

const DESC = `Summary line.\n\n⏱️ CHAPTERS:\n0:00 - Intro\n2:00 - Middle\n5:00 - End\n\n#tag`;
const VIDEO = { youtubeId: 'vid12345678', title: 'My Episode Title', description: DESC, tags: ['one', 'two'] };

function setup(over: { ep?: any; cfg?: any; bs?: any; video?: any } = {}) {
  const doc: any = { _id: 'id1', youtubeId: VIDEO.youtubeId, title: VIDEO.title, attempts: 0, status: 'processing', ...(over.ep ?? {}) };
  const saved: any[] = [];
  const episodes: any = {
    updateOne: async (_q: any, u: any) => {
      saved.push(u.$set);
      for (const [k, v] of Object.entries(u.$set)) doc[k] = v;
    },
  };
  const videos: any = { findOne: () => ({ lean: async () => (over.video === null ? null : over.video ?? VIDEO) }) };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-test-'));
  const mp3 = path.join(tmp, 'a.mp3');
  fs.writeFileSync(mp3, Buffer.alloc(2048));
  const audio: any = {
    calls: [] as string[],
    prepare: async () => (audio.calls.push('prepare'), { mp3Path: mp3, source: 'cache', originalSec: 600, durationSec: 590, removedSec: 10, cuts: [{ start: 100, end: 110 }] }),
    keep: async () => (audio.calls.push('keep'), { key: 'k/episode.mp3', bytes: 2048 }),
    fetchKept: async () => (audio.calls.push('fetchKept'), mp3),
  };
  const calls: string[] = [];
  const bs: any = {
    listEpisodes: async () => (calls.push('list'), []),
    createEpisode: async (i: any) => (calls.push('create'), { id: 777, title: i.title, duration: -1, audio_url: null }),
    getEpisode: async () => (calls.push('get'), { id: 777, duration: -1 }),
    startUpload: async () => (calls.push('startUpload'), { id: 'u1', upload_url: 'https://s3/put' }),
    putFile: async () => void calls.push('put'),
    completeUpload: async () => void calls.push('complete'),
    waitProcessed: async () => (calls.push('wait'), { id: 777, duration: 590, audio_url: 'https://www.buzzsprout.com/1/episodes/777-x.mp3' }),
    putChapters: async () => void calls.push('chapters'),
    publish: async () => (calls.push('publish'), { id: 777, audio_url: 'https://www.buzzsprout.com/1/episodes/777-x.mp3' }),
    ...(over.bs ?? {}),
  };
  const cfg: any = { PODCAST_WORK_DIR: tmp, PODCAST_DRY_RUN: false, PODCAST_MAX_ATTEMPTS: 4, PODCAST_MAX_TAGS: 10, PODCAST_YT_LINK: true, PODCAST_ARTIST: 'ARTIST', ALERT_WEBHOOK_URL: '', ...(over.cfg ?? {}) };
  const svc = new EpisodeService(cfg, bs, episodes, {} as any, videos, audio);
  return { svc, doc, calls, audio, saved };
}

describe('EpisodeService.process', () => {
  it('happy path: one private episode, upload, wait, chapters, then publish; ends as uploaded', async () => {
    const { svc, doc, calls } = setup();
    await svc.process(doc);
    expect(calls).toEqual(['list', 'create', 'get', 'startUpload', 'put', 'complete', 'wait', 'chapters', 'publish']);
    expect(doc.status).toBe('uploaded');
    expect(doc.buzzsprout).toMatchObject({ episodeId: 777, uploadDone: true, processed: true, chaptersDone: true, published: true, pageUrl: 'https://www.buzzsprout.com/1/episodes/777-x' });
    expect(doc.meta.chapters.map((c: any) => c.startSec)).toEqual([0, 110, 290]); // 2:00 and 5:00 both come after the 10 s cut at 100 s
    expect(doc.audio).toMatchObject({ durationSec: 590, removedSec: 10 });
  });

  it('a retry resumes: nothing is made or created twice', async () => {
    const first = setup();
    await first.svc.process(first.doc);
    const again = setup({ ep: { audio: first.doc.audio, meta: first.doc.meta, buzzsprout: first.doc.buzzsprout, status: 'processing' } });
    await again.svc.process(again.doc);
    expect(again.calls).toEqual([]);
    expect(again.audio.calls).toEqual([]);
    expect(again.doc.status).toBe('uploaded');
  });

  it('never uploads audio onto an episode that already has processed audio', async () => {
    const f = setup();
    await f.svc.process(f.doc);
    const lost = setup({ ep: { audio: f.doc.audio, meta: f.doc.meta, buzzsprout: { episodeId: 777 } }, bs: { getEpisode: async () => ({ id: 777, duration: 590 }) } });
    await lost.svc.process(lost.doc);
    expect(lost.calls).not.toContain('startUpload');
    expect(lost.calls).not.toContain('put');
    expect(lost.doc.status).toBe('uploaded');
  });

  it('a same-title episode that already has audio is skipped and is NOT adopted as our own episode', async () => {
    const { svc, doc, calls } = setup({ bs: { listEpisodes: async () => [{ id: 55, title: '  my   episode TITLE', duration: 1800, audio_url: 'https://www.buzzsprout.com/1/episodes/55-x.mp3' }] } });
    await svc.process(doc);
    expect(doc.status).toBe('skipped');
    expect(doc.buzzsprout.existingEpisodeId).toBe(55);
    expect(doc.buzzsprout.episodeId).toBeUndefined();
    expect(calls).not.toContain('create');
    expect(calls).not.toContain('startUpload');
  });

  it('a same-title episode WITHOUT audio (a crash before upload) is adopted and finished', async () => {
    const { svc, doc, calls } = setup({ bs: { listEpisodes: async () => [{ id: 66, title: 'My Episode Title', duration: -1, audio_url: null }] } });
    await svc.process(doc);
    expect(calls).not.toContain('create');
    expect(calls).toContain('startUpload');
    expect(doc.buzzsprout.episodeId).toBe(66);
    expect(doc.status).toBe('uploaded');
  });

  it('dry run prepares audio and text but sends nothing to Buzzsprout', async () => {
    const { svc, doc, calls, audio } = setup({ cfg: { PODCAST_DRY_RUN: true } });
    await svc.process(doc);
    expect(calls).toEqual([]);
    expect(audio.calls).toEqual(['prepare', 'keep']);
    expect(doc.status).toBe('skipped');
    expect(doc.error).toMatch(/dry run/);
    expect(doc.meta.title).toBe('My Episode Title');
  });

  it('a chapters failure does not hold the episode back', async () => {
    const { svc, doc } = setup({ bs: { putChapters: async () => { throw new Error('boom'); } } });
    await svc.process(doc);
    expect(doc.status).toBe('uploaded');
    expect(doc.buzzsprout.chaptersDone).toBeUndefined();
    expect(doc.buzzsprout.published).toBe(true);
  });

  it('a transient failure is queued again later and counted', async () => {
    const { svc, doc } = setup({ bs: { startUpload: async () => { throw new Error('network'); } } });
    await svc.process(doc);
    expect(doc.status).toBe('queued');
    expect(doc.attempts).toBe(1);
    expect(new Date(doc.nextAttemptAt).getTime()).toBeGreaterThan(Date.now() + 5 * 60_000);
    expect(doc.error).toMatch(/upload: network/);
    expect(doc.buzzsprout.episodeId).toBe(777); // kept, so the retry never creates a second episode
  });

  it('a permanent Buzzsprout error (bad request) fails for good at once', async () => {
    const { svc, doc } = setup({ bs: { createEpisode: async () => { throw new BuzzsproutError('422', 422, 'invalid'); } } });
    await svc.process(doc);
    expect(doc.status).toBe('failed');
    expect(doc.nextAttemptAt).toBeNull();
  });

  it('gives up after the maximum attempts', async () => {
    const { svc, doc } = setup({ ep: { attempts: 3 }, bs: { startUpload: async () => { throw new Error('network'); } } });
    await svc.process(doc);
    expect(doc.status).toBe('failed');
    expect(doc.attempts).toBe(4);
  });

  it('a video that left the catalog is skipped, not retried', async () => {
    const { svc, doc } = setup({ video: null });
    await svc.process(doc);
    expect(doc.status).toBe('skipped');
  });
});
