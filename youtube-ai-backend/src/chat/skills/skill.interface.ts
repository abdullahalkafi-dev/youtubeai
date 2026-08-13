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
