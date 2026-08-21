import { Injectable, Logger, forwardRef, Inject, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Channel, ChannelDocument } from '../mongo/schemas/channel.schema';
import { TrendingTopic, TrendingTopicDocument } from '../mongo/schemas/trending-topic.schema';
import { Video, VideoDocument } from '../mongo/schemas/video.schema';
import { ChatService } from '../chat/chat.service';
import { YouTubeService } from '../youtube/youtube.service';
import { YouTubeSuggestionsService } from '../youtube/youtube-suggestions.service';
import { ChromaService } from '../chroma/chroma.service';
import { OpenAIService } from '../openai/openai.service';
import { QuotaService } from '../quota/quota.service';
import { RedisService } from '../redis/redis.service';
import { buildTrendsSearchPrompt, buildEntityExtractionPrompt } from './prompts';
import { validateExtractedEntity, SearchListQuotaCounter } from './trends.utils';

const TREND_HISTORY_DAYS = 5;

@Injectable()
export class TrendsService implements OnModuleInit {
  private readonly logger = new Logger(TrendsService.name);
  private readonly quota: SearchListQuotaCounter;

  constructor(
    @InjectModel(Channel.name) private readonly channelModel: Model<ChannelDocument>,
    @InjectModel(TrendingTopic.name) private readonly trendingTopicModel: Model<TrendingTopicDocument>,
    @InjectModel(Video.name) private readonly videoModel: Model<VideoDocument>,
    @Inject(forwardRef(() => ChatService))
    private readonly chatService: ChatService,
    private readonly youtubeService: YouTubeService,
    private readonly suggestionsService: YouTubeSuggestionsService,
    private readonly chromaService: ChromaService,
    private readonly openaiService: OpenAIService,
    private readonly quotaService: QuotaService,
    private readonly redisService: RedisService,
  ) {
    this.quota = new SearchListQuotaCounter(this.channelModel);
  }

  async onModuleInit() {
    try {
      const unmigrated = await this.trendingTopicModel.find({
        $or: [{ sourceUrl: { $exists: false } }, { sourceUrl: null }, { sourceUrl: '' }],
      }).select('_id title source').lean();

      if (unmigrated.length > 0) {
        const bulkOps = unmigrated.map(t => {
          const fallbackUrl = (t.source && t.source.startsWith('http'))
            ? t.source
            : `https://www.google.com/search?q=${encodeURIComponent((t.title || '') + ' ' + (t.source || ''))}`;
          return {
            updateOne: {
              filter: { _id: t._id },
              update: { $set: { sourceUrl: fallbackUrl } },
            },
          };
        });
        const res = await this.trendingTopicModel.bulkWrite(bulkOps);
        this.logger.log(`[onModuleInit] Backfilled sourceUrl for ${res.modifiedCount} legacy trend topics`);
      }
    } catch (err: any) {
      this.logger.warn(`[onModuleInit] Failed to backfill legacy trend sourceUrls: ${err.message}`);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleDailyTrendsRefresh() {
    this.logger.log('Cron triggered: daily trends refresh for all channels');
    const channels = await this.channelModel.find().select('id name').lean();
    for (const channel of channels) {
      try {
        await this.refreshTrends(channel._id.toString());
        this.logger.log(`Cron: refreshed trends for channel "${channel.name}"`);
      } catch (error) {
        this.logger.error(`Cron: failed for channel "${channel.name}": ${error.message}`);
      }
    }
  }

  async getTrends(channelId: string, days?: number) {
    const cacheKey = `trends:channel:${channelId}:days:${days ?? 'all'}`;
    const cached = await this.redisService.getJson<any[]>(cacheKey);
    if (cached) {
      this.logger.log(`[getTrends] HIT Redis cache for channelId=${channelId} (${cached.length} topics)`);
      return cached;
    }

    const oid = new Types.ObjectId(channelId);
    const filter: any = { $or: [{ channelId: oid }, { channelId }] };
    if (days) filter.fetchedAt = { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) };
    this.logger.log(`[getTrends] MISS Redis cache. Fetching from DB channelId=${channelId} days=${days ?? 'all'}`);
    const topics = await this.trendingTopicModel.find(filter).sort({ publishedAt: -1, fetchedAt: -1 }).limit(days ? 10 * days : 15).lean();
    
    const result = topics.map((t: any) => {
      const { _id, __v, ...rest } = t;
      return { id: _id.toString(), ...rest };
    });

    // Cache in Redis for 1 hour (3600s)
    await this.redisService.setJson(cacheKey, result, 3600);
    return result;
  }

  /**
   * Start a trends refresh in the background using Redis for state tracking. Returns immediately.
   * Use getRefreshStatus() to check progress.
   */
  async startRefresh(channelId: string): Promise<{ status: string; message: string }> {
    this.logger.log(`[startRefresh] called for channelId=${channelId}`);
    const statusKey = `trends:status:${channelId}`;
    const existing = await this.redisService.getJson<{ running: boolean; startedAt: string }>(statusKey);

    if (existing?.running) {
      this.logger.warn(`[startRefresh] channelId=${channelId} already running in Redis since ${existing.startedAt}`);
      return { status: 'already_running', message: 'A refresh is already in progress for this channel.' };
    }

    await this.redisService.setJson(statusKey, { running: true, startedAt: new Date().toISOString() }, 3600);
    this.logger.log(`[startRefresh] channelId=${channelId} background job started (tracked in Redis)`);

    // Fire and forget — run in background
    this.refreshTrends(channelId)
      .then(async (result) => {
        await this.redisService.setJson(statusKey, {
          running: false,
          completedAt: new Date().toISOString(),
          topicsCount: Array.isArray(result) ? result.length : 0,
        }, 3600);
        this.logger.log(`[startRefresh] channelId=${channelId} background refresh completed — ${Array.isArray(result) ? result.length : 0} topics created`);
      })
      .catch(async (error) => {
        await this.redisService.setJson(statusKey, {
          running: false,
          completedAt: new Date().toISOString(),
          error: error.message,
        }, 3600);
        this.logger.error(`[startRefresh] channelId=${channelId} background refresh FAILED: ${error.message}`);
      });

    return { status: 'started', message: 'Trends refresh started in the background. Check status with GET /trends/refresh/status.' };
  }

  async getRefreshStatus(channelId: string): Promise<{ running: boolean; startedAt?: Date; completedAt?: Date; error?: string }> {
    const statusKey = `trends:status:${channelId}`;
    const status = await this.redisService.getJson<any>(statusKey);
    if (!status) return { running: false };
    return {
      running: !!status.running,
      startedAt: status.startedAt ? new Date(status.startedAt) : undefined,
      completedAt: status.completedAt ? new Date(status.completedAt) : undefined,
      error: status.error,
    };
  }

  async refreshTrends(channelId: string) {
    const startTime = Date.now();
    this.logger.log(`[refreshTrends] ▶ START channelId=${channelId}`);

    const channel = await this.channelModel.findById(channelId).lean();
    if (!channel) {
      this.logger.error(`[refreshTrends] channel ${channelId} NOT FOUND in DB`);
      throw new NotFoundException(`Channel ${channelId} not found`);
    }
    this.logger.log(`[refreshTrends] channel found: "${channel.name}" subs=${channel.subscriberCount} videos=${channel.totalVideos} views=${channel.totalViews}`);

    // Load last 10 videos for context
    const recentVideos = await this.videoModel
      .find({ channelId })
      .sort({ publishedAt: -1 })
      .limit(10)
      .select('title description viewCount')
      .lean();

    const videoList = recentVideos.length > 0
      ? recentVideos.map((v, i) =>
          `${i + 1}. "${v.title}" (${(v.viewCount || 0).toLocaleString()} views)` +
          (v.description ? `\n   Description: ${v.description.substring(0, 150)}` : '')
        ).join('\n')
      : 'No recent videos recorded yet.';

    const channelContext = `
CHANNEL: ${channel.name} (${channel.handle || 'N/A'})
SUBSCRIBERS: ${(channel.subscriberCount || 0).toLocaleString()}
DESCRIPTION: ${(channel.description || 'N/A').substring(0, 300)}

CREATOR: Unique Mecca Audio — 62-year-old former federal prisoner (26 years inside, 1993-2020). Criminal psychology professor. Breaks down mindset of criminals using lived experience. Topics: federal cases, rapper trials, prison psychology, street-to-courtroom translation, sentencing, accountability. Mission: prevention and youth education.

RECENT VIDEOS (last 10 — what this channel actually covers):
${videoList}

Use these recent videos as a reference for what topics and angles this channel covers. Find NEW stories in the same lanes.
`;

    // Pre-check quota (300 units worst-case for AI-first pipeline)
    if (channel?.userId) {
      await this.quotaService.checkQuota(channelId, 'refreshTrends', 300);
      this.logger.log(`[refreshTrends] quota check passed`);
    }

    const today = new Date().toISOString().split('T')[0];
    const twentyOneDaysAgo = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);
    const twentyOneDaysAgoStr = twentyOneDaysAgo.toISOString().split('T')[0];

    // Phase 1: Web search for trending topics
    this.logger.log(`[refreshTrends] Phase 1: Web search`);
    const { system, user } = buildTrendsSearchPrompt({ channelContext, today, twentyOneDaysAgoStr });
    this.logger.log(`[refreshTrends] Phase 1: prompt built, calling OpenAI...`);
    const searchResult = await this.openaiService.chatWithSearch({
      systemPrompt: system,
      userMessage: user,
    });
    const text = searchResult.content;
    this.logger.log(`[refreshTrends] Phase 1: OpenAI response received (${text.length} chars)`);

    let allTopics: any[];
    try {
      allTopics = this.extractCleanJsonArray(text);
      this.logger.log(`[refreshTrends] Phase 1: parsed ${allTopics.length} web topics from AI`);
      allTopics.forEach((t, i) => {
        if (!t.source && t.sourceName) t.source = t.sourceName;
        this.logger.log(`[refreshTrends] Phase 1:   [${i}] "${t.title}" publishedAt=${t.publishedAt ?? 'null'} source=${t.source ?? 'null'}`);
      });
    } catch (parseError) {
      this.logger.error(`[refreshTrends] Phase 1: JSON.parse FAILED: ${parseError.message}`);
      this.logger.debug(`[refreshTrends] Phase 1: Raw AI response (first 500 chars): ${text.substring(0, 500)}`);
      throw new Error(`AI returned malformed JSON: ${parseError.message}`);
    }

    // Two-Tier Relevance Gate
    const TIER1_MANDATORY = [
      'indicted', 'convicted', 'sentenced', 'federal', 'prison', 'inmate',
      'racketeering', 'trafficking', 'guilty', 'plea', 'verdict', 'murder',
      'homicide', 'solitary', 'probation', 'parole', 'incarceration',
      'arrested', 'charges', 'felony', 'conspiracy', 'cartel',
    ];

    const NEGATIVE_DISQUALIFIERS = [
      'ncaa', 'nba', 'nfl', 'mlb', 'basketball', 'football', 'soccer', 'tennis',
      'zoning', 'construction', 'ballroom', 'real estate', 'school board',
      'cryptocurrency', 'crypto token', 'dividend', 'stock market', 'quarterly revenue',
    ];

    const passesRelevanceGate = (title: string, summary: string): boolean => {
      const combined = `${title} ${summary}`.toLowerCase();
      const isNegative = NEGATIVE_DISQUALIFIERS.some(kw => combined.includes(kw));
      if (isNegative) return false;
      const hasTier1 = TIER1_MANDATORY.some(kw => combined.includes(kw));
      return hasTier1;
    };

    const filteredWebTopics = allTopics.filter(topic => {
      if (!passesRelevanceGate(topic.title || '', topic.summary || '')) {
        this.logger.log(`[refreshTrends] Rejected (no Tier 1 keyword or negative match): "${topic.title}"`);
        return false;
      }
      return true;
    });
    this.logger.log(`[refreshTrends] Phase 1: ${allTopics.length} → ${filteredWebTopics.length} after relevance gate`);
    allTopics = filteredWebTopics;

    // Phase 2: Date filter — all topics come from AI web search (Phase 1), already relevance-gated
    this.logger.log(`[refreshTrends] Phase 2: Date filter (21 days, since ${twentyOneDaysAgoStr})`);
    let topics = allTopics.filter((t: any) => {
      if (!t.publishedAt) return true;
      const published = new Date(t.publishedAt);
      return !isNaN(published.getTime()) && published >= twentyOneDaysAgo;
    });
    this.logger.log(`[refreshTrends] Phase 2: ${topics.length} topics passed 21-day filter`);

    if (topics.length === 0) {
      const fortyFiveDaysAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
      this.logger.log(`[refreshTrends] Phase 2: falling back to 45-day window`);
      topics = allTopics.filter((t: any) => {
        if (!t.publishedAt) return true;
        const published = new Date(t.publishedAt);
        return !isNaN(published.getTime()) && published >= fortyFiveDaysAgo;
      });
      this.logger.log(`[refreshTrends] Phase 2: ${topics.length} topics passed 45-day filter`);
    }

    const deduplicatedTopics = this.deduplicateTopics(topics);
    this.logger.log(`[refreshTrends] Phase 4: Dedup: ${topics.length} → ${deduplicatedTopics.length} unique`);

    const quotaStats = await this.quota.getStats();
    this.logger.log(`[refreshTrends] Quota stats: used=${quotaStats.used} limit=${quotaStats.limit}`);

    // Priority Gating: Limit live YouTube search to top 8 priority topics per refresh
    this.logger.log(`[refreshTrends] Phase 5: Entity extraction + YouTube search for top ${Math.min(deduplicatedTopics.length, 8)} priority topics`);
    const priorityEnriched = await Promise.all(
      deduplicatedTopics.slice(0, 8).map(topic =>
        this.matchYouTubeVideo(topic, twentyOneDaysAgo, channelId)
      )
    );

    // Remaining topics (#9 to #20) are preserved as Open Gap news topics (0 extra YouTube quota cost)
    const remainingEnriched = deduplicatedTopics.slice(8).map(topic => ({
      ...topic,
      extractedEntity: topic.title ? topic.title.replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean).slice(0, 5).join(' ') : null,
      youtubeVideoId: null,
      youtubeThumbnailUrl: null,
      youtubeChannelTitle: null,
      youtubeVideoUrl: null,
    }));

    const enrichedTopics = [...priorityEnriched, ...remainingEnriched];
    enrichedTopics.forEach((t, i) => {
      this.logger.log(`[refreshTrends] Phase 5:   [${i}] "${t.title}" entity="${t.extractedEntity}" youtubeVideoId=${t.youtubeVideoId ?? 'null'}`);
    });

    // Search demand: get autocomplete suggestions for each entity
    const entities = enrichedTopics.map(t => t.extractedEntity).filter(Boolean) as string[];
    this.logger.log(`[refreshTrends] Phase 6: Search demand scoring for ${entities.length} entities: [${entities.join(', ')}]`);
    let searchDemandMap = new Map<string, number>();
    try {
      searchDemandMap = await this.suggestionsService.getSearchDemand(entities);
      this.logger.log(`[refreshTrends] Phase 6: search demand results: ${JSON.stringify(Object.fromEntries(searchDemandMap))}`);
    } catch (error) {
      this.logger.warn(`[refreshTrends] Phase 6: search demand FAILED: ${error.message}`);
    }

    // Channel fit: RAG similarity against video catalog
    this.logger.log(`[refreshTrends] Phase 7: Channel fit scoring (RAG)`);
    for (const topic of enrichedTopics) {
      topic.searchDemand = searchDemandMap.get(topic.extractedEntity || '') || 0;
      try {
        topic.channelFit = await this.calculateChannelFit(topic.title, topic.summary);
      } catch {
        topic.channelFit = 50; // Neutral fallback
      }
    }
    enrichedTopics.forEach((t, i) => {
      this.logger.log(`[refreshTrends] Phase 7:   [${i}] "${t.title}" searchDemand=${t.searchDemand} channelFit=${t.channelFit}`);
    });

    const matchedVideoIds = enrichedTopics.filter(t => t.youtubeVideoId).map(t => t.youtubeVideoId!);
    this.logger.log(`[refreshTrends] Phase 8: View counts for ${matchedVideoIds.length} matched videos`);
    const viewCounts = await this.batchGetViewCounts(matchedVideoIds, channelId);
    const avgChannelViews = channel ? Math.round(Number(channel.totalViews) / Math.max(channel.totalVideos, 1)) : 50000;
    this.logger.log(`[refreshTrends] Phase 8: avgChannelViews=${avgChannelViews}`);

    this.logger.log(`[refreshTrends] Phase 9: Opportunity scoring & badge calculation`);
    for (const topic of enrichedTopics) {
      const { score, label, badge } = this.calculateOpportunityScore(topic, viewCounts, avgChannelViews);
      topic.opportunityScore = score;
      topic.opportunityLabel = label;
      topic.badge = badge;
    }
    enrichedTopics.forEach((t, i) => {
      this.logger.log(`[refreshTrends] Phase 9:   [${i}] "${t.title}" score=${t.opportunityScore} label="${t.opportunityLabel}" badge="${t.badge ?? 'none'}"`);
    });

    // Deduplicate against existing DB topics (same channel, same day)
    this.logger.log(`[refreshTrends] Phase 10: DB dedup check`);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const oid = new Types.ObjectId(channelId);
    const existingTopics = await this.trendingTopicModel.find({
      $or: [{ channelId: oid }, { channelId }],
      fetchedAt: { $gte: todayStart },
    }).select('title').lean();
    const existingTitles = new Set(existingTopics.map(t => t.title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 60)));
    this.logger.log(`[refreshTrends] Phase 10: ${existingTopics.length} existing topics in DB for today`);

    const newTopics = enrichedTopics.filter(topic => {
      const key = (topic.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 60);
      return !existingTitles.has(key);
    });

    if (newTopics.length === 0) {
      this.logger.log(`[refreshTrends] Phase 10: All ${enrichedTopics.length} topics already exist in DB — returning empty`);
      return [];
    }
    this.logger.log(`[refreshTrends] Phase 10: ${newTopics.length} new topics to create`);

    this.logger.log(`[refreshTrends] Phase 11: Storing ${newTopics.length} topics in MongoDB`);
    const created = await Promise.all(newTopics.map(topic =>
      this.trendingTopicModel.create({
        channelId: new Types.ObjectId(channelId), title: topic.title || 'Untitled Topic', summary: topic.summary || '',
        source: topic.source, sourceUrl: topic.sourceUrl, publishedAt: topic.publishedAt ? new Date(topic.publishedAt) : null,
        youtubeVideoId: topic.youtubeVideoId, youtubeThumbnailUrl: topic.youtubeThumbnailUrl,
        youtubeChannelTitle: topic.youtubeChannelTitle, youtubeVideoUrl: topic.youtubeVideoUrl,
        extractedEntity: topic.extractedEntity, opportunityScore: topic.opportunityScore, opportunityLabel: topic.opportunityLabel,
        searchDemand: topic.searchDemand || 0, channelFit: topic.channelFit || 50, sourceType: topic.sourceType || 'web_search',
        badge: topic.badge || undefined,
      }),
    ));
    this.logger.log(`[refreshTrends] Phase 11: stored ${created.length} topics in MongoDB`);

    // Store in ChromaDB
    this.logger.log(`[refreshTrends] Phase 12: ChromaDB upsert for ${created.length} topics`);
    for (const topic of created) {
      try {
        await this.chromaService.upsert('trending_topics', topic._id.toString(),
          `Title: ${topic.title}\nSummary: ${topic.summary}`,
          { channelId, title: topic.title, opportunityScore: topic.opportunityScore });
      } catch { /* RAG optional */ }
    }

    const pruneBefore = new Date(Date.now() - TREND_HISTORY_DAYS * 24 * 60 * 60 * 1000);
    const pruned = await this.trendingTopicModel.deleteMany({
      $or: [{ channelId: oid }, { channelId }],
      fetchedAt: { $lt: pruneBefore },
    });
    this.logger.log(`[refreshTrends] Phase 13: pruned ${pruned.deletedCount} old topics (>${TREND_HISTORY_DAYS} days)`);

    // Invalidate Redis cache keys for this channel
    try {
      await this.redisService.del(`trends:channel:${channelId}:days:all`);
      await this.redisService.del(`trends:channel:${channelId}:days:3`);
      await this.redisService.del(`trends:channel:${channelId}:days:5`);
      await this.redisService.del(`trends:channel:${channelId}:days:14`);
      this.logger.log(`[refreshTrends] Invalidated Redis cache keys for channelId=${channelId}`);
    } catch { /* Cache invalidation optional */ }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    this.logger.log(`[refreshTrends] ✅ DONE channelId=${channelId} — ${created.length} topics created in ${elapsed}s`);

    return created;
  }

  private deduplicateTopics(topics: any[]): any[] {
    const seen = new Map<string, any>();
    for (const topic of topics) {
      const key = topic.title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 60);
      if (!seen.has(key)) seen.set(key, topic);
    }
    return Array.from(seen.values());
  }

  private async matchYouTubeVideo(topic: any, twentyOneDaysAgo: Date, channelId: string): Promise<any> {
    const base: any = {
      title: topic.title, summary: topic.summary, source: topic.source, sourceUrl: topic.sourceUrl,
      publishedAt: topic.publishedAt, youtubeVideoId: null, youtubeThumbnailUrl: null,
      youtubeChannelTitle: null, youtubeVideoUrl: null, extractedEntity: null,
      opportunityScore: 0, opportunityLabel: null, searchDemand: 0, channelFit: 50,
      sourceType: topic.sourceType || 'web_search',
    };

    // If AI search already provided a YouTube video URL, verify via oEmbed first (0 quota units)
    if (topic.youtubeVideoUrl) {
      try {
        const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(topic.youtubeVideoUrl)}&format=json`;
        const oembedRes = await fetch(oembedUrl);
        if (oembedRes.ok) {
          const oembed: any = await oembedRes.json();
          const hasCJK = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(oembed.title || '');
          if (!hasCJK) {
            const videoIdMatch = topic.youtubeVideoUrl.match(/(?:v=|\/embed\/|\/watch\?v=|youtu\.be\/|\/v\/)([a-zA-Z0-9_-]{11})/);
            const videoId = videoIdMatch ? videoIdMatch[1] : null;
            if (videoId) {
              base.youtubeVideoId = videoId;
              base.youtubeThumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
              base.youtubeChannelTitle = oembed.author_name || topic.youtubeChannelName || 'YouTube';
              base.youtubeVideoUrl = topic.youtubeVideoUrl;
              base.extractedEntity = topic.title;
              return base;
            }
          }
        }
      } catch { /* Fall through to entity extraction and search */ }
    }

    let extractedEntity: string | null = null;
    try {
      const extractionPrompt = buildEntityExtractionPrompt({ title: topic.title, summary: topic.summary });
      extractedEntity = await this.openaiService.chatFast({
        systemPrompt: extractionPrompt.system,
        userMessage: extractionPrompt.user,
        maxCompletionTokens: 50,
      });
      base.extractedEntity = extractedEntity;
    } catch { return base; }

    if (!extractedEntity) return base;
    const validation = validateExtractedEntity(extractedEntity);
    if (!validation.valid) return base;

    // 24-hour entity search cache check (0 quota units)
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const safeRegexPattern = extractedEntity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const cachedMatch = await this.trendingTopicModel.findOne({
        extractedEntity: { $regex: new RegExp(`^${safeRegexPattern}$`, 'i') },
        youtubeVideoId: { $ne: null },
        fetchedAt: { $gte: twentyFourHoursAgo },
      }).select('youtubeVideoId youtubeThumbnailUrl youtubeChannelTitle youtubeVideoUrl').lean();

      if (cachedMatch && cachedMatch.youtubeVideoId) {
        base.youtubeVideoId = cachedMatch.youtubeVideoId;
        base.youtubeThumbnailUrl = cachedMatch.youtubeThumbnailUrl;
        base.youtubeChannelTitle = cachedMatch.youtubeChannelTitle;
        base.youtubeVideoUrl = cachedMatch.youtubeVideoUrl;
        return base;
      }
    } catch { /* Cache optional */ }

    const quota = await this.quota.canUse();
    if (!quota.allowed) return base;

    try {
      const channel = await this.channelModel.findById(channelId).select('userId').lean();
      if (!channel?.userId) return base;
      const results = await this.youtubeService.searchVideos({
        userId: channel.userId.toString(),
        query: extractedEntity,
        publishedAfter: twentyOneDaysAgo,
        regionCode: 'US',
        maxResults: 5,
      });
      await this.quota.use();
      await this.quotaService.logCall({
        channelId, endpoint: 'refreshTrends (search.list)', quotaCost: 100, success: true,
      });

      // Filter out reaction/commentary channels to prioritize primary coverage
      const reactionPatterns = ['reacts', 'reaction', 'reacting', 'review', 'commentary'];
      const nonReactionResults = results.filter(r => {
        const titleLower = (r.title || '').toLowerCase();
        const chLower = (r.channelTitle || '').toLowerCase();
        return !reactionPatterns.some(p => titleLower.includes(p) || chLower.includes(p));
      });

      let chosen: any = nonReactionResults.length > 0 ? nonReactionResults[0] : null;

      // Verify chosen candidate via oEmbed (free, 0 quota units)
      if (chosen) {
        try {
          const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${chosen.videoId}&format=json`;
          const oembedRes = await fetch(oembedUrl);
          if (!oembedRes.ok) {
            this.logger.log(`[refreshTrends] oEmbed: video ${chosen.videoId} returned ${oembedRes.status}, resetting candidate`);
            chosen = null;
          } else {
            const oembed: any = await oembedRes.json();
            const hasCJK = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(oembed.title || '');
            if (hasCJK) {
              this.logger.log(`[refreshTrends] oEmbed: non-English CJK video rejected: "${oembed.title}"`);
              chosen = null;
            }
          }
        } catch { /* oembed network issue, proceed */ }
      }

      // Conditional niche creator search: only for breaking/viral topics if primary candidate failed or is null
      const isBreakingOrViral = (topic.publishedAt && (Date.now() - new Date(topic.publishedAt).getTime() < 24 * 60 * 60 * 1000)) || topic.sourceType === 'rss_news';
      if (!chosen && isBreakingOrViral) {
        const nicheQuota = await this.quota.canUse();
        if (nicheQuota.allowed) {
          try {
            const nicheQuery = `${extractedEntity} Court TV Law Crime`;
            const nicheResults = await this.youtubeService.searchVideos({
              userId: channel.userId.toString(),
              query: nicheQuery,
              publishedAfter: twentyOneDaysAgo,
              regionCode: 'US',
              maxResults: 3,
            });
            await this.quota.use();
            await this.quotaService.logCall({
              channelId, endpoint: 'refreshTrends (niche search.list)', quotaCost: 100, success: true,
            });
            if (nicheResults.length > 0) {
              const nicheCandidate = nicheResults[0];
              try {
                const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${nicheCandidate.videoId}&format=json`;
                const oembedRes = await fetch(oembedUrl);
                if (oembedRes.ok) {
                  const oembed: any = await oembedRes.json();
                  const hasCJK = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(oembed.title || '');
                  if (!hasCJK) {
                    chosen = nicheCandidate;
                  }
                }
              } catch {
                chosen = nicheCandidate;
              }
            }
          } catch { /* niche search optional */ }
        }
      }

      if (chosen) {
        base.youtubeVideoId = chosen.videoId;
        base.youtubeThumbnailUrl = chosen.thumbnailUrl;
        base.youtubeChannelTitle = chosen.channelTitle;
        base.youtubeVideoUrl = `https://www.youtube.com/watch?v=${chosen.videoId}`;
      }
    } catch (error) { this.logger.warn(`YouTube search failed: ${error.message}`); }
    return base;
  }

  private async batchGetViewCounts(videoIds: string[], channelId: string): Promise<Map<string, number>> {
    const viewMap = new Map<string, number>();
    if (videoIds.length === 0) return viewMap;
    const channel = await this.channelModel.findById(channelId).select('userId').lean();
    if (!channel?.userId) return viewMap;
    const accessToken = await this.youtubeService.getValidAccessToken(channel.userId.toString());
    const BATCH_SIZE = 50;
    for (let i = 0; i < videoIds.length; i += BATCH_SIZE) {
      try {
        const details = await this.youtubeService.getVideoDetails(accessToken, videoIds.slice(i, i + BATCH_SIZE));
        for (const d of details) viewMap.set(d.videoId, d.viewCount);
        await this.quotaService.logCall({
          channelId, endpoint: 'videos.list (batchGetViewCounts)', quotaCost: 1, success: true,
        });
      } catch (error) { this.logger.warn(`Batch view count failed: ${error.message}`); }
    }
    return viewMap;
  }

  private calculateOpportunityScore(topic: any, viewCounts: Map<string, number>, avgChannelViews: number): { score: number; label: string; badge?: string } {
    const isBreaking = (topic.publishedAt && (Date.now() - new Date(topic.publishedAt).getTime() < 24 * 60 * 60 * 1000)) || topic.sourceType === 'rss_news';

    if (!topic.youtubeVideoId) {
      if (!topic.extractedEntity) return { score: 30, label: 'Unknown', badge: isBreaking ? 'breaking' : undefined };
      return { score: 50, label: 'Unverified', badge: isBreaking ? 'breaking' : undefined };
    }

    const topViews = viewCounts.get(topic.youtubeVideoId) || 0;
    if (topViews === 0) return { score: 75, label: 'Low Competition', badge: 'gap' };

    const viewRatio = Math.min(1, avgChannelViews / (topViews + 1));
    const recencyBoost = topic.publishedAt ? Math.max(0, 1 - (Date.now() - new Date(topic.publishedAt).getTime()) / (21 * 24 * 60 * 60 * 1000)) : 0;
    const searchDemand = (topic.searchDemand || 0) / 100;
    const channelFit = (topic.channelFit || 50) / 100;

    const score = Math.min(100, Math.round(
      searchDemand * 30 +    // Real search behavior (autocomplete)
      viewRatio * 25 +        // Competition analysis (YouTube data)
      recencyBoost * 20 +     // Time sensitivity
      channelFit * 25         // Niche fit (RAG similarity)
    ));

    const badge = (score >= 80 || topViews > 50000) ? 'viral' : (isBreaking ? 'breaking' : undefined);

    if (score >= 80) return { score, label: 'High Opportunity', badge: 'viral' };
    if (score >= 50) return { score, label: 'Medium Opportunity', badge };
    return { score, label: 'Low Opportunity', badge };
  }

  /**
   * Calculate channel fit using ChromaDB RAG similarity against video catalog.
   * Free, consistent, deterministic — no extra API call.
   */
  private async calculateChannelFit(title: string, summary: string): Promise<number> {
    try {
      const queryText = `Title: ${title}\nSummary: ${summary}`;
      const results = await this.chromaService.query('video_metadata', queryText, 5);
      if (results.length === 0) return 50; // No data, neutral score

      const avgDistance = results.reduce((sum, r) => sum + r.distance, 0) / results.length;
      const similarity = Math.max(0, 1 - avgDistance); // distance → similarity
      return Math.round(similarity * 100);
    } catch {
      return 50; // Fallback to neutral
    }
  }

  /**
   * Lite refresh for chat auto-trigger.
   * Uses mostPopular (1 YouTube unit) + autocomplete (free).
   * No web search, no entity extraction, no search.list.
   * Cost: 1 YouTube unit total.
   */
  async refreshTrendsLite(channelId: string): Promise<any[]> {
    this.logger.log(`Lite trends refresh started for channel ${channelId}`);
    const channel = await this.channelModel.findById(channelId).lean();
    if (!channel?.userId) {
      this.logger.warn('Lite refresh: no userId on channel, skipping');
      return [];
    }

    // Step 1: Search YouTube for niche-relevant recent videos (100 quota units)
    const currentYear = new Date().getFullYear();
    const searchQueries = [
      `federal indictment ${currentYear}`,
      'rapper sentenced prison',
      'criminal case update',
    ];
    let allSearchResults: any[] = [];
    try {
      await this.quotaService.checkQuota(channelId, 'refreshTrendsLite (search)', 100);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      for (const query of searchQueries) {
        try {
          const results = await this.youtubeService.searchVideos({
            userId: channel.userId.toString(),
            query,
            publishedAfter: sevenDaysAgo,
            maxResults: 5,
          });
          allSearchResults.push(...results);
        } catch { /* individual query failure is ok */ }
      }
      await this.quotaService.logCall({
        channelId, endpoint: 'refreshTrendsLite (search)', quotaCost: 100, success: true,
      });
    } catch (error) {
      this.logger.warn(`Lite refresh: search failed: ${error.message}`);
      await this.quotaService.logCall({
        channelId, endpoint: 'refreshTrendsLite (search)', quotaCost: 100,
        success: false, errorMessage: error.message,
      }).catch(() => {});
      return [];
    }

    if (allSearchResults.length === 0) {
      this.logger.log('Lite refresh: no search results found');
      return [];
    }

    // Step 2: Filter out music videos, deduplicate, and apply relevance gate
    const musicVideoPatterns = ['official video', 'official music video', 'official audio'];
    const TIER1_LITE = [
      'indicted', 'convicted', 'sentenced', 'federal', 'prison', 'inmate',
      'racketeering', 'trafficking', 'guilty', 'plea', 'verdict', 'murder',
      'homicide', 'solitary', 'probation', 'parole', 'incarceration',
      'arrested', 'charges', 'felony', 'conspiracy', 'cartel',
    ];
    const seen = new Set<string>();
    const relevant = allSearchResults.filter(v => {
      const titleLower = v.title.toLowerCase();
      if (musicVideoPatterns.some(p => titleLower.includes(p))) return false;
      const key = titleLower.replace(/[^a-z0-9]/g, '').substring(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      // Relevance gate: must contain at least one Tier 1 criminal keyword
      if (!TIER1_LITE.some(kw => titleLower.includes(kw))) return false;
      return true;
    }).slice(0, 8);

    if (relevant.length === 0) {
      this.logger.log('Lite refresh: no niche-relevant videos found in search results');
      return [];
    }

    // Step 3: Autocomplete for search demand — free
    const demandQueries = relevant.map(v => {
      // Extract key entity from title (first 5 words)
      const words = v.title.replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
      return words.slice(0, 5).join(' ');
    });
    let searchDemandMap = new Map<string, number>();
    try {
      searchDemandMap = await this.suggestionsService.getSearchDemand(demandQueries);
    } catch (error) {
      this.logger.warn(`Lite refresh: autocomplete failed: ${error.message}`);
    }

    // Step 4: Deduplicate against existing DB topics (same day)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const oid = new Types.ObjectId(channelId);
    const existingTopics = await this.trendingTopicModel.find({
      $or: [{ channelId: oid }, { channelId }],
      fetchedAt: { $gte: todayStart },
    }).select('title').lean();
    const existingTitles = new Set(
      existingTopics.map(t => t.title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 60))
    );

    const newRelevant = relevant.filter(v => {
      const key = v.title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 60);
      return !existingTitles.has(key);
    });

    if (newRelevant.length === 0) {
      this.logger.log(`Lite refresh: all ${relevant.length} topics already exist in DB for today`);
      return [];
    }

    // Step 5: Store in DB — use consistent scoring with full refresh
    const avgChannelViews = channel ? Math.round(Number(channel.totalViews) / Math.max(channel.totalVideos, 1)) : 50000;
    const created = await Promise.all(newRelevant.map(v => {
      const entity = v.title.replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean).slice(0, 5).join(' ');
      const searchDemand = searchDemandMap.get(entity) || 0;
      // Use simplified multi-factor scoring consistent with full refresh
      // Lite doesn't have competition data, so viewRatio = 0, recencyBoost based on publishedAt
      const recencyBoost = v.publishedAt
        ? Math.max(0, 1 - (Date.now() - new Date(v.publishedAt).getTime()) / (21 * 24 * 60 * 60 * 1000))
        : 0;
      const score = Math.min(100, Math.round(
        (searchDemand / 100) * 50 +   // Search demand (50% weight — higher since no competition data)
        recencyBoost * 25 +             // Recency (25%)
        0.5 * 25                        // Neutral channel fit (25%)
      ));
      const label = score >= 80 ? 'High Opportunity' : score >= 50 ? 'Medium Opportunity' : 'Low Opportunity';
      const badge: 'viral' | 'gap' | 'breaking' | undefined = score >= 80 ? 'viral' : recencyBoost > 0.7 ? 'breaking' : 'gap';
      return this.trendingTopicModel.create({
        channelId: new Types.ObjectId(channelId),
        title: v.title,
        summary: `Trending on YouTube — ${(v.viewCount || 0).toLocaleString()} views by ${v.channelTitle || 'YouTube'}`,
        source: v.channelTitle,
        publishedAt: v.publishedAt ? new Date(v.publishedAt) : null,
        youtubeVideoId: v.videoId,
        youtubeThumbnailUrl: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
        youtubeChannelTitle: v.channelTitle,
        youtubeVideoUrl: `https://www.youtube.com/watch?v=${v.videoId}`,
        opportunityScore: score,
        opportunityLabel: label,
        searchDemand,
        channelFit: 50,
        sourceType: 'lite',
        badge,
      });
    }));

    this.logger.log(`Lite refresh complete: ${created.length} topics stored`);

    // Invalidate Redis cache keys for this channel
    try {
      await this.redisService.del(`trends:channel:${channelId}:days:all`);
      await this.redisService.del(`trends:channel:${channelId}:days:3`);
      await this.redisService.del(`trends:channel:${channelId}:days:5`);
      await this.redisService.del(`trends:channel:${channelId}:days:14`);
      this.logger.log(`Lite refresh: Invalidated Redis cache keys for channelId=${channelId}`);
    } catch { /* Cache invalidation optional */ }

    // Prune old lite topics
    const pruneBefore = new Date(Date.now() - TREND_HISTORY_DAYS * 24 * 60 * 60 * 1000);
    await this.trendingTopicModel.deleteMany({
      $or: [{ channelId: oid }, { channelId }],
      sourceType: 'lite',
      fetchedAt: { $lt: pruneBefore },
    });

    return created;
  }

  async seedThread(channelId: string, topicId: string) {
    const oid = new Types.ObjectId(channelId);
    const topic = await this.trendingTopicModel.findOne({ _id: topicId, $or: [{ channelId: oid }, { channelId }] }).lean();
    if (!topic) throw new Error('Trending topic not found or does not belong to this channel');

    const thread = await this.chatService.createThread(channelId, {
      title: `Trends: ${topic.title}`, type: 'standalone',
    });

    let context = `Topic: ${topic.title}\n\nContext: ${topic.summary}\n\nSource: ${topic.source || 'No source available'}`;
    if (topic.publishedAt) {
      const daysAgo = Math.round((Date.now() - new Date(topic.publishedAt).getTime()) / (24 * 60 * 60 * 1000));
      context += `\n\nPublished: ${new Date(topic.publishedAt).toISOString().split('T')[0]} (${daysAgo} days ago)`;
    }
    if (topic.opportunityLabel) context += `\n\nOpportunity Score: ${topic.opportunityScore}/100 — ${topic.opportunityLabel}`;
    if (topic.youtubeVideoId) context += `\n\nExisting YouTube coverage: ${topic.youtubeVideoUrl}\nChannel: ${topic.youtubeChannelTitle}`;

    await this.chatService.sendMessage(thread.id.toString(), {
      content: `I want to make a video about this trending story:\n\n${context}\n\nScore the idea using the 8-criteria system. Suggest a title and thumbnail text.`,
    });

    return this.chatService.findById(thread.id.toString());
  }

  /**
   * Helper: Clean AI output text and parse JSON array safely.
   * Handles markdown code fences, citations, conversational headers, and trailing text.
   */
  private extractCleanJsonArray(text: string): any[] {
    // 1. Remove markdown code fences
    let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

    // 2. Extract content between first '[' and last ']'
    const firstBracket = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      cleaned = cleaned.substring(firstBracket, lastBracket + 1);
    } else {
      throw new Error('No JSON array brackets "[" and "]" found in AI text response.');
    }

    // 3. Clean up common markdown citations embedded by search model, e.g. [1], [CNN](url)
    cleaned = cleaned.replace(/\[\d+\]/g, '');

    return JSON.parse(cleaned);
  }
}
