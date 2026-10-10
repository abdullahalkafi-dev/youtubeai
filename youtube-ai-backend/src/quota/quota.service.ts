import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Channel, ChannelDocument } from '../mongo/schemas/channel.schema';

export class QuotaExceededException extends Error {
  public readonly reason = 'quotaExceeded';
  /** Which wall tripped: full Data API 10k vs comments-only sub-budget. */
  public readonly scope: 'data_api' | 'comments_budget' | 'analytics';

  constructor(
    used: number,
    limit: number,
    endpoint: string,
    cost: number,
    scope: 'data_api' | 'comments_budget' | 'analytics' = 'data_api',
  ) {
    super(
      scope === 'comments_budget'
        ? `Comments daily budget exceeded: ${used}/${limit} used. Cannot call ${endpoint} (cost: ${cost}). Resets at midnight Pacific Time.`
        : `YouTube API quota exceeded: ${used}/${limit} used. Cannot call ${endpoint} (cost: ${cost}).`,
    );
    this.name = 'QuotaExceededException';
    this.scope = scope;
  }
}

@Injectable()
export class QuotaService {
  private readonly logger = new Logger(QuotaService.name);
  private readonly YOUTUBE_DAILY_LIMIT = 10000;
  private readonly COMMENTS_DAILY_BUDGET = parseInt(
    process.env.COMMENTS_DAILY_QUOTA_BUDGET || '5500',
    10,
  );
  /** After Google says quota exceeded — pause Data API work until next PT midnight */
  private dataApiExhaustedUntil: Date | null = null;
  /** Comments-only sub-budget wall — does not stop SEO/trends/sync. */
  private commentsBudgetExhaustedUntil: Date | null = null;

  constructor(
    @InjectModel(Channel.name) private readonly channelModel: Model<ChannelDocument>,
  ) {}

  markDataApiExhaustedToday(reason?: string): void {
    const until = new Date(this.getPTMidnight().getTime() + 24 * 60 * 60 * 1000);
    if (!this.dataApiExhaustedUntil || this.dataApiExhaustedUntil.getTime() < until.getTime()) {
      this.dataApiExhaustedUntil = until;
    }
    // Full Data API wall also stops comments (they share Google's 10k).
    this.markCommentsBudgetExhaustedToday(reason || 'data-api');
    this.logger.warn(`YouTube Data API quota exhausted — pausing Data API jobs until ${until.toISOString()}${reason ? ` (${reason})` : ''}`);
  }

  isDataApiExhausted(): boolean {
    return Boolean(this.dataApiExhaustedUntil) && Date.now() < this.dataApiExhaustedUntil!.getTime();
  }

  markCommentsBudgetExhaustedToday(reason?: string): void {
    const until = new Date(this.getPTMidnight().getTime() + 24 * 60 * 60 * 1000);
    if (!this.commentsBudgetExhaustedUntil || this.commentsBudgetExhaustedUntil.getTime() < until.getTime()) {
      this.commentsBudgetExhaustedUntil = until;
    }
    this.logger.warn(
      `Comments daily budget exhausted — pausing comment list/insert until ${until.toISOString()}${reason ? ` (${reason})` : ''}`,
    );
  }

  isCommentsBudgetExhausted(): boolean {
    return Boolean(this.commentsBudgetExhaustedUntil) && Date.now() < this.commentsBudgetExhaustedUntil!.getTime();
  }

  private isCommentEndpoint(endpoint: string): boolean {
    return /comment/i.test(String(endpoint || ''));
  }

  /**
   * search.list family — Google meters these on a SEPARATE 100-calls/day bucket
   * (console row "Search Queries per day"), NOT against the 10,000 units/day.
   * Matches: 'search.list (...)', 'refreshTrends (search.list)', 'refreshTrendsLite (search)'.
   */
  private isSearchEndpoint(endpoint: string): boolean {
    return /search\.list|\(search\)/i.test(String(endpoint || ''));
  }

  private readonly SEARCH_DAILY_CALL_LIMIT = parseInt(
    process.env.SEARCH_DAILY_CALL_LIMIT || '80',
    10,
  );

  /**
   * Pre-check: verify quota is available before making a YouTube API call.
   * Throws QuotaExceededException if over limit.
   */
  async checkQuota(channelId: string, endpoint: string, cost: number): Promise<void> {
    if (this.isDataApiExhausted()) {
      throw new QuotaExceededException(this.YOUTUBE_DAILY_LIMIT, this.YOUTUBE_DAILY_LIMIT, endpoint, cost, 'data_api');
    }
    if (this.isCommentEndpoint(endpoint)) {
      await this.checkCommentsBudget(channelId, endpoint, cost);
      return;
    }
    if (this.isSearchEndpoint(endpoint)) {
      // Separate Google bucket: project-wide 80 search.list CALLS/day
      const search = await this.getSearchDailyUsage();
      const calls = Math.max(1, Math.ceil(cost / 100));
      if (search.used + calls > search.limit) {
        this.logger.warn(
          `Search query check failed: ${search.used}/${search.limit} calls used, ${endpoint} needs ${calls}`,
        );
        throw new QuotaExceededException(search.used, search.limit, endpoint, calls, 'data_api');
      }
      return;
    }
    const { used } = await this.getDailyUsage(channelId);
    if (used + cost > this.YOUTUBE_DAILY_LIMIT) {
      this.logger.warn(`Quota check failed: ${used}/${this.YOUTUBE_DAILY_LIMIT} used, ${endpoint} needs ${cost}`);
      this.markDataApiExhaustedToday('pre-check');
      throw new QuotaExceededException(used, this.YOUTUBE_DAILY_LIMIT, endpoint, cost, 'data_api');
    }
  }

  /**
   * Comments-only sub-budget (default 4500/day). Stops comment list+insert without
   * pausing SEO/trends/sync. Also respects the global Data API wall.
   */
  async checkCommentsBudget(channelId: string, endpoint: string, cost: number): Promise<void> {
    if (this.isDataApiExhausted()) {
      throw new QuotaExceededException(this.YOUTUBE_DAILY_LIMIT, this.YOUTUBE_DAILY_LIMIT, endpoint, cost, 'data_api');
    }
    if (this.isCommentsBudgetExhausted()) {
      throw new QuotaExceededException(
        this.COMMENTS_DAILY_BUDGET,
        this.COMMENTS_DAILY_BUDGET,
        endpoint,
        cost,
        'comments_budget',
      );
    }
    const { used } = await this.getCommentsDailyUsage(channelId);
    if (used + cost > this.COMMENTS_DAILY_BUDGET) {
      this.logger.warn(
        `Comments budget check failed: ${used}/${this.COMMENTS_DAILY_BUDGET} used, ${endpoint} needs ${cost}`,
      );
      this.markCommentsBudgetExhaustedToday('pre-check');
      throw new QuotaExceededException(used, this.COMMENTS_DAILY_BUDGET, endpoint, cost, 'comments_budget');
    }
  }

  async logCall(params: {
    channelId: string;
    endpoint: string;
    quotaCost: number;
    relatedId?: string;
    success?: boolean;
    errorMessage?: string;
    apiType?: 'youtube_data' | 'youtube_analytics';
  }): Promise<void> {
    if (params.errorMessage && /quotaExceeded|rateLimitExceeded/i.test(params.errorMessage)) {
      // Google's wall is global. Comments-only budget messages also say "quota" —
      // only trip the full Data API pause for non-comment endpoints or real Google errors.
      if (this.isCommentEndpoint(params.endpoint) && /comments daily budget/i.test(params.errorMessage)) {
        this.markCommentsBudgetExhaustedToday(params.endpoint);
      } else {
        this.markDataApiExhaustedToday(params.endpoint);
      }
    }
    try {
      const model = this.channelModel.db.model('ApiQuotaLog') as any;
      let targetChannelId: any = undefined;
      let targetYoutubeChannelId: string | undefined = undefined;

      if (params.channelId) {
        if (Types.ObjectId.isValid(params.channelId)) {
          targetChannelId = new Types.ObjectId(params.channelId);
        } else {
          targetYoutubeChannelId = params.channelId;
          const ch = await this.channelModel
            .findOne({ youtubeChannelId: params.channelId })
            .select('_id')
            .lean();
          if (ch?._id) {
            targetChannelId = ch._id;
          }
        }
      }

      await model.create({
        channelId: targetChannelId,
        youtubeChannelId: targetYoutubeChannelId,
        endpoint: params.endpoint,
        quotaCost: params.quotaCost,
        relatedId: params.relatedId,
        success: params.success ?? true,
        errorMessage: params.errorMessage,
        apiType: params.apiType || 'youtube_data',
      });
    } catch (error) {
      this.logger.error(`Failed to log quota call: ${error.message}`);
    }
  }

  async logAnalyticsCall(params: {
    channelId: string;
    endpoint: string;
    relatedId?: string;
    success?: boolean;
    errorMessage?: string;
  }): Promise<void> {
    await this.logCall({
      channelId: params.channelId,
      endpoint: params.endpoint,
      quotaCost: 1,
      apiType: 'youtube_analytics',
      relatedId: params.relatedId,
      success: params.success ?? true,
      errorMessage: params.errorMessage,
    });
    this.logger.log(`[YouTube Analytics Quota] 1 query logged for ${params.relatedId || 'video'} on channel ${params.channelId} (apiType: youtube_analytics, 0 Data units)`);
  }

  /**
   * Pre-check: verify analytics quota is available before making a YouTube Analytics API call.
   */
  async checkAnalyticsQuota(channelId: string, endpoint: string): Promise<void> {
    const { used, limit } = await this.getAnalyticsDailyUsage(channelId);
    if (used + 1 > limit) {
      this.logger.warn(`Analytics quota check failed: ${used}/${limit} used, cannot call ${endpoint}`);
      throw new QuotaExceededException(used, limit, endpoint, 1);
    }
  }

  async getDailyUsage(channelId: string) {
    const ptMidnight = this.getPTMidnight();
    const model = this.channelModel.db.model('ApiQuotaLog') as any;
    const isObjId = Types.ObjectId.isValid(channelId);
    const cId = isObjId ? new Types.ObjectId(channelId) : null;
    const channelMatch = cId
      ? { $or: [{ channelId: cId }, { channelId }] }
      : { $or: [{ youtubeChannelId: channelId }, { channelId }] };

    // Strictly exclude 'youtube_analytics' so Analytics queries NEVER count against the 10,000 Data API daily limit!
    // Also exclude search.list family — Google meters those on the separate 100-calls/day bucket.
    const breakdown = await model.aggregate([
      {
        $match: {
          ...channelMatch,
          calledAt: { $gte: ptMidnight },
          apiType: { $ne: 'youtube_analytics' },
          endpoint: { $not: /search\.list|\(search\)/ },
        },
      },
      { $group: { _id: '$endpoint', total: { $sum: '$quotaCost' } } },
    ]);

    const used = breakdown.reduce((sum: number, b: any) => sum + (b.total || 0), 0);
    const breakdownMap: Record<string, number> = {};
    for (const b of breakdown) {
      breakdownMap[b._id] = b.total || 0;
    }

    return { used, limit: this.YOUTUBE_DAILY_LIMIT, breakdown: breakdownMap };
  }

  /**
   * search.list CALLS made today (PT day window — matches Google's midnight-PT reset).
   * Project-wide count: all search queries across all channels since PT midnight.
   */
  async getSearchDailyUsage(channelId?: string) {
    const ptMidnight = this.getPTMidnight();
    const model = this.channelModel.db.model('ApiQuotaLog') as any;

    const used = await model.countDocuments({
      calledAt: { $gte: ptMidnight },
      endpoint: /search\.list|\(search\)/,
    });

    return { used, limit: this.SEARCH_DAILY_CALL_LIMIT };
  }

  /**
   * Global (all-channels) count of log rows for one endpoint since PT midnight.
   * Used for per-feature daily caps (e.g. footage search ≤25/day) on top of the
   * shared 100-calls/day search.list bucket.
   */
  async countEndpointCallsToday(endpoint: string | RegExp): Promise<number> {
    try {
      const ptMidnight = this.getPTMidnight();
      const model = this.channelModel.db.model('ApiQuotaLog') as any;
      return await model.countDocuments({
        endpoint,
        calledAt: { $gte: ptMidnight },
      });
    } catch (err: any) {
      this.logger.warn(`countEndpointCallsToday failed: ${err?.message || err}`);
      return 0;
    }
  }

  /** Sum of comment-related Data API units today (list + insert). */
  async getCommentsDailyUsage(channelId: string) {
    const ptMidnight = this.getPTMidnight();
    const model = this.channelModel.db.model('ApiQuotaLog') as any;
    const isObjId = Types.ObjectId.isValid(channelId);
    const cId = isObjId ? new Types.ObjectId(channelId) : null;
    const channelMatch = cId
      ? { $or: [{ channelId: cId }, { channelId }] }
      : { $or: [{ youtubeChannelId: channelId }, { channelId }] };

    const breakdown = await model.aggregate([
      {
        $match: {
          ...channelMatch,
          calledAt: { $gte: ptMidnight },
          apiType: { $ne: 'youtube_analytics' },
          endpoint: /comment/i,
        },
      },
      { $group: { _id: '$endpoint', total: { $sum: '$quotaCost' } } },
    ]);

    const used = breakdown.reduce((sum: number, b: any) => sum + (b.total || 0), 0);
    const breakdownMap: Record<string, number> = {};
    for (const b of breakdown) {
      breakdownMap[b._id] = b.total || 0;
    }

    return { used, limit: this.COMMENTS_DAILY_BUDGET, breakdown: breakdownMap };
  }

  async getAnalyticsDailyUsage(channelId: string) {
    const ptMidnight = this.getPTMidnight();
    const model = this.channelModel.db.model('ApiQuotaLog') as any;
    const isObjId = Types.ObjectId.isValid(channelId);
    const cId = isObjId ? new Types.ObjectId(channelId) : null;
    const channelMatch = cId
      ? { $or: [{ channelId: cId }, { channelId }] }
      : { $or: [{ youtubeChannelId: channelId }, { channelId }] };

    const breakdown = await model.aggregate([
      {
        $match: {
          ...channelMatch,
          calledAt: { $gte: ptMidnight },
          apiType: 'youtube_analytics',
        },
      },
      { $group: { _id: '$endpoint', total: { $sum: { $ifNull: ['$quotaCost', 1] } } } },
    ]);

    const used = breakdown.reduce((sum: number, b: any) => sum + (b.total || 0), 0);
    const breakdownMap: Record<string, number> = {};
    for (const b of breakdown) {
      breakdownMap[b._id] = b.total || 0;
    }

    return { used, limit: 100000, breakdown: breakdownMap };
  }

  async getTodayEndpointCount(channelId: string, endpoint: string): Promise<number> {
    const ptMidnight = this.getPTMidnight();
    const model = this.channelModel.db.model('ApiQuotaLog') as any;
    const cId = Types.ObjectId.isValid(channelId) ? new Types.ObjectId(channelId) : channelId;
    return model.countDocuments({
      $or: [{ channelId: cId }, { channelId }],
      endpoint,
      calledAt: { $gte: ptMidnight },
      success: { $ne: false },
    });
  }

  async getRecentLogs(channelId: string, limit = 50) {
    const model = this.channelModel.db.model('ApiQuotaLog') as any;
    const cId = Types.ObjectId.isValid(channelId) ? new Types.ObjectId(channelId) : channelId;
    return model.find({ $or: [{ channelId: cId }, { channelId }] }).sort({ calledAt: -1 }).limit(limit).lean();
  }

  getPTMidnight(): Date {
    const now = new Date();
    // Get current calendar date in America/Los_Angeles (format YYYY-MM-DD)
    const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now);
    const [year, month, day] = dateStr.split('-').map(Number);

    // Calculate minute difference between UTC and PT at current instant
    const ptDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
    const diffMinutes = Math.round((utcDate.getTime() - ptDate.getTime()) / 60000);

    // Midnight PT in UTC is [YYYY-MM-DD 00:00:00 UTC] + diffMinutes
    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0) + diffMinutes * 60000);
  }
}
