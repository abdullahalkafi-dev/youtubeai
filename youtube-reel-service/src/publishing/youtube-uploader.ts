import * as fs from 'fs';
import { PublishError } from './types';
import type { YouTubeInsertBody } from './youtube-metadata';

const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';
const CHUNK_ALIGN = 256 * 1024; // resumable chunks must be multiples of 256 KiB (except the last)
const MAX_CHUNK_RETRIES = 5;

/** Turn a Google API error response into a typed error the publish flow can act on. */
export function classifyYouTubeError(status: number, body: any): PublishError {
  const err = body?.error;
  const reason: string = err?.errors?.[0]?.reason ?? (typeof err?.status === 'string' ? err.status : '') ?? '';
  const message: string = err?.message ?? `YouTube returned HTTP ${status}`;

  if (status === 401 || ['authError', 'unauthorized', 'invalidCredentials', 'UNAUTHENTICATED'].includes(reason)) {
    return new PublishError('auth', 'YouTube rejected the login. Reconnect Google in the app.', reason || 'unauthorized', status);
  }
  if (['insufficientPermissions', 'PERMISSION_DENIED', 'forbidden'].includes(reason) && /permission|scope|insufficient/i.test(message)) {
    return new PublishError('auth', 'The Google login does not allow uploading. Reconnect Google in the app.', reason, status);
  }
  if (['quotaExceeded', 'dailyLimitExceeded'].includes(reason)) {
    return new PublishError('quota', 'YouTube\'s daily upload quota for this project is used up. It resets at midnight Pacific time.', reason, status);
  }
  if (reason === 'uploadLimitExceeded') {
    return new PublishError('channel_limit', 'This YouTube channel hit its daily upload limit. Try again tomorrow.', reason, status);
  }
  if (reason === 'youtubeSignupRequired') {
    return new PublishError('fatal', 'This Google account has no YouTube channel set up.', reason, status);
  }
  if (reason === 'mediaBodyRequired' || reason === 'unsupportedMediaType' || reason === 'badContent' || reason === 'invalidFilename') {
    return new PublishError('media', `YouTube rejected the video file: ${message}`, reason, status);
  }
  if (reason.startsWith('invalid') || reason.startsWith('forbiddenPrivacy') || reason === 'defaultLanguageNotSet') {
    return new PublishError('invalid_metadata', message, reason, status);
  }
  if (status >= 500 || status === 408 || status === 429 || ['rateLimitExceeded', 'userRateLimitExceeded', 'backendError', 'internalError', 'serviceUnavailable'].includes(reason)) {
    return new PublishError('transient', message, reason || String(status), status);
  }
  return new PublishError('fatal', message, reason || String(status), status);
}

export interface UploadOptions {
  body: YouTubeInsertBody;
  notifySubscribers: boolean;
  filePath: string;
  fileSize: number;
  /** Existing session to continue (after a retry, crash or restart). */
  sessionUri?: string | null;
  getToken: () => Promise<string>;
  /** Mint a fresh token after a 401. */
  refreshToken: () => Promise<string>;
  saveSession: (uri: string | null, bytesUploaded: number) => Promise<void>;
  shouldCancel: () => Promise<boolean>;
}

export interface UploadResult {
  id: string;
  resource: any;
  sessionUri: string;
}

type Status = { kind: 'done'; resource: any } | { kind: 'partial'; offset: number } | { kind: 'expired' };

/**
 * Resumable upload for `videos.insert` without any SDK:
 *   initiate (metadata + file facts) → session URI → PUT chunks with Content-Range → 200/201 with the video.
 * The session URI and acknowledged offset are persisted after every chunk. On any retry the uploader first asks
 * YouTube how much it already has (a status query with an empty body and a "bytes star-slash-total" Content-Range),
 * so it continues, or recognises a finished upload and returns the video id instead of uploading the file twice.
 */
export class YouTubeUploader {
  fetchFn: typeof fetch = (input, init) => fetch(input, init);
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));
  private readonly chunkBytes: number;

  constructor(chunkMb = 8) {
    this.chunkBytes = Math.max(1, Math.floor((chunkMb * 1024 * 1024) / CHUNK_ALIGN)) * CHUNK_ALIGN;
  }

  async upload(o: UploadOptions): Promise<UploadResult> {
    if (o.fileSize <= 0) throw new PublishError('media', 'The reel file is empty');
    let session = o.sessionUri ?? null;
    let offset = 0;

    if (session) {
      const st = await this.queryStatus(session, o);
      if (st.kind === 'done') return this.result(st.resource, session);
      if (st.kind === 'partial') offset = st.offset;
      else session = null; // session expired (they last about a week): start over
    }
    if (!session) {
      session = await this.initiate(o);
      offset = 0;
      await o.saveSession(session, 0);
    }
    return this.sendChunks(session, offset, o);
  }

  private result(resource: any, sessionUri: string): UploadResult {
    if (!resource?.id) throw new PublishError('fatal', 'YouTube finished the upload but returned no video id');
    return { id: String(resource.id), resource, sessionUri };
  }

  private async initiate(o: UploadOptions): Promise<string> {
    const url = `${UPLOAD_URL}?uploadType=resumable&part=snippet,status&notifySubscribers=${o.notifySubscribers ? 'true' : 'false'}`;
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await this.withAuth(o, async (token) =>
          this.fetchFn(url, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json; charset=UTF-8',
              'X-Upload-Content-Length': String(o.fileSize),
              'X-Upload-Content-Type': 'video/mp4',
            },
            body: JSON.stringify(o.body),
            signal: AbortSignal.timeout(60_000),
          }),
        );
        if (!res.ok) throw classifyYouTubeError(res.status, await res.json().catch(() => ({})));
        const location = res.headers.get('location');
        if (!location) throw new PublishError('fatal', 'YouTube did not return an upload session');
        return location;
      } catch (err) {
        if (err instanceof PublishError && err.kind !== 'transient') throw err;
        if (attempt >= 3) throw err instanceof PublishError ? err : new PublishError('transient', (err as Error).message);
        await this.sleep(backoff(attempt));
      }
    }
  }

  private async sendChunks(session: string, startOffset: number, o: UploadOptions): Promise<UploadResult> {
    const fh = await fs.promises.open(o.filePath, 'r');
    let offset = startOffset;
    let failures = 0;
    try {
      while (offset < o.fileSize) {
        if (await o.shouldCancel()) throw new PublishError('cancelled', 'Cancelled by user');
        const end = Math.min(offset + this.chunkBytes, o.fileSize);
        const buf = Buffer.alloc(end - offset);
        await fh.read(buf, 0, buf.length, offset);

        let res: Response;
        try {
          res = await this.withAuth(o, async (token) =>
            this.fetchFn(session, {
              method: 'PUT',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Length': String(buf.length),
                'Content-Range': `bytes ${offset}-${end - 1}/${o.fileSize}`,
                'Content-Type': 'video/mp4',
              },
              body: buf,
              signal: AbortSignal.timeout(180_000),
            }),
          );
        } catch (err) {
          if (err instanceof PublishError && err.kind !== 'transient') throw err;
          if (++failures > MAX_CHUNK_RETRIES) throw err instanceof PublishError ? err : new PublishError('transient', (err as Error).message);
          await this.sleep(backoff(failures));
          const st = await this.queryStatus(session, o).catch(() => null);
          if (st?.kind === 'done') return this.result(st.resource, session);
          if (st?.kind === 'partial') offset = st.offset;
          if (st?.kind === 'expired') throw new PublishError('transient', 'The upload session expired; it will start over', 'session_expired');
          continue;
        }

        if (res.status === 308) {
          offset = parseRangeEnd(res.headers.get('range'));
          failures = 0;
          await o.saveSession(session, offset);
          continue;
        }
        if (res.status === 200 || res.status === 201) {
          await o.saveSession(session, o.fileSize);
          return this.result(await res.json(), session);
        }
        const error = classifyYouTubeError(res.status, await res.json().catch(() => ({})));
        if (error.kind !== 'transient') throw error;
        if (++failures > MAX_CHUNK_RETRIES) throw error;
        await this.sleep(backoff(failures));
        const st = await this.queryStatus(session, o).catch(() => null);
        if (st?.kind === 'done') return this.result(st.resource, session);
        if (st?.kind === 'partial') offset = st.offset;
      }
      // Every byte acknowledged but no final response seen: ask for the finished resource.
      const st = await this.queryStatus(session, o);
      if (st.kind === 'done') return this.result(st.resource, session);
      throw new PublishError('transient', 'The upload finished sending but YouTube has not confirmed it yet');
    } finally {
      await fh.close();
    }
  }

  /** "How much do you have?" — also how a finished upload is recognised after a crash. */
  async queryStatus(session: string, o: Pick<UploadOptions, 'fileSize' | 'getToken' | 'refreshToken'>): Promise<Status> {
    const res = await this.withAuth(o, async (token) =>
      this.fetchFn(session, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Length': '0', 'Content-Range': `bytes */${o.fileSize}` },
        signal: AbortSignal.timeout(30_000),
      }),
    );
    if (res.status === 308) return { kind: 'partial', offset: parseRangeEnd(res.headers.get('range')) };
    if (res.status === 200 || res.status === 201) return { kind: 'done', resource: await res.json() };
    if (res.status === 404 || res.status === 410) return { kind: 'expired' };
    throw classifyYouTubeError(res.status, await res.json().catch(() => ({})));
  }

  /** Run a request with the current token; on a 401 mint a fresh token and try once more. */
  private async withAuth<T extends Response>(o: Pick<UploadOptions, 'getToken' | 'refreshToken'>, fn: (token: string) => Promise<T>): Promise<T> {
    let res: T;
    try {
      res = await fn(await o.getToken());
    } catch (err) {
      if (err instanceof PublishError) throw err;
      throw new PublishError('transient', `Network error talking to YouTube: ${(err as Error).message}`);
    }
    if (res.status !== 401) return res;
    try {
      return await fn(await o.refreshToken());
    } catch (err) {
      if (err instanceof PublishError) throw err;
      throw new PublishError('transient', `Network error talking to YouTube: ${(err as Error).message}`);
    }
  }
}

/** `Range: bytes=0-8388607` → next offset 8388608. No header means nothing is stored yet. */
export function parseRangeEnd(header: string | null): number {
  const m = /bytes=\d+-(\d+)/.exec(header ?? '');
  return m ? Number(m[1]) + 1 : 0;
}

export function backoff(attempt: number): number {
  const base = Math.min(60_000, 2000 * 2 ** (attempt - 1));
  return base + Math.floor(Math.random() * 500);
}
