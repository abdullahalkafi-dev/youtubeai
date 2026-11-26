import * as fs from 'fs';
import * as https from 'https';
import { URL } from 'url';

const BASE = 'https://www.buzzsprout.com/api';
const USER_AGENT = 'UMA-Podcast-Publisher/1.0';

export class BuzzsproutError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'BuzzsproutError';
  }
  /** Retrying the same request cannot help (bad token, validation error, missing episode). */
  get permanent() {
    return this.status >= 400 && this.status < 500 && this.status !== 429 && this.status !== 408;
  }
}

export interface BuzzsproutEpisode {
  id: number;
  title: string;
  audio_url: string | null;
  media_type: string;
  description: string;
  duration: number;
  private: boolean;
  published_at: string | null;
  guid?: string;
  tags?: string;
  total_downloads?: number;
}

export interface UploadStart {
  id: string;
  upload_url: string;
  multipart?: boolean;
}

export interface BuzzsproutOptions {
  apiKey: string;
  podcastId: string;
  /** Test hooks. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Thin client for the parts of the Buzzsprout API this service needs. Retries 429 and 5xx with back-off; 4xx (other than 429) are permanent. */
export class BuzzsproutClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;

  constructor(private readonly opts: BuzzsproutOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? wait;
    this.maxRetries = opts.maxRetries ?? 4;
  }

  private get headers() {
    return {
      Authorization: `Token token=${this.opts.apiKey}`,
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json; charset=utf-8',
    };
  }

  private async call<T>(method: string, path: string, body?: unknown, expect: number[] = [200, 201, 202, 204]): Promise<T> {
    const url = path.startsWith('http') ? path : `${BASE}${path}`;
    let lastErr: BuzzsproutError | Error | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, { method, headers: this.headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        await this.sleep(Math.min(30_000, 1000 * 2 ** attempt));
        continue;
      }
      const text = await res.text();
      if (expect.includes(res.status)) return (text ? JSON.parse(text) : {}) as T;
      const err = new BuzzsproutError(`Buzzsprout ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`, res.status, text);
      if (err.permanent) throw err;
      lastErr = err;
      const retryAfter = Number(res.headers.get('retry-after'));
      await this.sleep(retryAfter > 0 ? Math.min(60_000, retryAfter * 1000) : Math.min(30_000, 2000 * 2 ** attempt));
    }
    throw lastErr ?? new Error('Buzzsprout request failed');
  }

  private ep(path = '') {
    return `/${this.opts.podcastId}${path}`;
  }

  async podcasts(): Promise<Array<{ id: number; title: string; rss_url?: string; artwork_url?: string }>> {
    return this.call('GET', '/podcasts');
  }

  listEpisodes(): Promise<BuzzsproutEpisode[]> {
    return this.call('GET', this.ep('/episodes'));
  }

  getEpisode(id: number): Promise<BuzzsproutEpisode> {
    return this.call('GET', this.ep(`/episodes/${id}`));
  }

  /** Creates an episode WITHOUT audio. Private until `publish`, so a half-finished episode never shows in the feed. */
  createEpisode(input: { title: string; description: string; tags?: string; artist?: string; explicit?: boolean }): Promise<BuzzsproutEpisode> {
    return this.call('POST', this.ep('/episodes'), { ...input, private: true, episode_type: 'full' });
  }

  async startUpload(episodeId: number, file: { filename: string; byteSize: number; type: string }): Promise<UploadStart> {
    const res: any = await this.call('POST', this.ep(`/episodes/${episodeId}/uploads`), { filename: file.filename, byte_size: file.byteSize, type: file.type });
    const up = res.upload ?? res;
    if (!up?.id || !up?.upload_url) throw new Error(`Buzzsprout upload start returned no upload url: ${JSON.stringify(res).slice(0, 200)}`);
    if (up.multipart) throw new Error('Buzzsprout asked for a multipart upload (file too large for this service)');
    return { id: String(up.id), upload_url: up.upload_url, multipart: !!up.multipart };
  }

  /** PUT exactly the file's bytes to the signed URL (no Buzzsprout auth header: the URL carries the signature). */
  putFile(uploadUrl: string, filePath: string, byteSize: number, contentType: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const u = new URL(uploadUrl);
      const req = https.request(
        { method: 'PUT', hostname: u.hostname, port: u.port || 443, path: `${u.pathname}${u.search}`, headers: { 'Content-Type': contentType, 'Content-Length': byteSize, 'User-Agent': USER_AGENT } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if ((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300) resolve();
            else reject(new BuzzsproutError(`Upload PUT -> ${res.statusCode}: ${text.slice(0, 300)}`, res.statusCode ?? 0, text));
          });
        },
      );
      req.setTimeout(30 * 60_000, () => req.destroy(new Error('Upload PUT timed out')));
      req.on('error', reject);
      fs.createReadStream(filePath).on('error', reject).pipe(req);
    });
  }

  completeUpload(episodeId: number, uploadId: string): Promise<BuzzsproutEpisode> {
    return this.call('POST', this.ep(`/episodes/${episodeId}/uploads/${encodeURIComponent(uploadId)}/complete`), {});
  }

  /** Waits until Buzzsprout has processed the audio (duration is -1 until then). */
  async waitProcessed(episodeId: number, timeoutMs = 25 * 60_000, everyMs = 15_000): Promise<BuzzsproutEpisode> {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const ep = await this.getEpisode(episodeId);
      if (typeof ep.duration === 'number' && ep.duration > 0) return ep;
      if (Date.now() > end) throw new Error(`Buzzsprout is still processing episode ${episodeId} after ${Math.round(timeoutMs / 60000)} minutes`);
      await this.sleep(everyMs);
    }
  }

  async putChapters(episodeId: number, chapters: Array<{ title: string; startSec: number }>): Promise<void> {
    const clock = (s: number) => [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
    await this.call('PUT', this.ep(`/episodes/${episodeId}/chapters`), { chapters: chapters.map((c) => ({ title: c.title.slice(0, 200), start_time: clock(c.startSec) })) });
  }

  publish(episodeId: number, publishedAt: Date): Promise<BuzzsproutEpisode> {
    return this.call('PATCH', this.ep(`/episodes/${episodeId}`), { private: false, published_at: publishedAt.toISOString() });
  }
}
