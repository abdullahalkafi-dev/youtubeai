import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Video, VideoDocument } from '../mongo/schemas/video.schema';
import { Channel, ChannelDocument } from '../mongo/schemas/channel.schema';
import { YoutubeAnalyticsService } from '../youtube/youtube-analytics.service';

export interface PerformanceBundleText {
  text: string;
  ok: boolean;
}

/**
 * Builds rich YouTube Analytics context for AI (cheap API calls).
 * Also resolves a single video for on-demand "how is this video doing" lookups.
 */
@Injectable()
export class PerformanceContextService {
  private readonly logger = new Logger(PerformanceContextService.name);

  constructor(
    private readonly analytics: YoutubeAnalyticsService,
    @InjectModel(Video.name) private readonly videoModel: Model<VideoDocument>,
    @InjectModel(Channel.name) private readonly channelModel: Model<ChannelDocument>,
  ) {}

  private dateWindow(days: number) {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    return { startDate, endDate };
  }

  /**
   * Channel-level "what people watch / how they find it / who they are" block for prompts.
   */
  async buildChannelPerformanceContext(
    userId: string,
    channelId: string,
    days = 30,
  ): Promise<PerformanceBundleText> {
    try {
      const channel = await this.channelModel.findById(channelId).lean();
      if (!channel?.youtubeChannelId || !channel.userId) {
        return { text: 'YOUTUBE ANALYTICS: unavailable (channel not linked).', ok: false };
      }

      const uid = channel.userId.toString();
      const ytChannelId = channel.youtubeChannelId;
      const { startDate, endDate } = this.dateWindow(days);

      const [trafficSources, topVideos, searchTerms, audience] = await Promise.all([
        this.analytics.getTrafficSources(uid, ytChannelId, startDate, endDate),
        this.analytics.getTopVideosByWatchTime(uid, ytChannelId, startDate, endDate, 8),
        this.analytics.getTopSearchTerms(uid, ytChannelId, startDate, endDate, 8),
        this.analytics.getAudienceBreakdown(uid, ytChannelId, startDate, endDate),
      ]);

      if (!trafficSources.length && !topVideos.length) {
        return {
          text: `YOUTUBE ANALYTICS (${days} days): no rows returned (empty channel analytics window or API limit). Use EXISTING VIDEOS + public research only.`,
          ok: false,
        };
      }

      const lines: string[] = [];
      lines.push(`YOUTUBE ANALYTICS — this channel (last ${days} days: ${startDate} → ${endDate})`);
      lines.push(
        'This is owned channel performance from the YouTube Analytics API (not raw viewer watch history). Use it for strategy and ideas. Never claim you cannot see channel performance when this block is present.',
      );
      lines.push('');
      lines.push('WHAT VIEWERS WATCH MOST ON THIS CHANNEL:');
      if (topVideos.length) {
        topVideos.forEach((v, i) => {
          lines.push(
            `${i + 1}. "${v.title}" — ${v.views.toLocaleString()} views | ${Math.round(v.watchMinutes).toLocaleString()} watch min | ${Math.round(v.retentionPercent)}% avg viewed`,
          );
        });
      } else {
        lines.push('(no top-video rows)');
      }

      lines.push('');
      lines.push('TRAFFIC SOURCES (how they find the channel):');
      if (trafficSources.length) {
        lines.push(
          trafficSources
            .slice(0, 8)
            .map((t) => `- ${t.source}: ${t.views.toLocaleString()} views, ${Math.round(t.watchMinutes).toLocaleString()} min`)
            .join('\n'),
        );
      } else {
        lines.push('(none)');
      }

      if (searchTerms.length) {
        lines.push('');
        lines.push('TOP YOUTUBE SEARCH TERMS:');
        lines.push(searchTerms.map((s) => `- "${s.term}" (${s.views.toLocaleString()} views)`).join('\n'));
      }

      if (audience.ageGroups.length || audience.genders.length || audience.countries.length || audience.subscribed.length) {
        lines.push('');
        lines.push('AUDIENCE (estimated, logged-in where available):');
        if (audience.ageGroups.length) {
          lines.push(
            `Age: ${audience.ageGroups.map((a) => `${a.group} ${a.views.toLocaleString()}`).join(' | ')}`,
          );
        }
        if (audience.genders.length) {
          lines.push(`Gender: ${audience.genders.map((g) => `${g.gender} ${g.views.toLocaleString()}`).join(' | ')}`);
        }
        if (audience.countries.length) {
          lines.push(`Top countries: ${audience.countries.map((c) => `${c.country} ${c.views.toLocaleString()}`).join(' | ')}`);
        }
        if (audience.subscribed.length) {
          lines.push(
            `Subscribed vs not: ${audience.subscribed.map((s) => `${s.status} ${s.views.toLocaleString()}`).join(' | ')}`,
          );
        }
      }

      lines.push('');
      lines.push(
        'NOT available (privacy / Studio-only): individual viewer watch history; Studio “other videos your audience watched” on other channels. Do not hard-refuse — answer with the data above.',
      );

      return { text: lines.join('\n'), ok: true };
    } catch (err: any) {
      this.logger.warn(`Channel performance context failed: ${err?.message || err}`);
      return {
        text: 'YOUTUBE ANALYTICS: temporarily unavailable. Say data is limited; do not pretend Studio access; still use EXISTING VIDEOS and trends.',
        ok: false,
      };
    }
  }

  /**
   * Find a channel video from a natural-language question ("this video", title fragment).
   */
  async findVideoFromQuery(channelId: string, query: string): Promise<(VideoDocument & { _id: any }) | null> {
    const cId = channelId as any;
    const q = String(query || '');
    if (!q.trim()) return null;

    // Explicit YouTube id (11 chars) in the message
    const idMatch = q.match(/(?:v=|youtu\.be\/|\/videos\/)([A-Za-z0-9_-]{11})/);
    if (idMatch && idMatch[1]) {
      const byYt = await this.videoModel.findOne({ channelId: cId, youtubeId: idMatch[1] }).lean();
      if (byYt) return byYt as any;
    }

    // "this video" in a video-scoped thread is handled by caller with videoId.

    // Longest quoted title-like span
    const quoted = q.match(/"([^"]{4,120})"/);
    const titleHint = (quoted?.[1] || q).toLowerCase();

    // Prefer videos whose title tokens overlap the query
    const stop = new Set(['the', 'a', 'an', 'this', 'that', 'video', 'my', 'is', 'how', 'what', 'why', 'are', 'get', 'gets', 'getting', 'views', 'view', 'doing', 'performance', 'analytics', 'for', 'on', 'of', 'and', 'or', 'to', 'in', 'it']);
    const tokens = titleHint
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !stop.has(t));

    if (!tokens.length) return null;

    const candidates = await this.videoModel
      .find({ channelId: cId, deletedFromYoutube: { $ne: true } })
      .select('title youtubeId publishedAt viewCount description')
      .sort({ publishedAt: -1 })
      .limit(200)
      .lean();

    let best: any = null;
    let bestScore = 0;
    for (const v of candidates) {
      const title = String(v.title || '').toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (title.includes(t)) score += 2;
        else if (title.startsWith(t.slice(0, 5))) score += 1;
      }
      if (titleHint.length > 8 && title.includes(titleHint.slice(0, 18))) score += 3;
      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    }

    return bestScore >= 2 ? (best as any) : null;
  }

  /**
   * On-demand single-video performance (MCP-style tool result for the model).
   */
  async buildVideoPerformanceLookup(
    userId: string,
    channelId: string,
    query: string,
    videoId?: string,
  ): Promise<PerformanceBundleText | null> {
    try {
      const channel = await this.channelModel.findById(channelId).lean();
      if (!channel?.youtubeChannelId) return null;

      let video: any = null;
      if (videoId) {
        video = await this.videoModel.findById(videoId).lean();
      }
      if (!video?.youtubeId) {
        video = await this.findVideoFromQuery(channelId, query);
      }
      if (!video?.youtubeId) return null;

      const uid = channel.userId.toString();
      const ytChannelId = channel.youtubeChannelId;
      const { startDate, endDate } = this.dateWindow(28);

      const [life, window28, traffic] = await Promise.all([
        this.analytics.getSingleVideoAnalytics(uid, ytChannelId, video.youtubeId).catch(() => null),
        this.analytics
          .getTopVideosByWatchTime(uid, ytChannelId, startDate, endDate, 50)
          .then((rows) => rows.find((r) => r.videoId === video.youtubeId) || null)
          .catch(() => null),
        this.analytics
          .getTrafficSources(uid, ytChannelId, startDate, endDate)
          .catch(() => [] as Array<{ source: string; views: number; watchMinutes: number; subsGained: number }>),
      ]);

      const lines: string[] = [];
      lines.push('VIDEO PERFORMANCE LOOKUP (YouTube Analytics API + local catalog)');
      lines.push(`Title: "${video.title}"`);
      lines.push(`YouTube ID: ${video.youtubeId}`);
      if (video.publishedAt) lines.push(`Published: ${new Date(video.publishedAt).toISOString().split('T')[0]}`);
      if (video.viewCount !== undefined) lines.push(`Catalog views (synced): ${Number(video.viewCount).toLocaleString()}`);
      if (video.avgWatchTime) lines.push(`Avg watch (synced sec): ${video.avgWatchTime}`);
      if (video.retentionPercent) lines.push(`Retention (synced %): ${video.retentionPercent}`);

      if (life) {
        lines.push(
          `Lifetime analytics: ${life.views.toLocaleString()} views | ${Math.round(life.estimatedMinutesWatched).toLocaleString()} watch min | ${Math.round(life.averageViewPercentage)}% avg viewed | ~$${(life.estimatedRevenue || 0).toFixed(2)}`,
        );
      }
      if (window28) {
        lines.push(
          `Last 28 days: ${window28.views.toLocaleString()} views | ${Math.round(window28.watchMinutes).toLocaleString()} watch min | ${Math.round(window28.retentionPercent)}% avg viewed`,
        );
      }
      if (traffic.length) {
        lines.push('Channel traffic mix (context, last 28d): ' + traffic.slice(0, 5).map((t) => `${t.source} ${t.views}`).join(', '));
      }
      lines.push('Use these numbers to answer “what is this video getting” — do not say you cannot see analytics.');

      return { text: lines.join('\n'), ok: true };
    } catch (err: any) {
      this.logger.warn(`Video performance lookup failed: ${err?.message || err}`);
      return null;
    }
  }

  /** Heuristic: does this chat message want performance/analytics data? */
  static isPerformanceQuery(message: string): boolean {
    const lower = String(message || '').toLowerCase();
    return /\b(views?|watch time|watchtime|retention|analytics|performance|how (is|are|was) (this|that|my|the) video|getting views|audience|search terms?|traffic|ctr|impressions|what (videos?|content) (do|does) (my|the) (channel|audience)|what my)\b/i.test(
      lower,
    );
  }
}
