import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly client: Minio.Client;
  private readonly bucket: string;
  private readonly logger = new Logger(MinioService.name);
  private readonly baseUrl: string;
  private defaultLogoUrl: string | null = null;
  private seededLogos: Array<{ id: string; filename: string; url: string; title: string }> = [];
  private seededUniqueImages: Array<{ id: string; filename: string; url: string; title: string }> = [];

  private readonly publicBaseUrl: string;

  constructor(private readonly config: ConfigService) {
    const endpoint = config.get<string>('minio.endpoint', 'localhost');
    const port = config.get<number>('minio.port', 9000);
    const accessKey = config.get<string>('minio.accessKey', 'minioadmin');
    const secretKey = config.get<string>('minio.secretKey', 'minioadmin');
    const useSSL = config.get<boolean>('minio.useSSL', false);
    this.bucket = config.get<string>('minio.bucket', 'thumbnails');

    this.client = new Minio.Client({
      endPoint: endpoint,
      port: port,
      useSSL: useSSL,
      accessKey: accessKey,
      secretKey: secretKey,
    });

    this.baseUrl = `http${useSSL ? 's' : ''}://${endpoint}:${port}`;
    this.publicBaseUrl = (config.get<string>('MINIO_PUBLIC_URL') || this.baseUrl.replace('://minio:', '://localhost:')).replace(/\/+$/, '');
  }

  async onModuleInit() {
    try {
      await this.ensureBucket();
      await this.syncDefaultLogo();
      await this.syncUniqueImages();
    } catch (error: any) {
      if (error.message?.includes('EAI_AGAIN') || error.message?.includes('getaddrinfo')) {
        this.logger.warn(`MinIO DNS resolution failed (likely running outside Docker). Local asset fallback will be used.`);
      } else {
        this.logger.warn(`MinIO startup initialization warning: ${error.message}`);
      }
    }
  }

  async syncDefaultLogo(): Promise<string | null> {
    const logoDir = path.join(process.cwd(), 'src', 'assets', 'logo');
    this.seededLogos = [];

    if (fs.existsSync(logoDir)) {
      const files = fs.readdirSync(logoDir);
      for (const file of files) {
        if (/\.(png|jpg|jpeg|svg|webp)$/i.test(file)) {
          const filePath = path.join(logoDir, file);
          try {
            const logoBuffer = fs.readFileSync(filePath);
            const ext = path.extname(file).toLowerCase();
            const contentType = ext === '.png' ? 'image/png' : ext === '.svg' ? 'image/svg+xml' : 'image/jpeg';
            const minioKey = `system/assets/logo/${file}`;
            const url = await this.uploadBuffer(minioKey, logoBuffer, contentType);
            if (!this.defaultLogoUrl) this.defaultLogoUrl = url;

            const logoObj = {
              id: file,
              filename: file,
              url,
              title: file.replace(/[-_]/g, ' ').replace(/\.[^/.]+$/, '').toUpperCase(),
            };
            this.seededLogos.push(logoObj);
            this.logger.log(`Synced logo asset to MinIO: ${url}`);
          } catch (error: any) {
            this.logger.warn(`Failed to upload logo asset ${file} to MinIO: ${error.message}`);
          }
        }
      }
    }
    return this.defaultLogoUrl;
  }

  async syncUniqueImages(): Promise<Array<{ id: string; filename: string; url: string; title: string }>> {
    const uniqueDir = path.join(process.cwd(), 'src', 'assets', 'unique_images');
    this.seededUniqueImages = [];

    if (fs.existsSync(uniqueDir)) {
      const files = fs.readdirSync(uniqueDir).sort((a, b) => {
        const numA = parseInt(a.replace(/\D/g, '') || '0', 10);
        const numB = parseInt(b.replace(/\D/g, '') || '0', 10);
        return numA - numB;
      });

      for (const file of files) {
        if (/\.(png|jpg|jpeg|webp)$/i.test(file)) {
          const filePath = path.join(uniqueDir, file);
          try {
            const imageBuffer = fs.readFileSync(filePath);
            const ext = path.extname(file).toLowerCase();
            const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';
            const minioKey = `system/assets/unique_images/${file}`;
            const url = await this.uploadBuffer(minioKey, imageBuffer, contentType);

            const hostObj = {
              id: file,
              filename: file,
              url,
              title: `Host Photo ${file.replace(/\.[^/.]+$/, '').replace('host_', '#')}`,
            };
            this.seededUniqueImages.push(hostObj);
            this.logger.log(`Synced unique host asset to MinIO: ${url}`);
          } catch (error: any) {
            this.logger.warn(`Failed to upload unique host image ${file} to MinIO: ${error.message}`);
          }
        }
      }
    }
    return this.seededUniqueImages;
  }

  getDefaultLogoUrl(): string | null {
    return this.defaultLogoUrl;
  }

  getSeededLogos() {
    return this.seededLogos;
  }

  getSeededUniqueImages() {
    return this.seededUniqueImages;
  }

  async ensureBucket(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket, 'us-east-1');
      this.logger.log(`Bucket "${this.bucket}" created`);
    }

    // Always enforce public read policy on bucket
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${this.bucket}/*`],
        },
      ],
    };

    try {
      await this.client.setBucketPolicy(this.bucket, JSON.stringify(policy));
    } catch (e: any) {
      this.logger.warn(`Could not set bucket policy on "${this.bucket}": ${e.message}`);
    }
  }

  async uploadBuffer(
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    await this.ensureBucket();

    // Prevent duplicate bucket prefix in key
    const cleanKey = key.startsWith(`${this.bucket}/`)
      ? key.substring(this.bucket.length + 1)
      : key;

    const metadata: Minio.ItemBucketMetadata = {
      'Content-Type': contentType,
    };

    await this.client.putObject(
      this.bucket,
      cleanKey,
      buffer,
      buffer.length,
      metadata,
    );

    const url = `${this.publicBaseUrl}/api/assets/minio/${cleanKey}`;
    this.logger.log(`Uploaded file: ${cleanKey} -> ${url}`);
    return url;
  }

  async uploadThumbnail(
    channelId: string,
    filename: string,
    buffer: Buffer,
  ): Promise<string> {
    const key = `${channelId}/${Date.now()}_${filename}`;
    return this.uploadBuffer(key, buffer, 'image/png');
  }

  async deleteFile(key: string): Promise<void> {
    const cleanKey = key.startsWith(`${this.bucket}/`)
      ? key.substring(this.bucket.length + 1)
      : key;
    await this.client.removeObject(this.bucket, cleanKey);
    this.logger.log(`Deleted file: ${cleanKey}`);
  }

  async getFileBuffer(key: string): Promise<Buffer> {
    await this.ensureBucket();
    const cleanKey = key.startsWith(`${this.bucket}/`)
      ? key.substring(this.bucket.length + 1)
      : key;
    const stream = await this.client.getObject(this.bucket, cleanKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  getFileUrl(key: string): string {
    const cleanKey = key.startsWith(`${this.bucket}/`)
      ? key.substring(this.bucket.length + 1)
      : key;
    return `${this.publicBaseUrl}/${this.bucket}/${cleanKey}`;
  }

  async getFileStream(objectKey: string): Promise<NodeJS.ReadableStream> {
    await this.ensureBucket();
    if (!objectKey) {
      throw new Error('MinIO object key is required');
    }
    const cleanKey = objectKey.startsWith(`${this.bucket}/`)
      ? objectKey.substring(this.bucket.length + 1)
      : objectKey;
    return this.client.getObject(this.bucket, cleanKey);
  }

  async getPresignedUrl(key: string, expirySeconds = 3600): Promise<string> {
    return this.client.presignedGetObject(this.bucket, key, expirySeconds);
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.bucketExists(this.bucket);
      return true;
    } catch {
      return false;
    }
  }
}
