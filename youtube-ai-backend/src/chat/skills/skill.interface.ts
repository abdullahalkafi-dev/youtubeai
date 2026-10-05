export interface SkillContext {
  channelStats?: string;
  videoMetadata?: any;
  trendingTopics?: any[];
  topVideos?: any[];
  /**
   * Data-driven SEO patterns from the daily CTR sync (winners / misses /
   * baseline / traffic mix) — same source the details-page SEO uses.
   */
  seoPatterns?: {
    highCtrWinners: Array<{
      title: string;
      description?: string;
      views: number;
      ctr?: number;
      impressions?: number;
      tags?: string[];
    }>;
    lowCtrMisses: Array<{
      title: string;
      views: number;
      ctr?: number;
      impressions?: number;
    }>;
    channelBaselineCtr?: number;
    measuredCount: number;
    windowLabel: string;
    trafficMix?: Array<{ source: string; sharePct: number }>;
  };
  approvedSeoPatterns?: string;
  rejectedSeoPatterns?: string;
  recentActivity?: string;
  channelAnalytics?: {
    views: number;
    watchTimeHours: number;
    revenue: number;
    retentionPercent: number;
    trafficSources: Array<{ source: string; views: number }>;
    rawBundle?: string;
  };
  competitorSummary?: Array<{
    title: string;
    subscriberCount: number;
    lifetimeViews?: number;
    recentUploads: Array<{ title: string; publishedAt: string; viewCount?: number }>;
  }>;
  revivalOpportunities?: Array<{
    videoId: string;
    title: string;
    viewCount: number;
    publishedAt: string;
    searchTrafficViews: number;
  }>;
  existingVideos?: Array<{
    title: string;
    publishedAt: string;
    viewCount: number;
    youtubeId: string;
  }>;
  /** Autopsy vs channel diagnosis (from PerformanceContextService). */
  analysisMode?: 'autopsy' | 'diagnosis';
  performanceLookup?: string;
  /** Own last-14d winners vs below-median pattern (local DB, zero quota). */
  recentPattern?: string;
  /** Competitor videos we haven't covered, ranked by search demand (cached). */
  contentGaps?: Array<{
    topic: string;
    competitorChannel: string;
    competitorVideoTitle: string;
    competitorViews: number;
    searchDemand: number;
  }>;
  /** Local-market YouTube clips for B-roll (when location + footage need). */
  localScenePack?: {
    market: string;
    topic: string;
    stations: string[];
    clips: Array<{
      videoId: string;
      title: string;
      channelTitle: string;
      videoUrl: string;
      durationSeconds: number;
      viewCount: number;
    }>;
    formatted?: string;
  };
}

export interface ChatSkill {
  name: string;
  category: string;

  /** Static system prompt — byte-identical across requests for OpenAI caching. */
  buildSystemPrompt(channel: any, context: SkillContext): string;

  /** Dynamic context — changes per request. Goes in user message prefix, NOT system prompt. */
  buildDynamicContext?(channel: any, context: SkillContext): string;

  loadContext(channelId: string, videoId?: string): Promise<SkillContext>;
  getFormatInstructions(): string;

  /** Per-skill temperature. Default 0.7 if not set. */
  getTemperature?(): number;
}
