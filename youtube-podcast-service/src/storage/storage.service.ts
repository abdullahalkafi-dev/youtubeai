import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as Minio from 'minio';
import { AppConfig, CONFIG } from '../config';

/** The reel service's cache (READ ONLY here) and this service's own bucket. */
export const REEL_SOURCES_BUCKET = 'reel-sources';
export const PODCAST_BUCKET = 'podcast-audio';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  readonly client: Minio.Client;

  constructor(@Inject(CONFIG) cfg: AppConfig) {
    this.client = new Minio.Client({
      endPoint: cfg.MINIO_ENDPOINT,
      port: cfg.MINIO_PORT,
      useSSL: cfg.MINIO_USE_SSL,
      accessKey: cfg.MINIO_ACCESS_KEY,
      secretKey: cfg.MINIO_SECRET_KEY,
    });
  }

  async onModuleInit() {
    try {
      if (!(await this.client.bucketExists(PODCAST_BUCKET))) {
        await this.client.makeBucket(PODCAST_BUCKET);
        this.logger.log(`Created private bucket ${PODCAST_BUCKET}`);
      }
    } catch (err: any) {
      this.logger.error(`Bucket check failed for ${PODCAST_BUCKET}: ${err.message}`);
    }
  }

  async stat(bucket: string, key: string): Promise<Minio.BucketItemStat | null> {
    try {
      return await this.client.statObject(bucket, key);
    } catch {
      return null;
    }
  }

  /** URL ffmpeg can read straight from MinIO (inside the docker network). */
  presignedGet(bucket: string, key: string, expirySec = 6 * 3600): Promise<string> {
    return this.client.presignedGetObject(bucket, key, expirySec);
  }

  putFile(key: string, filePath: string, contentType: string) {
    return this.client.fPutObject(PODCAST_BUCKET, key, filePath, { 'Content-Type': contentType });
  }

  getFile(key: string, filePath: string) {
    return this.client.fGetObject(PODCAST_BUCKET, key, filePath);
  }
}
