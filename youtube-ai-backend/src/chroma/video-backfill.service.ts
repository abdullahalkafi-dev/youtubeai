import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Video, VideoDocument } from '../mongo/schemas/video.schema';
import { ChromaService } from './chroma.service';

const BATCH_SIZE = 100;

/**
 * Auto-backfills video_metadata in ChromaDB on first startup.
 * Runs in background — does not block app startup.
 * Skips if video_metadata collection already has documents.
 */
@Injectable()
export class VideoBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(VideoBackfillService.name);

  constructor(
    private readonly chromaService: ChromaService,
    @InjectModel(Video.name) private readonly videoModel: Model<VideoDocument>,
  ) {}

  async onApplicationBootstrap() {
    // Run in background — don't block app startup
    this.backfillIfNeeded().catch((err) => {
      this.logger.error(`Video metadata backfill failed: ${err.message}`);
    });
  }

  private async backfillIfNeeded(): Promise<void> {
    const stats = await this.chromaService.getStats('video_metadata');
    if (stats.count > 0) {
      this.logger.log(
        `video_metadata already has ${stats.count} documents, skipping backfill`,
      );
      return;
    }

    this.logger.log(
      'video_metadata collection empty — starting backfill of all videos...',
    );

    let skip = 0;
    let totalEmbedded = 0;

    while (true) {
      const videos = await this.videoModel
        .find()
        .select('_id title description tags channelId viewCount')
        .skip(skip)
        .limit(BATCH_SIZE)
        .lean();

      if (videos.length === 0) break;

      const ids = videos.map((v) => v._id.toString());
      const texts = videos.map(
        (v) =>
          `Title: ${v.title}\nDescription: ${(v.description || '').slice(0, 500)}\nTags: ${(v.tags || []).join(', ')}`,
      );
      const metadatas = videos.map((v) => ({
        channelId: v.channelId?.toString() || '',
        viewCount: v.viewCount || 0,
        title: v.title,
      }));

      await this.chromaService.upsertBatch(
        'video_metadata',
        ids,
        texts,
        metadatas,
      );

      totalEmbedded += videos.length;
      skip += BATCH_SIZE;

      this.logger.log(
        `Backfill progress: ${totalEmbedded} videos embedded`,
      );
    }

    this.logger.log(
      `Backfill complete: ${totalEmbedded} videos in video_metadata collection`,
    );
  }
}
