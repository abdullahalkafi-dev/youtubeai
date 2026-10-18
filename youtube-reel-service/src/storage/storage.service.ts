import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as Minio from 'minio';
import { Readable } from 'stream';
import { AppConfig, CONFIG } from '../config/config';

/** Private buckets owned by the reel service. Nothing here is public-read. */
export const BUCKETS = {
  sources: 'reel-sources', // {youtubeId}/source.mp4, {youtubeId}/audio.ogg
  reels: 'reels', // {channelId}/{campaignId}/{reelId}/reel.mp4 ...
  templates: 'reel-templates', // {name}/template.json, {name}/canvas.png
} as const;
export type BucketName = (typeof BUCKETS)[keyof typeof BUCKETS];

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  readonly client: Minio.Client;

  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {
    this.client = new Minio.Client({
      endPoint: cfg.MINIO_ENDPOINT,
      port: cfg.MINIO_PORT,
      useSSL: cfg.MINIO_USE_SSL,
      accessKey: cfg.MINIO_ACCESS_KEY,
      secretKey: cfg.MINIO_SECRET_KEY,
    });
  }

  async onModuleInit() {
    for (const bucket of Object.values(BUCKETS)) {
      try {
        if (!(await this.client.bucketExists(bucket))) {
          await this.client.makeBucket(bucket);
          this.logger.log(`Created private bucket ${bucket}`);
        }
      } catch (err: any) {
        this.logger.error(`Bucket check failed for ${bucket}: ${err.message}`);
      }
    }
  }

  putFile(bucket: BucketName, key: string, filePath: string, contentType: string) {
    return this.client.fPutObject(bucket, key, filePath, { 'Content-Type': contentType });
  }

  putBuffer(bucket: BucketName, key: string, data: Buffer | string, contentType: string) {
    const buf = typeof data === 'string' ? Buffer.from(data) : data;
    return this.client.putObject(bucket, key, buf, buf.length, { 'Content-Type': contentType });
  }

  getFile(bucket: BucketName, key: string, filePath: string) {
    return this.client.fGetObject(bucket, key, filePath);
  }

  async getBuffer(bucket: BucketName, key: string): Promise<Buffer> {
    const stream = await this.client.getObject(bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  /** Read an object from a bucket owned by the main app (e.g. its subject photos). Never writes there. */
  async readShared(bucket: string, key: string): Promise<Buffer> {
    const stream = await this.client.getObject(bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  async stat(bucket: BucketName, key: string): Promise<Minio.BucketItemStat | null> {
    try {
      return await this.client.statObject(bucket, key);
    } catch {
      return null;
    }
  }

  getStream(bucket: BucketName, key: string): Promise<Readable> {
    return this.client.getObject(bucket, key);
  }

  getRange(bucket: BucketName, key: string, offset: number, length: number): Promise<Readable> {
    return this.client.getPartialObject(bucket, key, offset, length);
  }

  /** Presigned GET reachable from inside the docker network (used by ffmpeg for range-seeking). */
  presignedGet(bucket: BucketName, key: string, expirySec = 6 * 3600): Promise<string> {
    return this.client.presignedGetObject(bucket, key, expirySec);
  }

  async remove(bucket: BucketName, key: string) {
    try {
      await this.client.removeObject(bucket, key);
    } catch {
      /* already gone */
    }
  }

  async removePrefix(bucket: BucketName, prefix: string) {
    const keys: string[] = [];
    const stream = this.client.listObjectsV2(bucket, prefix, true);
    for await (const obj of stream) if (obj.name) keys.push(obj.name);
    if (keys.length) await this.client.removeObjects(bucket, keys);
    return keys.length;
  }

  async prefixSize(bucket: BucketName, prefix = ''): Promise<number> {
    let total = 0;
    const stream = this.client.listObjectsV2(bucket, prefix, true);
    for await (const obj of stream) total += obj.size || 0;
    return total;
  }
}
