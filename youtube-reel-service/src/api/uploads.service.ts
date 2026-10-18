import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import type { Readable } from 'stream';
import { AppConfig, CONFIG } from '../config/config';
import { ReelUpload, ReelUploadDocument } from '../db/schemas/reel-upload.schema';
import { ReelSource, ReelSourceDocument } from '../db/schemas/reel-source.schema';
import { ensureDir, freeDiskGb } from '../pipeline/media';
import { QueueService } from '../queue/queue.service';

export const UPLOAD_PART_SIZE = 16 * 1024 * 1024; // under nginx's 100 MB body limit; small enough to retry cheaply
export const UPLOAD_MAX_BYTES = 40 * 1024 ** 3;
const ALLOWED = /\.(mp4|mov|m4v|mkv|webm|avi|mxf|mts|m2ts)$/i;

/** Resumable raw-video uploads: the browser sends fixed-size parts (any order, retries welcome); we write them in place. */
@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @InjectModel(ReelUpload.name) private readonly uploads: Model<ReelUploadDocument>,
    @InjectModel(ReelSource.name) private readonly sources: Model<ReelSourceDocument>,
    private readonly queues: QueueService,
  ) {}

  /** Start, or resume the same file (same channel, name and size) if it is still uploading. */
  async start(channelId: string, userId: string, input: { fileName: string; size: number; title?: string }) {
    const fileName = path.basename(input.fileName).slice(0, 200);
    if (!ALLOWED.test(fileName)) throw new BadRequestException('Please upload a video file (mp4, mov, mkv, webm, avi, mxf, mts).');
    if (!Number.isFinite(input.size) || input.size < 1024 * 1024) throw new BadRequestException('This file looks empty or too small.');
    if (input.size > UPLOAD_MAX_BYTES) throw new BadRequestException(`The file is too big (max ${UPLOAD_MAX_BYTES / 1024 ** 3} GB).`);

    const existing = await this.uploads.findOne({ channelId, fileName, size: input.size, status: 'uploading' }).sort({ createdAt: -1 });
    if (existing && fs.existsSync(existing.rawPath)) return this.out(existing);

    // Room for the raw file plus its 1080p working copy, above the safety floor.
    const needGb = (input.size * 1.15) / 1024 ** 3 + 2;
    const freeGb = freeDiskGb(this.cfg.REEL_WORK_DIR) - this.cfg.REEL_MIN_FREE_DISK_GB;
    if (needGb > freeGb) throw new ConflictException(`Not enough space on the server for this file right now (needs ${Math.ceil(needGb)} GB, ${Math.max(0, Math.floor(freeGb))} GB free). Ask the developer to free space.`);

    const _id = new Types.ObjectId();
    const dir = ensureDir(path.join(this.cfg.REEL_WORK_DIR, 'uploads', String(_id)));
    const rawPath = path.join(dir, `raw${path.extname(fileName).toLowerCase()}`);
    fs.closeSync(fs.openSync(rawPath, 'w'));
    const doc = await this.uploads.create({
      _id,
      channelId: new Types.ObjectId(channelId),
      userId: new Types.ObjectId(userId),
      fileName,
      size: input.size,
      partSize: UPLOAD_PART_SIZE,
      parts: Math.ceil(input.size / UPLOAD_PART_SIZE),
      title: (input.title?.trim() || fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')).slice(0, 150),
      sourceId: `up_${_id}`,
      rawPath,
    });
    this.logger.log(`Upload ${_id} started: ${fileName} (${(input.size / 1e9).toFixed(2)} GB)`);
    return this.out(doc);
  }

  /** Write one part at its offset. Re-sending a part is harmless. */
  async writePart(channelId: string, uploadId: string, n: number, body: Readable) {
    const up = await this.load(channelId, uploadId);
    if (up.status !== 'uploading') throw new ConflictException('This upload is not accepting data any more.');
    if (!Number.isInteger(n) || n < 0 || n >= up.parts) throw new BadRequestException('Bad part number');
    if (!fs.existsSync(up.rawPath)) throw new ConflictException('This upload expired. Please start again.');
    const expected = n === up.parts - 1 ? up.size - n * up.partSize : up.partSize;

    let written = 0;
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(up.rawPath, { flags: 'r+', start: n * up.partSize });
      body.on('data', (chunk: Buffer) => {
        written += chunk.length;
        if (written > expected) {
          body.destroy();
          out.destroy();
          reject(new BadRequestException('Part is larger than expected'));
        }
      });
      body.on('error', reject);
      body.on('aborted', () => {
        out.destroy();
        reject(new BadRequestException('Connection dropped while sending this part'));
      });
      out.on('error', reject);
      out.on('finish', resolve);
      body.pipe(out);
    });
    if (written !== expected) throw new BadRequestException(`Part ${n} was cut off (${written} of ${expected} bytes). It will be re-sent.`);
    await this.uploads.updateOne({ _id: up._id }, { $addToSet: { received: n } });
    return { ok: true, part: n };
  }

  /** All parts in → becomes a reel source and its processing starts right away. */
  async complete(channelId: string, uploadId: string) {
    const up = await this.load(channelId, uploadId);
    if (up.status === 'uploaded') return up;
    if (up.status !== 'uploading') throw new ConflictException('This upload was cancelled or expired.');
    const missing = up.parts - new Set(up.received).size;
    if (missing > 0) throw new ConflictException(`${missing} part(s) are still missing.`);
    const stat = fs.statSync(up.rawPath);
    if (stat.size !== up.size) throw new ConflictException('The uploaded file size does not match. Please upload again.');

    await this.sources.updateOne(
      { youtubeId: up.sourceId },
      { $setOnInsert: { youtubeId: up.sourceId, kind: 'upload', videoId: up._id, channelId: up.channelId, title: up.title, rawPath: up.rawPath, stage: 'queued' } },
      { upsert: true },
    );
    const done = await this.uploads.findOneAndUpdate({ _id: up._id, status: 'uploading' }, { $set: { status: 'uploaded', completedAt: new Date() } }, { new: true });
    await this.queues.download(up.sourceId); // routed to the ingest queue (never waits on YouTube)
    this.logger.log(`Upload ${up._id} complete; preparing ${up.sourceId}`);
    return done ?? up;
  }

  async cancel(channelId: string, uploadId: string) {
    const up = await this.load(channelId, uploadId);
    if (up.status !== 'uploading') throw new ConflictException('Only an unfinished upload can be cancelled.');
    await this.uploads.updateOne({ _id: up._id }, { $set: { status: 'cancelled', rawDeletedAt: new Date() } });
    fs.rmSync(path.dirname(up.rawPath), { recursive: true, force: true });
    return { ok: true };
  }

  async attachCampaign(uploadId: Types.ObjectId | string, campaignId: Types.ObjectId) {
    await this.uploads.updateOne({ _id: uploadId }, { $set: { campaignId } });
  }

  async load(channelId: string, uploadId: string) {
    if (!Types.ObjectId.isValid(uploadId)) throw new NotFoundException('Upload not found');
    const up = await this.uploads.findOne({ _id: uploadId, channelId });
    if (!up) throw new NotFoundException('Upload not found');
    return up;
  }

  out(u: ReelUploadDocument | ReelUpload & { _id: unknown }) {
    return {
      id: String(u._id),
      fileName: u.fileName,
      title: u.title,
      size: u.size,
      partSize: u.partSize,
      parts: u.parts,
      received: [...new Set(u.received)].sort((a, b) => a - b),
      status: u.status,
      sourceId: u.sourceId,
    };
  }
}
