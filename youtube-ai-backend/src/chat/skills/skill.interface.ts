export interface SkillContext {
  channelStats?: string;
  videoMetadata?: any;
  trendingTopics?: any[];
  topVideos?: any[];
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
    recentUploads: Array<{ title: string; publishedAt: string }>;
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
