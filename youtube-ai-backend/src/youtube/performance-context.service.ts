import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Video, VideoDocument } from '../mongo/schemas/video.schema';
import { Channel, ChannelDocument } from '../mongo/schemas/channel.schema';
import { YoutubeAnalyticsService } from '../youtube/youtube-analytics.service';

export interface PerformanceBundleText {
  text: string;
  ok: boolean;
  topVideos?: Array<{
    title: string;
    viewCount: number;
    watchMinutes: number;
    retentionPercent: number;
    revenue: number;
  }>;
  trafficSources?: Array<{ source: string; views: number }>;
  summary?: { views: number; watchTimeHours: number; revenue: number; retentionPercent: number };
  /** When set, chat should run Autopsy + Repackage Kit format. */
  mode?: 'autopsy';
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

      return {
        text: lines.join('\n'),
        ok: true,
        topVideos: topVideos.map((v) => ({
          title: v.title,
          viewCount: v.views,
          watchMinutes: v.watchMinutes,
          retentionPercent: v.retentionPercent,
          revenue: v.revenue,
        })),
        trafficSources: trafficSources.slice(0, 8).map((t) => ({ source: t.source, views: t.views })),
        summary: {
          views: trafficSources.reduce((s, t) => s + (t.views || 0), 0),
          watchTimeHours: Math.round(trafficSources.reduce((s, t) => s + (t.watchMinutes || 0), 0) / 60),
          revenue: Math.round(topVideos.reduce((s, v) => s + (v.revenue || 0), 0) * 100) / 100,
          retentionPercent:
            topVideos.length > 0
              ? Math.round(topVideos.reduce((s, v) => s + (v.retentionPercent || 0), 0) / topVideos.length)
              : 0,
        },
      };
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
   * Returns score so callers can prefer a strong title match over the thread's video.
   */
  async findVideoFromQuery(
    channelId: string,
    query: string,
  ): Promise<{ video: any; score: number } | null> {
    const cId = channelId as any;
    const q = String(query || '');
    if (!q.trim()) return null;

    // Explicit YouTube id (11 chars) in the message
    const idMatch = q.match(/(?:v=|youtu\.be\/|\/videos\/)([A-Za-z0-9_-]{11})/);
    if (idMatch && idMatch[1]) {
      const byYt = await this.videoModel.findOne({ channelId: cId, youtubeId: idMatch[1] }).lean();
      if (byYt) return { video: byYt, score: 100 };
    }

    const quoted = q.match(/"([^"]{4,120})"/);
    const titleHint = (quoted?.[1] || q).toLowerCase();

    const stop = new Set(['the', 'a', 'an', 'this', 'that', 'video', 'my', 'is', 'how', 'what', 'why', 'are', 'get', 'gets', 'getting', 'views', 'view', 'doing', 'performance', 'analytics', 'for', 'on', 'of', 'and', 'or', 'to', 'in', 'it', 'can', 'you', 'tell', 'about', 'with', 'from', 'last', 'week', 'month', 'today']);
    const tokens = titleHint
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !stop.has(t));

    if (!tokens.length) return null;

    const candidates = await this.videoModel
      .find({ channelId: cId, deletedFromYoutube: { $ne: true } })
      .select('title youtubeId publishedAt viewCount description avgWatchTime retentionPercent')
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
        else if (t.length >= 5 && title.includes(t.slice(0, 5))) score += 1;
      }
      if (titleHint.length > 8 && title.includes(titleHint.slice(0, 18))) score += 4;
      // Quoted exact-ish title is a strong signal
      if (quoted?.[1] && title.includes(quoted[1].toLowerCase())) score += 5;
      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    }

    // Require a stronger match to avoid injecting the wrong video's numbers (C4)
    return bestScore >= 4 && best ? { video: best, score: bestScore } : null;
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
      // Safe ObjectId only (C10)
      if (videoId && Types.ObjectId.isValid(videoId)) {
        video = await this.videoModel.findById(videoId).lean();
      }

      // Strong title/id match in the question wins over the thread's default video (C3)
      const matched = await this.findVideoFromQuery(channelId, query);
      if (matched && matched.score >= 6) {
        video = matched.video;
      } else if (!video?.youtubeId && matched) {
        video = matched.video;
      }

      if (!video?.youtubeId) return null;

      const uid = channel.userId?.toString();
      if (!uid) return null;
      const ytChannelId = channel.youtubeChannelId;
      const { startDate, endDate } = this.dateWindow(28);

      const [life, window28, traffic] = await Promise.all([
        this.analytics.getVideoPackagingMetrics(uid, ytChannelId, video.youtubeId).catch(() => null),
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
      if (matched && matched.score >= 6) {
        lines.push('(Matched from your question wording — if you meant a different video, say the exact title.)');
      } else if (videoId) {
        lines.push('(Using the video attached to this chat thread.)');
      }
      if (video.publishedAt) lines.push(`Published: ${new Date(video.publishedAt).toISOString().split('T')[0]}`);
      if (video.viewCount !== undefined) lines.push(`Catalog views (synced): ${Number(video.viewCount).toLocaleString()}`);
      if (video.avgWatchTime) lines.push(`Avg watch (synced sec): ${video.avgWatchTime}`);
      if (video.retentionPercent) lines.push(`Retention (synced %): ${video.retentionPercent}`);

      if (life) {
        const ctrStr =
          life.impressionsClickThroughRate != null && life.impressionsClickThroughRate > 0
            ? ` | CTR ${life.impressionsClickThroughRate.toFixed(1)}%`
            : ' | CTR n/a';
        const impStr =
          life.impressions != null && life.impressions > 0
            ? ` | ${Math.round(life.impressions).toLocaleString()} impressions`
            : '';
        lines.push(
          `Lifetime analytics: ${life.views.toLocaleString()} views${impStr}${ctrStr} | ${Math.round(life.estimatedMinutesWatched).toLocaleString()} watch min | ${Math.round(life.averageViewPercentage)}% avg viewed | ~$${(life.estimatedRevenue || 0).toFixed(2)}`,
        );
      }
      if (window28) {
        lines.push(
          `Last 28 days: ${window28.views.toLocaleString()} views | ${Math.round(window28.watchMinutes).toLocaleString()} watch min | ${Math.round(window28.retentionPercent)}% avg viewed`,
        );
      }

      // Packaging baseline + peer set (for autopsy / repackage)
      try {
        const { startDate: baseStart, endDate: baseEnd } = this.dateWindow(28);
        const [baseline, packagingRows] = await Promise.all([
          this.analytics.getChannelPackagingBaseline(uid, ytChannelId, baseStart, baseEnd),
          this.analytics.getVideoPackagingRows(uid, ytChannelId, baseStart, baseEnd, 25),
        ]);
        if (baseline.impressionsClickThroughRate > 0 || baseline.views > 0) {
          lines.push('');
          lines.push(
            `CHANNEL BASELINE (28d): median target CTR ${baseline.impressionsClickThroughRate.toFixed(1)}% | avg ${Math.round(baseline.averageViewPercentage)}% viewed | ${baseline.impressions.toLocaleString()} impressions | ${baseline.views.toLocaleString()} views`,
          );
        }
        const peers = packagingRows
          .filter((r) => r.videoId !== video.youtubeId && r.views > 0)
          .slice(0, 3);
        if (peers.length) {
          lines.push('SIBLING / RECENT VIDEOS (28d window — compare packaging + retention):');
          peers.forEach((r, i) => {
            lines.push(
              `${i + 1}. "${r.title}" — ${r.views.toLocaleString()} views | imp ${Math.round(r.impressions).toLocaleString()} | CTR ${r.ctr.toFixed(1)}% | ${Math.round(r.averageViewPercentage)}% viewed`,
            );
          });
        }
        const selfRow = packagingRows.find((r) => r.videoId === video.youtubeId);
        if (selfRow) {
          lines.push(
            `THIS VIDEO (28d window): ${selfRow.views.toLocaleString()} views | imp ${Math.round(selfRow.impressions).toLocaleString()} | CTR ${selfRow.ctr.toFixed(1)}% | ${Math.round(selfRow.averageViewPercentage)}% viewed`,
          );
          const ctrDelta = selfRow.ctr - baseline.impressionsClickThroughRate;
          if (baseline.impressionsClickThroughRate > 0) {
            lines.push(
              `CTR vs baseline: ${ctrDelta >= 0 ? '+' : ''}${ctrDelta.toFixed(1)} pts (${ctrDelta < -0.5 ? 'BELOW baseline — packaging is a lever' : ctrDelta > 0.5 ? 'above baseline' : 'near baseline'})`,
            );
          }
          // Persist packaging fields on catalog (non-blocking)
          this.videoModel
            .updateOne(
              { _id: video._id },
              {
                $set: {
                  ctr: selfRow.ctr,
                  impressions: Math.round(selfRow.impressions),
                  retentionPercent: Math.round(selfRow.averageViewPercentage),
                  lastAnalyticsSync: new Date(),
                },
              },
            )
            .catch(() => {});
        }
      } catch (pkgErr: any) {
        this.logger.warn(`Packaging context skipped: ${pkgErr?.message || pkgErr}`);
      }

      if (traffic.length) {
        lines.push('Channel traffic mix (context, last 28d): ' + traffic.slice(0, 5).map((t) => `${t.source} ${t.views}`).join(', '));
      }
      if (!life && !window28) {
        lines.push('No Analytics rows for this video in the queried windows — use catalog stats and say the range is empty.');
      }
      lines.push('Use these numbers to answer “what is this video getting” — do not say you cannot see analytics.');
      lines.push('If asked why this video failed or for a repackage, output the VIDEO AUTOPSY + REPACKAGE KIT format (metrics first, paste-ready SEO + thumbs). Never ask the user for Studio screenshots.');

      return { text: lines.join('\n'), ok: true, mode: 'autopsy' };
    } catch (err: any) {
      this.logger.warn(`Video performance lookup failed: ${err?.message || err}`);
      return null;
    }
  }

  /**
   * Channel Health Bundle: 28d vs prior 28d + traffic shift + winners/misses.
   * For "why less views / what will work" diagnosis.
   */
  async buildChannelHealthBundle(
    userId: string,
    channelId: string,
  ): Promise<PerformanceBundleText> {
    try {
      const channel = await this.channelModel.findById(channelId).lean();
      if (!channel?.youtubeChannelId || !channel.userId) {
        return { text: 'CHANNEL HEALTH: unavailable (channel not linked).', ok: false };
      }
      const uid = channel.userId.toString();
      const ytChannelId = channel.youtubeChannelId;

      const end = new Date();
      const mid = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);
      const start = new Date(Date.now() - 56 * 24 * 60 * 60 * 1000);
      const fmt = (d: Date) => d.toISOString().split('T')[0];
      const [curStart, curEnd, prevStart, prevEnd] = [fmt(mid), fmt(end), fmt(start), fmt(mid)];

      const [cur, prev, curTraffic, prevTraffic, rows, searchTerms] = await Promise.all([
        this.analytics.getChannelPackagingBaseline(uid, ytChannelId, curStart, curEnd),
        this.analytics.getChannelPackagingBaseline(uid, ytChannelId, prevStart, prevEnd),
        this.analytics.getTrafficSources(uid, ytChannelId, curStart, curEnd),
        this.analytics.getTrafficSources(uid, ytChannelId, prevStart, prevEnd),
        this.analytics.getVideoPackagingRows(uid, ytChannelId, curStart, curEnd, 20),
        this.analytics.getTopSearchTerms(uid, ytChannelId, curStart, curEnd, 8),
      ]);

      const pct = (a: number, b: number) =>
        b === 0 ? (a > 0 ? 100 : 0) : Math.round(((a - b) / b) * 100);

      const lines: string[] = [];
      lines.push('CHANNEL HEALTH BUNDLE (last 28d vs prior 28d)');
      lines.push(
        `WINDOWS: current ${curStart} → ${curEnd} | prior ${prevStart} → ${prevEnd}`,
      );
      lines.push('');
      lines.push('| Metric | Prior 28d | Last 28d | Δ |');
      lines.push('|---|---:|---:|---:|');
      lines.push(
        `| Views | ${prev.views.toLocaleString()} | ${cur.views.toLocaleString()} | ${pct(cur.views, prev.views)}% |`,
      );
      lines.push(
        `| Impressions | ${Math.round(prev.impressions).toLocaleString()} | ${Math.round(cur.impressions).toLocaleString()} | ${pct(cur.impressions, prev.impressions)}% |`,
      );
      lines.push(
        `| CTR | ${prev.impressionsClickThroughRate.toFixed(1)}% | ${cur.impressionsClickThroughRate.toFixed(1)}% | ${(cur.impressionsClickThroughRate - prev.impressionsClickThroughRate).toFixed(1)} pts |`,
      );
      lines.push(
        `| Avg % viewed | ${Math.round(prev.averageViewPercentage)}% | ${Math.round(cur.averageViewPercentage)}% | ${(cur.averageViewPercentage - prev.averageViewPercentage).toFixed(0)} pts |`,
      );
      lines.push(
        `| Watch min | ${Math.round(prev.estimatedMinutesWatched).toLocaleString()} | ${Math.round(cur.estimatedMinutesWatched).toLocaleString()} | ${pct(cur.estimatedMinutesWatched, prev.estimatedMinutesWatched)}% |`,
      );

      // Traffic shift (sources that moved)
      const prevMap = new Map(prevTraffic.map((t) => [t.source, t.views]));
      lines.push('');
      lines.push('TRAFFIC SHIFT (only sources with meaningful move):');
      const moves: string[] = [];
      for (const t of curTraffic) {
        const before = prevMap.get(t.source) || 0;
        const d = pct(t.views, before);
        if (Math.abs(d) >= 10 || (before === 0 && t.views > 100)) {
          moves.push(`- ${t.source}: ${before.toLocaleString()} → ${t.views.toLocaleString()} (${d}%)`);
        }
      }
      for (const [source, before] of prevMap) {
        if (!curTraffic.find((t) => t.source === source) && before > 100) {
          moves.push(`- ${source}: ${before.toLocaleString()} → 0 (−100%)`);
        }
      }
      lines.push(moves.length ? moves.join('\n') : '(no source moved ≥10%)');

      if (rows.length) {
        const byCtr = [...rows].sort((a, b) => b.ctr - a.ctr);
        lines.push('');
        lines.push('TOP PERFORMERS (28d by views):');
        rows.slice(0, 3).forEach((r, i) => {
          lines.push(
            `${i + 1}. "${r.title}" — ${r.views.toLocaleString()} views | CTR ${r.ctr.toFixed(1)}% | ${Math.round(r.averageViewPercentage)}% viewed | imp ${Math.round(r.impressions).toLocaleString()}`,
          );
        });
        lines.push('BOTTOM / LOW CTR (repackage candidates):');
        const low = [...rows]
          .filter((r) => r.views > 0)
          .sort((a, b) => a.ctr - b.ctr)
          .slice(0, 3);
        low.forEach((r, i) => {
          lines.push(
            `${i + 1}. "${r.title}" — ${r.views.toLocaleString()} views | CTR ${r.ctr.toFixed(1)}% | ${Math.round(r.averageViewPercentage)}% viewed`,
          );
        });
        lines.push(`Highest CTR reference: "${byCtr[0]?.title}" at ${byCtr[0]?.ctr.toFixed(1)}%`);
      }

      if (searchTerms.length) {
        lines.push('');
        lines.push('TOP SEARCH TERMS (28d):');
        lines.push(searchTerms.map((s) => `- "${s.term}" (${s.views.toLocaleString()})`).join('\n'));
      }

      lines.push('');
      lines.push(
        'DIAGNOSIS RULES: Pick ONE primary cause: A reach/impressions · B packaging/CTR · C retention · D topic fatigue · E fewer uploads · F traffic mix shift. Evidence must cite the Δ table. Recommendations must be packaging/topic/search/SEO actions only (no edit-structure coaching). End with a 7-day plan and 14d success metrics. Never ask for Studio screenshots.',
      );

      return {
        text: lines.join('\n'),
        ok: true,
        summary: {
          views: cur.views,
          watchTimeHours: Math.round(cur.estimatedMinutesWatched / 60),
          revenue: 0,
          retentionPercent: Math.round(cur.averageViewPercentage),
        },
      };
    } catch (err: any) {
      this.logger.warn(`Channel health bundle failed: ${err?.message || err}`);
      return {
        text: 'CHANNEL HEALTH: temporarily unavailable. Say data is limited; still answer with catalog + trends. Never pretend Studio access.',
        ok: false,
      };
    }
  }

  /** Heuristic: does this chat message want performance/analytics data? */
  static isPerformanceQuery(message: string): boolean {
    const lower = String(message || '');
    if (
      /\b(how (is|are|was|did) (this|that|my|the|our) (video|videos|upload|content)|what (is|are|was) (this|that|my|the|our) (video|videos) (getting|doing|perform)|getting views|view count|watch time|watchtime|retention|audience retention|search terms?|traffic source|\bctr\b|click[-\s]?through|impressions|youtube analytics|channel analytics|video performance|performance (of|for|on)|what (videos?|content) (do|does) (my|the) (channel|audience)|what my (channel|audience|videos?|content)|why (this|that|my|the) (video|upload|content).{0,40}(bad|badly|fail|failed|flop|low|under)|not doing (good|well)|isn'?t doing (good|well)|low (views|ctr|impressions|click)|didn'?t do (good|well)|compared to (the |my )?(other|rest)|repackage|autopsy|video audit|why did (this|that|my))\b/i.test(lower)
    ) {
      return true;
    }
    // Pasted YouTube link + failure/performance language nearby
    if (/(?:youtu\.be\/|v=|\/videos\/)[A-Za-z0-9_-]{11}/.test(lower)) {
      if (/\b(why|bad|badly|fail|low|views|ctr|click|impressions|analytics|doing|performance|fix|repackage|improve)\b/i.test(lower)) {
        return true;
      }
    }
    return false;
  }

  /** True when the user is asking why a specific video failed (autopsy + kit). */
  static isVideoAutopsyQuery(message: string): boolean {
    const lower = String(message || '');
    const hasVideoRef =
      /(?:youtu\.be\/|watch\?v=|\/videos\/)[A-Za-z0-9_-]{11}/.test(lower) ||
      /\b(this|that|my|the)\s+(video|upload)\b/i.test(lower);
    const hasFailure =
      /\b(bad|badly|fail|failed|flop|low|underperform|not doing|isn'?t doing|didn'?t do|worse|why|ctr|click[-\s]?through|repackage|fix this|improve this|do better)\b/i.test(lower);
    return hasVideoRef && hasFailure;
  }

  /** True for channel-level "why less views / what will work" diagnosis. */
  static isChannelDiagnosisQuery(message: string): boolean {
    const lower = String(message || '');
    if (/(?:youtu\.be\/|watch\?v=)[A-Za-z0-9_-]{11}/.test(lower)) return false;
    return /\b((why|how).{0,30}(less|fewer|down|drop|dropped|flat|low).{0,20}(views|view|traffic|impressions)|views? (are |is )?(down|dropped|flat|low|falling)|channel (is |was )?(down|flat|dying|slow)|what (is |will )?work|what'?s working|fix my channel|audit (my |the )?channel|channel (audit|diagnosis|health)|not getting views)\b/i.test(
      lower,
    );
  }
}
