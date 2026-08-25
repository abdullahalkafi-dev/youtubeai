import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Video, VideoDocument } from '../mongo/schemas/video.schema';
import { SeoVersion, SeoVersionDocument } from '../mongo/schemas/seo-version.schema';
import { YoutubeAnalyticsService } from '../youtube/youtube-analytics.service';
import { YouTubeService } from '../youtube/youtube.service';
import { ChromaService } from '../chroma/chroma.service';
import { MinioService } from '../minio/minio.service';
import { VideoQueryDto, UpdateVideoDto } from './dto/video-query.dto';
import { leanDoc, leanDocs } from '../common/utils/lean';

@Injectable()
export class VideosService {
  private readonly logger = new Logger(VideosService.name);

  constructor(
    @InjectModel(Video.name) private readonly videoModel: Model<VideoDocument>,
    @InjectModel(SeoVersion.name) private readonly seoVersionModel: Model<SeoVersionDocument>,
    private readonly youtubeAnalyticsService: YoutubeAnalyticsService,
    private readonly youtubeService: YouTubeService,
    private readonly chromaService: ChromaService,
    private readonly minioService: MinioService,
  ) {}

  async findAll(channelId: string, query: VideoQueryDto) {
    const { search, status, sort, page = 1, limit = 10 } = query;

    const filter: any = { channelId: new Types.ObjectId(channelId) };
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { title: { $regex: escaped, $options: 'i' } },
        { description: { $regex: escaped, $options: 'i' } },
      ];
    }
    // Handle deleted video filter and SEO status filter
    if (status === 'deleted') {
      filter.deletedFromYoutube = true;
    } else if (status === 'not_started') {
      filter.seoStatus = { $in: ['not_started', null] };
      filter.deletedFromYoutube = { $ne: true };
    } else if (status && status !== 'all') {
      // SEO status values filter on seoStatus field, not status field
      if (['optimized', 'pending', 'processing', 'approved'].includes(status)) {
        filter.seoStatus = status;
      } else {
        filter.status = status;
      }
      filter.deletedFromYoutube = { $ne: true };
    } else {
      filter.deletedFromYoutube = { $ne: true };
    }

    const sortObj: any =
      sort === 'oldest' ? { publishedAt: 1 } :
      sort === 'views' ? { viewCount: -1 } :
      sort === 'revenue' ? { estimatedRevenue: -1 } :
      { publishedAt: -1 };

    const [items, total] = await Promise.all([
      this.videoModel
        .find(filter)
        .select('_id youtubeId title description thumbnailUrl publishedAt viewCount likeCount commentCount seoStatus duration youtubeTitle deletedFromYoutube privacyStatus videoUrl channelId tags')
        .sort(sortObj)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.videoModel.countDocuments(filter),
    ]);

    return { items: leanDocs(items), total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findById(id: string) {
    const video = await this.videoModel.findById(new Types.ObjectId(id)).lean();
    if (!video) throw new NotFoundException(`Video ${id} not found`);
    return leanDoc(video);
  }

  async update(id: string, dto: UpdateVideoDto) {
    await this.findById(id);
    const updatePayload = {
      ...dto,
      lastManualModifiedAt: new Date(),
      optimizationSource: 'dashboard_single_video',
    };
    const updated = await this.videoModel.findByIdAndUpdate(new Types.ObjectId(id), { $set: updatePayload }, { new: true }).lean();
    // Re-embed in ChromaDB if title, description, or tags changed
    if (updated && (dto.title || dto.description || dto.tags)) {
      try {
        await this.chromaService.upsert('video_metadata', id,
          `Title: ${updated.title}\nDescription: ${(updated.description || '').slice(0, 500)}\nTags: ${(updated.tags || []).join(', ')}`,
          { channelId: updated.channelId.toString(), viewCount: updated.viewCount, title: updated.title });
      } catch { /* RAG optional */ }
    }
    return leanDoc(updated);
  }

  async remove(id: string) {
    await this.findById(id);
    const removed = await this.videoModel.findByIdAndDelete(new Types.ObjectId(id)).lean();
    // Clean up ChromaDB
    try {
      await this.chromaService.delete('video_metadata', id);
    } catch { /* RAG optional */ }
    return leanDoc(removed);
  }

  async getChannelStats(channelId: string) {
    const stats = await this.videoModel.aggregate([
      { $match: { channelId: new Types.ObjectId(channelId), deletedFromYoutube: { $ne: true } } },
      {
        $group: {
          _id: null,
          totalVideos: { $sum: 1 },
          totalViews: { $sum: '$viewCount' },
          totalLikes: { $sum: '$likeCount' },
          totalRevenue: { $sum: '$estimatedRevenue' },
          avgCtr: { $avg: '$ctr' },
          avgWatchTime: { $avg: '$avgWatchTime' },
          avgRetention: { $avg: '$retentionPercent' },
        },
      },
    ]);

    const s = stats[0] || {};
    return {
      totalVideos: s.totalVideos || 0,
      totalViews: s.totalViews || 0,
      totalLikes: s.totalLikes || 0,
      totalRevenue: s.totalRevenue || 0,
      avgCtr: s.avgCtr || 0,
      avgWatchTime: s.avgWatchTime || 0,
      avgRetention: s.avgRetention || 0,
    };
  }

  async fetchVideoAnalytics(videoId: string, userId: string) {
    const video = await this.videoModel.findById(new Types.ObjectId(videoId)).lean();
    if (!video) throw new NotFoundException(`Video ${videoId} not found`);

    const channelModel = this.videoModel.db.model('Channel') as any;
    const channel = await channelModel.findById(video.channelId).lean();
    if (!channel?.youtubeChannelId) throw new NotFoundException('Channel has no YouTube ID');

    const analytics = await this.youtubeAnalyticsService.getSingleVideoAnalytics(userId, channel.youtubeChannelId, video.youtubeId);
    if (!analytics) return null;

    const updated = await this.videoModel.findByIdAndUpdate(new Types.ObjectId(videoId), {
      $set: {
        avgWatchTime: analytics.averageViewDuration,
        retentionPercent: analytics.averageViewPercentage,
        estimatedRevenue: analytics.estimatedRevenue,
        lastAnalyticsSync: new Date(),
      },
    }, { new: true }).lean();
    return leanDoc(updated);
  }

  async getDriftedVideos(channelId: string, limit = 100) {
    const candidates = await this.videoModel.find({
      channelId: new Types.ObjectId(channelId),
      deletedFromYoutube: { $ne: true },
      youtubeTitle: { $exists: true, $ne: null },
    })
      .select('title description tags youtubeTitle youtubeDescription youtubeTags youtubeId thumbnailUrl seoStatus')
      .lean();

    const drifted = candidates
      .map(v => {
        const hasTitleDrift = Boolean(v.youtubeTitle && v.title !== v.youtubeTitle);
        const hasDescriptionDrift = Boolean(v.youtubeDescription !== undefined && (v.description || '') !== (v.youtubeDescription || ''));
        const hasTagsDrift = Boolean(v.youtubeTags && JSON.stringify(v.tags || []) !== JSON.stringify(v.youtubeTags || []));

        return {
          id: v._id.toString(),
          title: v.title,
          youtubeTitle: v.youtubeTitle,
          youtubeDescription: v.youtubeDescription,
          youtubeTags: v.youtubeTags,
          youtubeId: v.youtubeId,
          thumbnailUrl: v.thumbnailUrl,
          seoStatus: v.seoStatus,
          hasTitleDrift,
          hasDescriptionDrift,
          hasTagsDrift,
        };
      })
      .filter(item => item.hasTitleDrift || item.hasDescriptionDrift || item.hasTagsDrift);

    return drifted.slice(0, limit);
  }

  async pullFromYoutube(videoId: string) {
    const video = await this.videoModel.findById(new Types.ObjectId(videoId));
    if (!video) throw new NotFoundException(`Video ${videoId} not found`);
    if (!video.youtubeTitle) throw new NotFoundException('No YouTube data available for this video yet. Run a sync first.');

    // Save current state as version BEFORE overwriting
    const currentSeo = video.currentSeo || {
      title: video.title,
      description: video.description || '',
      tags: video.tags || [],
      hashtags: [],
    };

    await this.seoVersionModel.create({
      videoId: video._id,
      type: video.seoStatus === 'approved' ? 'ai_optimized' : 'original',
      approved: video.seoStatus === 'approved',
      source: 'dashboard_single_video',
      seo: currentSeo,
      note: 'Before pulling from YouTube — DB had different title',
    });

    // Pull from YouTube
    await this.videoModel.findByIdAndUpdate(video._id, {
      $set: {
        title: video.youtubeTitle,
        description: video.youtubeDescription || video.description,
        tags: video.youtubeTags || video.tags,
        currentSeo: null,
        suggestedSeo: null,
        seoStatus: 'not_started',
        lastManualModifiedAt: new Date(),
        optimizationSource: 'dashboard_single_video',
      },
    });

    // Re-embed in ChromaDB
    try {
      await this.chromaService.upsert('video_metadata', video._id.toString(),
        `Title: ${video.youtubeTitle}\nDescription: ${(video.youtubeDescription || '').slice(0, 500)}\nTags: ${(video.youtubeTags || []).join(', ')}`,
        { channelId: video.channelId.toString(), viewCount: video.viewCount, title: video.youtubeTitle });
    } catch { /* RAG optional */ }

    return this.videoModel.findById(video._id).lean();
  }

  async pushToYoutube(videoId: string, userId: string) {
    const video = await this.videoModel.findById(new Types.ObjectId(videoId));
    if (!video) throw new NotFoundException(`Video ${videoId} not found`);
    if (video.deletedFromYoutube) throw new NotFoundException('Cannot push to a video deleted from YouTube');

    const channelModel = this.videoModel.db.model('Channel') as any;
    const channel = await channelModel.findById(video.channelId).lean();
    if (!channel) throw new NotFoundException('Channel not found');

    // Save version BEFORE pushing
    const currentSeo = video.currentSeo || {
      title: video.title,
      description: video.description || '',
      tags: video.tags || [],
      hashtags: [],
    };

    await this.seoVersionModel.create({
      videoId: video._id,
      type: video.seoStatus === 'approved' ? 'ai_optimized' : 'original',
      approved: video.seoStatus === 'approved',
      source: 'dashboard_single_video',
      seo: currentSeo,
      note: 'Before pushing DB state to YouTube',
    });

    // Push to YouTube
    const accessToken = await this.youtubeService.getValidAccessToken(userId);
    try {
      await this.youtubeService.updateVideo(accessToken, video.youtubeId, video.title, video.description || '', video.tags || []);

      // Also upload custom thumbnail if set and not already a standard YouTube CDN URL
      if (video.thumbnailUrl && !video.thumbnailUrl.includes('ytimg.com')) {
        try {
          const imageBuffer = await this.getImageBuffer(video.thumbnailUrl);
          await this.youtubeService.setThumbnail(accessToken, video.youtubeId, imageBuffer);
          this.logger.log(`Uploaded custom thumbnail to YouTube for ${video.youtubeId}`);
        } catch (e: any) {
          this.logger.warn(`Could not push thumbnail to YouTube for ${video.youtubeId}: ${e.message}`);
        }
      }

      // Update youtubeTitle to match — only after successful push
      await this.videoModel.findByIdAndUpdate(video._id, {
        $set: {
          youtubeTitle: video.title,
          youtubeDescription: video.description,
          youtubeTags: video.tags,
          lastManualModifiedAt: new Date(),
          optimizationSource: 'dashboard_single_video',
        },
      });
      // Re-embed in ChromaDB
      try {
        await this.chromaService.upsert('video_metadata', video._id.toString(),
          `Title: ${video.title}\nDescription: ${(video.description || '').slice(0, 500)}\nTags: ${(video.tags || []).join(', ')}`,
          { channelId: video.channelId.toString(), viewCount: video.viewCount, title: video.title });
      } catch { /* RAG optional */ }
    } catch (error) {
      this.logger.warn(`Push to YouTube failed for ${video.youtubeId}: ${error.message}`);
      throw error;
    }

    return this.videoModel.findById(video._id).lean();
  }

  async setThumbnail(id: string, thumbnailUrl: string, userId: string) {
    const video = await this.videoModel.findById(new Types.ObjectId(id));
    if (!video) throw new NotFoundException(`Video ${id} not found`);

    let youtubeUploaded = false;
    let youtubeThumbnailUrl: string | null | undefined;

    // 1. Fetch image buffer from MinIO / URL
    const imageBuffer = await this.getImageBuffer(thumbnailUrl);

    // 2. If video is synced from YouTube and not deleted, upload directly to YouTube Data API
    if (video.youtubeId && !video.deletedFromYoutube) {
      try {
        const accessToken = await this.youtubeService.getValidAccessToken(userId);
        const result = await this.youtubeService.setThumbnail(accessToken, video.youtubeId, imageBuffer);
        youtubeUploaded = true;
        youtubeThumbnailUrl = result.url;
        this.logger.log(`✅ Successfully uploaded thumbnail to YouTube video ${video.youtubeId}`);
      } catch (error: any) {
        this.logger.error(`❌ Failed to upload thumbnail to YouTube for video ${video.youtubeId}: ${error.message}`);
        throw new Error(`Failed to upload thumbnail to YouTube: ${error.message}`);
      }
    }

    // 3. Update MongoDB video record
    const updated = await this.videoModel.findByIdAndUpdate(
      new Types.ObjectId(id),
      { $set: { thumbnailUrl } },
      { new: true },
    ).lean();

    return {
      ...leanDoc(updated),
      youtubeUploaded,
      youtubeThumbnailUrl,
    };
  }

  private async getImageBuffer(url: string): Promise<Buffer> {
    if (!url) throw new Error('Thumbnail URL is required');

    if (url.startsWith('data:')) {
      const base64Data = url.split(',')[1];
      return Buffer.from(base64Data, 'base64');
    }

    // Try extracting key from MinIO URLs
    const minioPatterns = ['/thumbnails/', '/api/assets/minio/'];
    for (const pattern of minioPatterns) {
      if (url.includes(pattern)) {
        const key = url.split(pattern)[1]?.split('?')[0];
        if (key) {
          try {
            const stream = await this.minioService.getFileStream(key);
            const chunks: Buffer[] = [];
            for await (const chunk of stream) {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            if (chunks.length > 0) {
              return Buffer.concat(chunks);
            }
          } catch (e) {
            this.logger.warn(`Failed to read from MinIO directly: ${e.message}`);
          }
        }
      }
    }

    // Direct HTTP fetch (support localhost or remote)
    const fetchUrl = url.startsWith('/') ? `http://localhost:5001${url}` : url;
    const response = await fetch(fetchUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch thumbnail image (${response.statusText})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
