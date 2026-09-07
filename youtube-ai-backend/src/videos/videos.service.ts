import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Video, VideoDocument } from '../mongo/schemas/video.schema';
import { SeoVersion, SeoVersionDocument } from '../mongo/schemas/seo-version.schema';
import { YoutubeAnalyticsService } from '../youtube/youtube-analytics.service';
import { YouTubeService } from '../youtube/youtube.service';
import { ChromaService } from '../chroma/chroma.service';
import { MinioService } from '../minio/minio.service';
import { QuotaService } from '../quota/quota.service';
import { VideoQueryDto, UpdateVideoDto } from './dto/video-query.dto';
import { leanDoc, leanDocs } from '../common/utils/lean';
import { MAX_ACTIVE_COMMENT_VIDEOS } from '../automation/automation.constants';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';

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
    private readonly quotaService: QuotaService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
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
      await this.invalidateVideoTimelineCache(id);
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
      await this.quotaService.logCall({
        channelId: video.channelId.toString(),
        endpoint: 'videos.update',
        quotaCost: 51,
        relatedId: video.youtubeId,
        success: true,
      });

      // Also upload custom thumbnail if set and not already a standard YouTube CDN URL
      if (video.thumbnailUrl && !video.thumbnailUrl.includes('ytimg.com')) {
        try {
          const imageBuffer = await this.getImageBuffer(video.thumbnailUrl);
          await this.youtubeService.setThumbnail(accessToken, video.youtubeId, imageBuffer);
          await this.quotaService.logCall({
            channelId: video.channelId.toString(),
            endpoint: 'thumbnails.set',
            quotaCost: 50,
            relatedId: video.youtubeId,
            success: true,
          });
          this.logger.log(`Uploaded custom thumbnail to YouTube for ${video.youtubeId}`);
        } catch (e: any) {
          this.logger.warn(`Could not push thumbnail to YouTube for ${video.youtubeId}: ${e.message}`);
          await this.quotaService.logCall({
            channelId: video.channelId.toString(),
            endpoint: 'thumbnails.set',
            quotaCost: 50,
            relatedId: video.youtubeId,
            success: false,
            errorMessage: e.message,
          }).catch(() => {});
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
      await this.invalidateVideoTimelineCache(video._id.toString());
    } catch (error: any) {
      this.logger.warn(`Push to YouTube failed for ${video.youtubeId}: ${error.message}`);
      await this.quotaService.logCall({
        channelId: video.channelId.toString(),
        endpoint: 'videos.update',
        quotaCost: 51,
        relatedId: video.youtubeId,
        success: false,
        errorMessage: error.message,
      }).catch(() => {});
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
        await this.quotaService.logCall({
          channelId: video.channelId.toString(),
          endpoint: 'thumbnails.set',
          quotaCost: 50,
          relatedId: video.youtubeId,
          success: true,
        });
        youtubeUploaded = true;
        youtubeThumbnailUrl = result.url;
        this.logger.log(`✅ Successfully uploaded thumbnail to YouTube video ${video.youtubeId}`);
      } catch (error: any) {
        this.logger.error(`❌ Failed to upload thumbnail to YouTube for video ${video.youtubeId}: ${error.message}`);
        await this.quotaService.logCall({
          channelId: video.channelId.toString(),
          endpoint: 'thumbnails.set',
          quotaCost: 50,
          relatedId: video.youtubeId,
          success: false,
          errorMessage: error.message,
        }).catch(() => {});
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

    // Direct HTTP fetch (support dynamic port or remote)
    const port = this.configService.get<number>('PORT', 3001);
    const fetchUrl = url.startsWith('/') ? `http://localhost:${port}${url}` : url;
    const response = await fetch(fetchUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch thumbnail image (${response.statusText})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async toggleAutoReply(videoId: string, autoReplyEnabled: boolean) {
    const video = await this.videoModel.findById(new Types.ObjectId(videoId));
    if (!video) throw new NotFoundException(`Video ${videoId} not found`);

    if (autoReplyEnabled) {
      const activeCount = await this.videoModel.countDocuments({
        channelId: video.channelId,
        autoReplyEnabled: true,
        _id: { $ne: video._id },
        deletedFromYoutube: { $ne: true },
      });
      if (activeCount >= MAX_ACTIVE_COMMENT_VIDEOS) {
        throw new BadRequestException(
          `Maximum ${MAX_ACTIVE_COMMENT_VIDEOS} active auto-reply videos reached. Please disable another video first.`,
        );
      }
    }

    const updated = await this.videoModel.findByIdAndUpdate(
      video._id,
      { $set: { autoReplyEnabled } },
      { new: true },
    ).lean();

    return leanDoc(updated);
  }

  async invalidateVideoTimelineCache(videoId: string): Promise<void> {
    try {
      await this.redisService.del(`video:timeline:${videoId}:all`);
      await this.redisService.del(`video:timeline:${videoId}:90d`);
      await this.redisService.del(`video:timeline:${videoId}:30d`);
      this.logger.log(`Invalidated Redis timeline cache for video ${videoId}`);
    } catch (err: any) {
      this.logger.warn(`Failed to invalidate timeline cache for video ${videoId}: ${err?.message || err}`);
    }
  }

  async getVideoPerformanceTimeline(
    videoId: string,
    userId: string,
    forceRefresh = false,
    range = 'all',
  ) {
    if (!videoId || typeof videoId !== 'string') {
      throw new BadRequestException('Video ID is required');
    }

    // Dual-resolution: Supports MongoDB ObjectId, string id, and YouTube Video ID
    const isObjectId = Types.ObjectId.isValid(videoId);
    const video = await this.videoModel.findOne(
      isObjectId ? { _id: new Types.ObjectId(videoId) } : { youtubeId: videoId }
    ).lean();

    if (!video) throw new NotFoundException(`Video ${videoId} not found`);
    if (!video.youtubeId) throw new BadRequestException('Video has no YouTube ID');

    const actualMongoId = video._id.toString();
    const validRange = ['30d', '90d', 'all'].includes(range) ? range : 'all';
    const cacheKey = `video:timeline:${actualMongoId}:${validRange}`;

    // 1. Check Redis cache if not forced refresh
    if (!forceRefresh) {
      try {
        const cached = await this.redisService.getJson<any>(cacheKey);
        if (cached && typeof cached === 'object' && Array.isArray(cached.dailyData)) {
          return { ...cached, fromCache: true };
        }
      } catch (err: any) {
        this.logger.warn(`Redis cache get failed for ${cacheKey}: ${err?.message || err}`);
      }
    }

    const channelModel = this.videoModel.db.model('Channel') as any;
    const channel = await channelModel.findById(video.channelId).lean();
    if (!channel?.youtubeChannelId) {
      throw new NotFoundException('Channel or YouTube Channel ID not found');
    }

    // 3. Fetch All SEO Versions for this video to track multiple iterations (v1, v2, v3, etc.)
    const rawVersions = await this.seoVersionModel
      .find({ videoId: video._id })
      .sort({ createdAt: 1 })
      .lean();

    // Map versions with null-safety
    const versions = (rawVersions || []).map((v, index) => {
      const createdDate = v.createdAt ? new Date(v.createdAt) : null;
      const isValidDate = createdDate && !isNaN(createdDate.getTime());
      const dateStr = isValidDate ? createdDate.toISOString().split('T')[0] : '';
      return {
        id: v._id?.toString() || `ver-${index}`,
        versionIndex: index + 1,
        type: v.type || 'ai_optimized',
        approved: Boolean(v.approved),
        date: dateStr,
        timestamp: isValidDate ? createdDate.getTime() : 0,
        title: v.seo?.title || '',
        note: v.note || (v.type === 'original' ? 'Original YouTube Metadata' : `AI Optimization v${index + 1}`),
      };
    }).filter(v => v.date && v.timestamp > 0);

    // Filter milestones that represent applied optimizations
    const milestones = versions.filter(v => v.type === 'ai_optimized' || v.approved);

    // 4. Calculate Date Range
    const now = new Date();
    const endDate = now.toISOString().split('T')[0];
    let startDate: string;

    if (validRange === '30d') {
      const d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      startDate = d.toISOString().split('T')[0];
    } else if (validRange === '90d') {
      const d = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      startDate = d.toISOString().split('T')[0];
    } else {
      // 'all' range: use publishedAt date, fallback to 90 days ago if missing/invalid
      if (video.publishedAt && !isNaN(new Date(video.publishedAt).getTime())) {
        startDate = new Date(video.publishedAt).toISOString().split('T')[0];
      } else if (milestones.length > 0 && milestones[0].timestamp > 0) {
        // 30 days before earliest version
        const earliest = new Date(milestones[0].timestamp - 30 * 24 * 60 * 60 * 1000);
        startDate = earliest.toISOString().split('T')[0];
      } else {
        const d = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        startDate = d.toISOString().split('T')[0];
      }
    }

    if (startDate > endDate) {
      startDate = endDate;
    }

    // 5. Fetch Daily Time-Series from YouTube Analytics API
    const dailyData = await this.youtubeAnalyticsService.getVideoDailyTimeseries(
      userId,
      channel.youtubeChannelId,
      video.youtubeId,
      startDate,
      endDate,
    );

    // 6. Calculate Phase Statistics (Baseline vs v1 vs v2 vs etc.)
    interface PhaseMetric {
      phaseName: string;
      label: string;
      startDate: string;
      endDate: string;
      totalDays: number;
      totalViews: number;
      avgDailyViews: number;
      liftPercentFromBaseline: number | null;
      liftPercentFromPrevious: number | null;
    }

    const phases: PhaseMetric[] = [];

    if (milestones.length === 0) {
      const totalViews = (dailyData || []).reduce((sum, d) => sum + (Number(d?.views) || 0), 0);
      const totalDays = dailyData?.length || 1;
      const avg = Number((totalViews / totalDays).toFixed(2));
      phases.push({
        phaseName: 'baseline',
        label: 'Original / Unoptimized',
        startDate,
        endDate,
        totalDays,
        totalViews,
        avgDailyViews: isNaN(avg) ? 0 : avg,
        liftPercentFromBaseline: null,
        liftPercentFromPrevious: null,
      });
    } else {
      // Step 1: Baseline phase (before milestones[0].date)
      const firstOptDate = milestones[0].date;
      const baselinePoints = (dailyData || []).filter(d => d?.date && d.date < firstOptDate);
      const bViews = baselinePoints.reduce((sum, d) => sum + (Number(d?.views) || 0), 0);
      const bDays = baselinePoints.length > 0 ? baselinePoints.length : 1;
      const baselineAvg = Number((bViews / bDays).toFixed(2));

      phases.push({
        phaseName: 'baseline',
        label: 'Baseline (Pre-SEO)',
        startDate: baselinePoints[0]?.date || startDate,
        endDate: baselinePoints[baselinePoints.length - 1]?.date || firstOptDate,
        totalDays: baselinePoints.length,
        totalViews: bViews,
        avgDailyViews: isNaN(baselineAvg) ? 0 : baselineAvg,
        liftPercentFromBaseline: 0,
        liftPercentFromPrevious: 0,
      });

      // Step 2: Milestone phases
      let prevAvg = isNaN(baselineAvg) ? 0 : baselineAvg;
      for (let i = 0; i < milestones.length; i++) {
        const curOpt = milestones[i];
        const nextOpt = milestones[i + 1];
        const phaseStart = curOpt.date;
        const phaseEnd = nextOpt ? nextOpt.date : endDate;

        const phasePoints = (dailyData || []).filter(d => {
          if (!d?.date) return false;
          return nextOpt ? d.date >= phaseStart && d.date < phaseEnd : d.date >= phaseStart;
        });

        const pViews = phasePoints.reduce((sum, d) => sum + (Number(d?.views) || 0), 0);
        const pDays = phasePoints.length > 0 ? phasePoints.length : 1;
        const pAvg = Number((pViews / pDays).toFixed(2));

        const liftFromBaseline = baselineAvg > 0
          ? Number((((pAvg - baselineAvg) / baselineAvg) * 100).toFixed(1))
          : pAvg > 0 ? 100 : 0;

        const liftFromPrev = prevAvg > 0
          ? Number((((pAvg - prevAvg) / prevAvg) * 100).toFixed(1))
          : pAvg > 0 ? 100 : 0;

        phases.push({
          phaseName: `v${i + 1}`,
          label: milestones.length === 1 ? 'Post-SEO' : `v${i + 1} (${curOpt.date})`,
          startDate: phasePoints[0]?.date || phaseStart,
          endDate: phasePoints[phasePoints.length - 1]?.date || phaseEnd,
          totalDays: phasePoints.length,
          totalViews: pViews,
          avgDailyViews: isNaN(pAvg) ? 0 : pAvg,
          liftPercentFromBaseline: isNaN(liftFromBaseline) ? 0 : liftFromBaseline,
          liftPercentFromPrevious: isNaN(liftFromPrev) ? 0 : liftFromPrev,
        });

        prevAvg = pAvg;
      }
    }

    // Annotate daily points with their corresponding active phase
    const pointsWithPhase = (dailyData || []).map(point => {
      let activePhase = 'baseline';
      let activeVersionLabel = 'Original';

      for (let i = milestones.length - 1; i >= 0; i--) {
        if (point?.date && point.date >= milestones[i].date) {
          activePhase = `v${i + 1}`;
          activeVersionLabel = `Version ${i + 1}`;
          break;
        }
      }

      return {
        date: point?.date || '',
        views: Number(point?.views) || 0,
        watchMinutes: Number(point?.watchMinutes) || 0,
        avgDurationSeconds: Number(point?.avgDurationSeconds) || 0,
        phase: activePhase,
        versionLabel: activeVersionLabel,
      };
    });

    const totalViewsInPeriod = pointsWithPhase.reduce((sum, d) => sum + (d.views || 0), 0);
    const totalWatchMinutes = pointsWithPhase.reduce((sum, d) => sum + (d.watchMinutes || 0), 0);

    const result = {
      videoId,
      youtubeId: video.youtubeId,
      title: video.title || video.youtubeTitle || 'Untitled Video',
      publishedAt: video.publishedAt ? new Date(video.publishedAt).toISOString() : null,
      range: validRange,
      startDate,
      endDate,
      totalPoints: pointsWithPhase.length,
      totalViewsInPeriod,
      totalWatchMinutes,
      cachedAt: new Date().toISOString(),
      fromCache: false,
      milestones: milestones.map((m, idx) => ({
        versionNumber: idx + 1,
        date: m.date,
        label: `v${idx + 1} (${m.date})`,
        title: m.title || '',
      })),
      phases,
      dailyData: pointsWithPhase,
    };

    // Store in Redis (2 Hours TTL = 7200 seconds)
    try {
      await this.redisService.setJson(cacheKey, result, 7200);
      this.logger.log(`Cached video timeline in Redis: ${cacheKey} (TTL: 7200s)`);
    } catch (err: any) {
      this.logger.warn(`Failed to set Redis cache for ${cacheKey}: ${err?.message || err}`);
    }

    return result;
  }
}
