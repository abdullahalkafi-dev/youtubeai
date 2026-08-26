import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
  Inject,
  forwardRef,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Video, VideoDocument } from '../mongo/schemas/video.schema';
import { Channel, ChannelDocument } from '../mongo/schemas/channel.schema';
import { SeoSuggestion, SeoSuggestionDocument } from '../mongo/schemas/seo-suggestion.schema';
import { SeoVersion, SeoVersionDocument } from '../mongo/schemas/seo-version.schema';
import { TrendingTopic, TrendingTopicDocument } from '../mongo/schemas/trending-topic.schema';
import { User, UserDocument } from '../mongo/schemas/user.schema';
import { OpenAIService } from '../openai/openai.service';
import { YouTubeService } from '../youtube/youtube.service';
import { YouTubeSuggestionsService } from '../youtube/youtube-suggestions.service';
import { YouTubeTranscriptService } from '../youtube/youtube-transcript.service';
import { QuotaService, QuotaExceededException } from '../quota/quota.service';
import { ChromaService } from '../chroma/chroma.service';
import { AutomationService } from '../automation/automation.service';
import { buildChannelContext } from '../openai/prompts/context';
import { GenerateSeoDto } from './dto/seo.dto';

const DAILY_APPROVE_CAP = 120;

@Injectable()
export class SeoService {
  private readonly logger = new Logger(SeoService.name);

  constructor(
    @InjectModel(Video.name) private readonly videoModel: Model<VideoDocument>,
    @InjectModel(Channel.name) private readonly channelModel: Model<ChannelDocument>,
    @InjectModel(SeoSuggestion.name) private readonly seoSuggestionModel: Model<SeoSuggestionDocument>,
    @InjectModel(SeoVersion.name) private readonly seoVersionModel: Model<SeoVersionDocument>,
    @InjectModel(TrendingTopic.name) private readonly trendingTopicModel: Model<TrendingTopicDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly openaiService: OpenAIService,
    private readonly youtubeService: YouTubeService,
    private readonly suggestionsService: YouTubeSuggestionsService,
    private readonly transcriptService: YouTubeTranscriptService,
    private readonly quotaService: QuotaService,
    private readonly chromaService: ChromaService,
    @Inject(forwardRef(() => AutomationService))
    @Optional()
    private readonly automationService?: AutomationService,
  ) {}

  /**
   * Main SEO generation method: integrates Channel, RAG memory, 
   * live YouTube suggestions, spoken transcripts, and Series linking context.
   */
  async generateSeo(dto: GenerateSeoDto) {
    const video = await this.videoModel.findById(dto.videoId);
    if (!video) throw new NotFoundException(`Video ${dto.videoId} not found`);
    if (video.deletedFromYoutube) throw new NotFoundException('Cannot generate SEO for a video deleted from YouTube');
    if (video.seoStatus === 'processing') throw new ForbiddenException('SEO generation already in progress for this video');

    const channel = await this.channelModel.findById(video.channelId);

    await this.videoModel.findByIdAndUpdate(dto.videoId, { $set: { seoStatus: 'processing' } });

    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const topVideos = await this.videoModel.find({
        channelId: video.channelId,
        publishedAt: { $gte: thirtyDaysAgo },
        _id: { $ne: video._id },
        deletedFromYoutube: { $ne: true },
      }).sort({ viewCount: -1 }).limit(8).select('title viewCount tags').lean();

      const channelStats = channel
        ? buildChannelContext({ name: channel.name, handle: channel.handle, subscriberCount: channel.subscriberCount, totalVideos: channel.totalVideos, totalViews: channel.totalViews, totalWatchHours: channel.totalWatchHours, estimatedRevenue: channel.estimatedRevenue })
        : undefined;

      const trendingTopics = await this.trendingTopicModel.find({
        channelId: video.channelId,
        fetchedAt: { $gte: sevenDaysAgo },
      }).sort({ opportunityScore: -1 }).limit(5).select('title').lean();

      const videoPerformance = {
        views: video.viewCount,
        watchTimeHours: video.avgWatchTime ? video.avgWatchTime / 3600 : undefined,
        publishedDaysAgo: video.publishedAt ? Math.round((Date.now() - video.publishedAt.getTime()) / (1000 * 60 * 60 * 24)) : undefined,
      };

      // 1. Fetch live YouTube search autocomplete suggestions (0 quota cost)
      let liveSearchSuggestions: string[] = [];
      try {
        liveSearchSuggestions = await this.suggestionsService.getSuggestions(video.youtubeTitle || video.title);
      } catch { /* optional */ }

      // 2. Spoken Video Transcript & Timestamps (MongoDB Cache -> Tier 1-3 InnerTube 0-Quota -> Tier 4 OAuth Captions API)
      let transcriptAnchors: string | undefined;
      const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
      const isConfirmedNone =
        video.transcriptSource === 'none' &&
        video.transcriptFetchedAt &&
        Date.now() - new Date(video.transcriptFetchedAt).getTime() < SEVEN_DAYS_MS;

      // Step 0: Use cached transcript from MongoDB if available
      if (video.transcriptSegments && video.transcriptSegments.length > 0) {
        transcriptAnchors = this.transcriptService.formatTranscriptAnchors(video.transcriptSegments);
        this.logger.log(`[Transcript Cache Hit] Loaded ${video.transcriptSegments.length} segments from DB for video ${video.youtubeId} (0 quota, 0 network)`);
      } else if (!isConfirmedNone && video.youtubeId) {
        // Step 1-3: Multi-Tier InnerTube Scraper (Android -> iOS -> Web) (0 quota)
        try {
          const freeRes = await this.transcriptService.getTranscript(video.youtubeId);
          if (freeRes && freeRes.segments.length > 0 && freeRes.fullText.trim().length > 0) {
            transcriptAnchors = this.transcriptService.formatTranscriptAnchors(freeRes.segments);
            // Save permanently in MongoDB
            await this.videoModel.findByIdAndUpdate(video._id, {
              $set: {
                transcriptText: freeRes.fullText,
                transcriptSegments: freeRes.segments,
                transcriptSource: freeRes.source,
                transcriptFetchedAt: new Date(),
              },
            });
            this.logger.log(`[Transcript Saved] Saved 0-quota ${freeRes.source} transcript (${freeRes.segments.length} segs) to DB for ${video.youtubeId}`);
          }
        } catch (e: any) {
          this.logger.warn(`InnerTube transcript fetch fell through for ${video.youtubeId}: ${e.message}`);
        }

        // Step 4: Fallback to Official YouTube Captions API (Channel-Owned OAuth) if 0-quota tiers found no tracks
        if (!transcriptAnchors && channel?.userId) {
          try {
            const accessToken = await this.youtubeService.getValidAccessToken(channel.userId.toString());
            if (accessToken) {
              const tier4Res = await this.youtubeService.getOfficialVideoCaptions(accessToken, video.youtubeId);

              if (tier4Res.status === 'success') {
                await this.quotaService.logCall({
                  channelId: video.channelId.toString(),
                  endpoint: 'captions.list+download',
                  quotaCost: 250,
                  relatedId: video.youtubeId,
                  success: true,
                });

                const parsed = this.transcriptService.parseVttOrSrtToSegments(tier4Res.rawVtt);
                if (parsed && parsed.segments.length > 0) {
                  transcriptAnchors = this.transcriptService.formatTranscriptAnchors(parsed.segments);
                  await this.videoModel.findByIdAndUpdate(video._id, {
                    $set: {
                      transcriptText: parsed.fullText,
                      transcriptSegments: parsed.segments,
                      transcriptSource: 'official_oauth',
                      transcriptFetchedAt: new Date(),
                    },
                  });
                  this.logger.log(`[Tier 4 Saved] Saved official OAuth transcript to DB for ${video.youtubeId}`);
                }
              } else if (tier4Res.status === 'confirmed_none') {
                await this.quotaService.logCall({
                  channelId: video.channelId.toString(),
                  endpoint: 'captions.list',
                  quotaCost: 50,
                  relatedId: video.youtubeId,
                  success: true,
                });
                // Cache confirmed none with 7-day cooldown
                await this.videoModel.findByIdAndUpdate(video._id, {
                  $set: {
                    transcriptSource: 'none',
                    transcriptFetchedAt: new Date(),
                  },
                });
                this.logger.log(`[Tier 4 Confirmed None] Cached transcriptSource: none for ${video.youtubeId}`);
              } else if (tier4Res.status === 'quota_exceeded') {
                await this.quotaService.logCall({
                  channelId: video.channelId.toString(),
                  endpoint: 'captions.list+download',
                  quotaCost: 250,
                  relatedId: video.youtubeId,
                  success: false,
                  errorMessage: tier4Res.error,
                }).catch(() => {});
                // Throw QuotaExceededException so batch halts immediately
                throw new QuotaExceededException(10000, 10000, 'captions.list+download', 250);
              } else if (tier4Res.status === 'infra_failure') {
                // Do NOT write 'none' to cache (leaves cache clean for next run retry)
                await this.quotaService.logCall({
                  channelId: video.channelId.toString(),
                  endpoint: 'captions.list+download',
                  quotaCost: 250,
                  relatedId: video.youtubeId,
                  success: false,
                  errorMessage: `${tier4Res.reason}: ${tier4Res.error}`,
                }).catch(() => {});
                this.logger.warn(`Tier 4 infra failure (${tier4Res.reason}) for ${video.youtubeId}: ${tier4Res.error}. Leaving cache unpoisoned.`);
              }
            }
          } catch (error: any) {
            if (error instanceof QuotaExceededException || error?.reason === 'quotaExceeded') {
              throw error; // Re-throw to halt batch loop
            }
            this.logger.warn(`Tier 4 official captions exception for video ${video.youtubeId}: ${error.message}`);
          }
        }
      }

      // 3. Detect existing related series videos on the channel for multi-part topic context
      let relatedSeriesVideos: Array<{ title: string; views?: number; publishedDaysAgo?: number; youtubeId?: string }> = [];
      try {
        const STOP_WORDS = new Set([
          'brutal', 'truth', 'shocking', 'full', 'case', 'video', 'breakdown', 'episode',
          'podcast', 'inside', 'story', 'news', 'update', 'real', 'reality', 'about',
          'with', 'from', 'that', 'this', 'have', 'were', 'will', 'what', 'when', 'where',
          'which', 'their', 'there', 'they', 'them', 'your', 'unique', 'mecca', 'audio',
        ]);
        const titleText = (video.youtubeTitle || video.title).replace(/[^\w\s]/g, '');
        const keyWords = titleText
          .split(/\s+/)
          .map(w => w.trim())
          .filter((w) => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()));

        if (keyWords.length >= 2) {
          // Require at least top 2 specific topic entity words simultaneously ($and)
          const conditions = keyWords.slice(0, 3).map(kw => ({ title: { $regex: `\\b${kw}\\b`, $options: 'i' } }));
          const seriesDocs = await this.videoModel.find({
            channelId: video.channelId,
            _id: { $ne: video._id },
            deletedFromYoutube: { $ne: true },
            $and: conditions.slice(0, 2),
          }).sort({ publishedAt: 1 }).limit(5).select('title youtubeId viewCount publishedAt').lean();

          relatedSeriesVideos = seriesDocs.map((v: any) => ({
            title: v.title,
            youtubeId: v.youtubeId,
            views: v.viewCount,
            publishedDaysAgo: v.publishedAt ? Math.round((Date.now() - new Date(v.publishedAt).getTime()) / (1000 * 60 * 60 * 24)) : undefined,
          }));
        }
      } catch { /* optional */ }

      // RAG: Get approved SEO patterns for similar videos
      let approvedPatterns = '';
      try {
        const similarSeo = await this.chromaService.query('seo_suggestions', video.youtubeTitle || video.title, 5, { status: 'approved' });
        if (similarSeo.length > 0) {
          approvedPatterns = '\n\nAPPROVED SEO PATTERNS (from similar videos — study these):\n' +
            similarSeo.map(r => `- "${r.metadata.title}" (approved)`).join('\n');
        }
      } catch { /* RAG optional */ }

      const result = await this.openaiService.generateSeo({
        videoTitle: video.youtubeTitle || video.title,
        videoDescription: video.youtubeDescription || video.description || undefined,
        showType: video.showType || undefined,
        transcriptAnchors,
        channelStats: (channelStats || '') + approvedPatterns,
        topPerformingVideos: topVideos.map(v => ({ title: v.title, views: v.viewCount, tags: v.tags })),
        trendingTopics: trendingTopics.map(t => t.title),
        videoPerformance,
        liveSearchSuggestions,
        relatedSeriesVideos,
        customInstructions: dto.customInstructions,
      });

      const cleanTitle = (result.title || '')
        .replace(/^[\*\#\"\']+|[\*\#\"\']+$/g, '')
        .replace(/\*\*/g, '')
        .trim();

      const { usage: _usage, ...seoData } = result;
      seoData.title = cleanTitle;

      // Mark any existing pending suggestions for this video as superseded only after generation succeeds
      await this.seoSuggestionModel.updateMany(
        { videoId: video._id, status: 'pending' },
        { $set: { status: 'superseded' } },
      );

      const suggestion = await this.seoSuggestionModel.create({
        videoId: video._id,
        channelId: video.channelId,
        title: cleanTitle,
        description: result.description,
        tags: result.tags,
        hashtags: result.hashtags,
        showType: video.showType || undefined,
        tone: 'dark_direct',
        source: 'dashboard_single_video',
      });

      await this.videoModel.findByIdAndUpdate(dto.videoId, {
        $set: {
          seoStatus: 'pending',
          suggestedSeo: seoData,
        },
      });

      // Store in ChromaDB for RAG
      try {
        await this.chromaService.upsert('seo_suggestions', suggestion._id.toString(),
          `Title: ${result.title}\nDescription: ${result.description}\nTags: ${result.tags.join(', ')}`,
          { videoId: dto.videoId, channelId: video.channelId.toString(), status: 'pending', title: result.title });
      } catch { /* RAG optional */ }

      this.logger.log(`SEO generated for video ${dto.videoId}`);
      return suggestion.toObject();
    } catch (error) {
      // Restore previous seoStatus (don't overwrite 'approved' or 'optimized' on error)
      const previousStatus = video?.seoStatus || 'not_started';
      await this.videoModel.findByIdAndUpdate(dto.videoId, { $set: { seoStatus: previousStatus } });
      throw error;
    }
  }

  async findAll(channelId: string) {
    // Get IDs of deleted videos to exclude their suggestions
    const deletedVideos = await this.videoModel.find({
      channelId: new Types.ObjectId(channelId),
      deletedFromYoutube: true,
    }).select('_id').lean();
    const deletedVideoIds = deletedVideos.map(v => v._id);

    const results = await this.seoSuggestionModel.find({
      channelId: new Types.ObjectId(channelId),
      videoId: { $nin: deletedVideoIds },
      status: { $ne: 'superseded' },
    })
      .populate('videoId', 'title thumbnailUrl')
      .sort({ createdAt: -1 })
      .lean();

    return results.map((r: any) => {
      const { _id, __v, ...rest } = r;
      const id = _id.toString();
      const videoId = rest.videoId?._id ? rest.videoId._id.toString() : rest.videoId?.toString?.() || rest.videoId;
      return { id, ...rest, videoId };
    });
  }

  async approve(id: string): Promise<any> {
    // Atomic check-and-set: only one approve can proceed for a given suggestion
    const suggestion = await this.seoSuggestionModel.findOneAndUpdate(
      { _id: id, status: 'pending' },
      { $set: { status: 'approving' } },
      { new: true },
    ).populate('videoId', 'title thumbnailUrl');
    if (!suggestion) {
      // Check if already approved (idempotent return)
      const existing = await this.seoSuggestionModel.findById(id).lean();
      if (existing?.status === 'approved') {
        return { success: true, videoId: existing.videoId, youtubePushed: false, dailyCount: 0, dailyCap: DAILY_APPROVE_CAP, alreadyApproved: true };
      }
      // Recover from stuck 'approving' status (crash recovery)
      if (existing?.status === 'approving') {
        this.logger.warn(`Suggestion ${id} stuck in 'approving' status — recovering to 'pending'`);
        await this.seoSuggestionModel.findByIdAndUpdate(id, { $set: { status: 'pending' } });
        return this.approve(id);
      }
      throw new NotFoundException(`Suggestion ${id} not found or not in pending state`);
    }

    const resetPending = async () => {
      await this.seoSuggestionModel.findByIdAndUpdate(id, { $set: { status: 'pending' } });
    };

    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const dailyApproveCount = await this.seoSuggestionModel.countDocuments({
        channelId: suggestion.channelId, status: 'approved', createdAt: { $gte: todayStart },
      });

      if (dailyApproveCount >= DAILY_APPROVE_CAP) {
        await resetPending();
        return { success: false, error: `Daily limit reached (${DAILY_APPROVE_CAP}/day).`, dailyCount: dailyApproveCount, dailyCap: DAILY_APPROVE_CAP };
      }

      const video = await this.videoModel.findById(suggestion.videoId);
      if (!video) {
        await resetPending();
        throw new NotFoundException(`Video ${suggestion.videoId} not found`);
      }

      // Check for soft-deleted video
      if (video.deletedFromYoutube) {
        await resetPending();
        return { success: false, error: 'Cannot approve SEO for a video deleted from YouTube', dailyCount: dailyApproveCount, dailyCap: DAILY_APPROVE_CAP };
      }

      const channel = await this.channelModel.findById(suggestion.channelId).lean();
      const user = channel ? await this.userModel.findOne({ _id: channel.userId }).lean() : null;
      let youtubePushed = false;
      if (user?._id && video?.youtubeId) {
        try {
          const accessToken = await this.youtubeService.getValidAccessToken(user._id.toString());
          await this.youtubeService.updateVideo(accessToken, video.youtubeId, suggestion.title, suggestion.description, suggestion.tags);
          youtubePushed = true;
          await this.quotaService.logCall({ channelId: suggestion.channelId.toString(), endpoint: 'videos.update', quotaCost: 51, relatedId: suggestion.videoId.toString() });
        } catch (error) {
          await resetPending();
          return { success: false, youtubePushed: false, error: `YouTube push failed: ${error.message}`, dailyCount: dailyApproveCount, dailyCap: DAILY_APPROVE_CAP };
        }
      } else {
        // YouTube push skipped — cannot set youtubeTitle since YouTube wasn't updated
        await resetPending();
        return { success: false, youtubePushed: false, error: 'YouTube push skipped: channel or user not found', dailyCount: dailyApproveCount, dailyCap: DAILY_APPROVE_CAP };
      }

      // Save version before approval
      if (video.currentSeo) {
        await this.seoVersionModel.create({
          videoId: suggestion.videoId,
          type: 'ai_optimized',
          approved: true,
          source: 'dashboard_single_video',
          seo: video.currentSeo,
          note: 'Previous version before AI optimization',
        });
      } else {
        const existingOriginal = await this.seoVersionModel.findOne({ videoId: suggestion.videoId, type: 'original' }).lean();
        if (!existingOriginal) {
          await this.seoVersionModel.create({
            videoId: suggestion.videoId,
            type: 'original',
            approved: false,
            source: 'dashboard_single_video',
            seo: {
              title: video.title,
              description: video.description || '',
              tags: video.tags || [],
              hashtags: [],
            },
            note: 'Original YouTube metadata before first SEO optimization',
          });
        }
      }

      const approvedSeo = { title: suggestion.title, description: suggestion.description, tags: suggestion.tags, hashtags: suggestion.hashtags };
      await this.videoModel.findByIdAndUpdate(suggestion.videoId, {
        $set: {
          seoStatus: 'approved',
          optimizationSource: 'dashboard_single_video',
          lastManualModifiedAt: new Date(),
          currentSeo: approvedSeo,
          suggestedSeo: null,
          title: suggestion.title,
          description: suggestion.description,
          tags: suggestion.tags,
          youtubeTitle: suggestion.title,
          youtubeDescription: suggestion.description,
          youtubeTags: suggestion.tags,
        },
      });
      await this.seoSuggestionModel.findByIdAndUpdate(id, {
        $set: { status: 'approved', source: 'dashboard_single_video' },
      });

      // Re-embed in ChromaDB
      try {
        await this.chromaService.upsert('video_metadata', suggestion.videoId.toString(),
          `Title: ${suggestion.title}\nDescription: ${suggestion.description}\nTags: ${suggestion.tags.join(', ')}`,
          { channelId: suggestion.channelId.toString(), viewCount: video.viewCount, title: suggestion.title });
      } catch { /* RAG optional */ }

      // Update RAG status
      try {
        await this.chromaService.upsert('seo_suggestions', id,
          `Title: ${suggestion.title}\nDescription: ${suggestion.description}\nTags: ${suggestion.tags.join(', ')}`,
          { videoId: suggestion.videoId.toString(), channelId: suggestion.channelId.toString(), status: 'approved', title: suggestion.title });
      } catch { /* RAG optional */ }

      // Reconcile any historical batch failures for this video
      try {
        if (this.automationService) {
          await this.automationService.reconcileManualOverride(suggestion.videoId);
        }
      } catch (err: any) {
        this.logger.warn(`Failed to reconcile automation batch for video ${suggestion.videoId}: ${err.message}`);
      }

      return { success: true, videoId: suggestion.videoId, youtubePushed, dailyCount: dailyApproveCount + 1, dailyCap: DAILY_APPROVE_CAP };
    } catch (error) {
      await resetPending();
      throw error;
    }
  }

  async reject(id: string) {
    const suggestion = await this.seoSuggestionModel.findById(id);
    if (!suggestion) throw new NotFoundException(`Suggestion ${id} not found`);

    const video = await this.videoModel.findById(suggestion.videoId);
    if (video && video.seoStatus !== 'approved' && video.seoStatus !== 'optimized') {
      await this.videoModel.findByIdAndUpdate(video._id, {
        $set: { seoStatus: 'not_started', suggestedSeo: null },
      });
    }

    try {
      await this.chromaService.upsert('seo_suggestions', id,
        `Title: ${suggestion.title}\nDescription: ${suggestion.description}\nTags: ${suggestion.tags.join(', ')}`,
        { videoId: suggestion.videoId.toString(), channelId: suggestion.channelId.toString(), status: 'rejected', title: suggestion.title });
    } catch { /* RAG optional */ }

    return this.seoSuggestionModel.findByIdAndUpdate(id, { $set: { status: 'rejected' } }, { new: true }).lean();
  }

  async getVersionHistory(videoId: string) {
    const oid = Types.ObjectId.isValid(videoId) ? new Types.ObjectId(videoId) : videoId;
    const versions = await this.seoVersionModel
      .find({ $or: [{ videoId: oid }, { videoId }] })
      .sort({ createdAt: -1 })
      .lean();

    return versions.map((v: any) => {
      const { _id, __v, ...rest } = v;
      return { id: _id.toString(), ...rest, videoId: rest.videoId?.toString() || rest.videoId };
    });
  }

  async rollbackToVersion(versionId: string) {
    const targetVersion = await this.seoVersionModel.findById(versionId);
    if (!targetVersion) throw new NotFoundException(`Version ${versionId} not found`);

    const video = await this.videoModel.findById(targetVersion.videoId);
    if (!video) throw new NotFoundException(`Video ${targetVersion.videoId} not found`);

    // Verify YouTube push first if connected
    const channel = await this.channelModel.findById(video.channelId).lean();
    const user = channel ? await this.userModel.findOne({ _id: channel.userId }).lean() : null;
    if (user?._id && video.youtubeId) {
      try {
        const accessToken = await this.youtubeService.getValidAccessToken(user._id.toString());
        await this.youtubeService.updateVideo(accessToken, video.youtubeId, targetVersion.seo.title, targetVersion.seo.description, targetVersion.seo.tags);
        await this.quotaService.logCall({
          channelId: video.channelId.toString(),
          endpoint: 'videos.update (rollback)',
          quotaCost: 51,
          relatedId: video.youtubeId,
          success: true,
        });
      } catch (error: any) {
        this.logger.error(`Rollback YouTube push failed for video ${video._id}: ${error.message}`);
        await this.quotaService.logCall({
          channelId: video.channelId.toString(),
          endpoint: 'videos.update (rollback)',
          quotaCost: 51,
          relatedId: video.youtubeId,
          success: false,
          errorMessage: error.message,
        }).catch(() => {});
        throw new BadRequestException(`YouTube push failed: ${error.message}`);
      }
    }

    // Save current state as a version before rolling back
    if (video.currentSeo) {
      await this.seoVersionModel.create({
        videoId: video._id,
        type: 'rolled_back',
        approved: false,
        source: 'dashboard_single_video',
        seo: video.currentSeo,
        note: `Rolled back to version from ${targetVersion.createdAt}`,
      });
    }

    // Update title, description, tags, and youtube mirror fields
    await this.videoModel.findByIdAndUpdate(video._id, {
      $set: {
        seoStatus: 'optimized',
        optimizationSource: 'dashboard_single_video',
        lastManualModifiedAt: new Date(),
        currentSeo: targetVersion.seo,
        suggestedSeo: null,
        title: targetVersion.seo.title,
        description: targetVersion.seo.description,
        tags: targetVersion.seo.tags,
        youtubeTitle: targetVersion.seo.title,
        youtubeDescription: targetVersion.seo.description,
        youtubeTags: targetVersion.seo.tags,
      },
    });

    // Re-embed in ChromaDB
    try {
      await this.chromaService.upsert('video_metadata', video._id.toString(),
        `Title: ${targetVersion.seo.title}\nDescription: ${targetVersion.seo.description}\nTags: ${targetVersion.seo.tags.join(', ')}`,
        { channelId: video.channelId.toString(), viewCount: video.viewCount, title: targetVersion.seo.title });
    } catch { /* RAG optional */ }

    return this.videoModel.findById(video._id).lean();
  }
}
