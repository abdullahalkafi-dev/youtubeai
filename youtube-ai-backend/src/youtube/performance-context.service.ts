import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Video, VideoDocument } from '../mongo/schemas/video.schema';
import { Channel, ChannelDocument } from '../mongo/schemas/channel.schema';
import { YoutubeAnalyticsService } from '../youtube/youtube-analytics.service';
import { YouTubeService } from '../youtube/youtube.service';

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
  mode?: 'autopsy' | 'public';
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
    private readonly youtubeService: YouTubeService,
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
   * Resolve a YouTube video id to real metadata.
   * 1) Mongo catalog  2) Data API videos.list (own OAuth works for public videos too)
   * Sets isOwner when channel matches the linked channel.
   */
  async resolveVideoIdentity(
    userId: string,
    channelId: string,
    youtubeVideoId: string,
  ): Promise<{
    youtubeId: string;
    title: string;
    description?: string;
    tags?: string[];
    viewCount?: number;
    likeCount?: number;
    publishedAt?: string;
    durationSeconds?: number;
    channelTitle?: string;
    ownerChannelId?: string;
    isOwner: boolean;
    source: 'catalog' | 'youtube_api' | 'stub';
  } | null> {
    const ytId = String(youtubeVideoId || '').trim();
    if (!/^[A-Za-z0-9_-]{11}$/.test(ytId)) return null;

    const cId = channelId as any;
    let catalog =
      (await this.videoModel.findOne({ channelId: cId, youtubeId: ytId }).lean()) ||
      (await this.videoModel.findOne({ youtubeId: ytId }).lean());

    const channel = await this.channelModel.findById(channelId).lean();
    const myYtChannelId = channel?.youtubeChannelId || '';

    // Always try Data API when catalog is missing OR title looks like a stub
    const catalogTitle = String(catalog?.title || '');
    const needsApi = !catalog || /^youtube video /i.test(catalogTitle) || catalogTitle.length < 3;

    if (needsApi && userId) {
      try {
        const accessToken = await this.youtubeService.getValidAccessToken(userId);
        if (accessToken) {
          const details = await this.youtubeService.getVideoDetails(accessToken, [ytId]);
          const d = details.find((x) => x.videoId === ytId) || details[0];
          if (d?.title) {
            const isOwner = Boolean(
              myYtChannelId && d.channelId && d.channelId === myYtChannelId,
            );
            // Backfill catalog if this is our video and missing
            if (isOwner && (!catalog || needsApi)) {
              try {
                await this.videoModel.updateOne(
                  { channelId: cId, youtubeId: ytId },
                  {
                    $set: {
                      title: d.title,
                      description: d.description,
                      tags: d.tags || [],
                      viewCount: d.viewCount || 0,
                      likeCount: d.likeCount || 0,
                      durationSeconds: d.durationSeconds,
                      duration: d.duration,
                      thumbnailUrl: d.thumbnailUrl,
                      publishedAt: d.publishedAt ? new Date(d.publishedAt) : undefined,
                    },
                    $setOnInsert: {
                      channelId: cId,
                      youtubeId: ytId,
                      deletedFromYoutube: false,
                    },
                  },
                  { upsert: true },
                );
              } catch { /* backfill optional */ }
            }
            return {
              youtubeId: ytId,
              title: d.title,
              description: d.description,
              tags: d.tags || [],
              viewCount: d.viewCount,
              likeCount: d.likeCount,
              publishedAt: d.publishedAt,
              durationSeconds: d.durationSeconds,
              channelTitle: d.channelTitle || '',
              ownerChannelId: d.channelId || '',
              isOwner,
              source: 'youtube_api',
            };
          }
        }
      } catch (err: any) {
        this.logger.warn(`Video identity API lookup failed for ${ytId}: ${err?.message || err}`);
      }
    }

    if (catalog && catalog.title && !/^youtube video /i.test(catalog.title)) {
      return {
        youtubeId: ytId,
        title: catalog.title,
        description: (catalog as any).description,
        tags: (catalog as any).tags || [],
        viewCount: (catalog as any).viewCount,
        publishedAt: (catalog as any).publishedAt?.toString?.(),
        durationSeconds: (catalog as any).durationSeconds,
        channelTitle: channel?.name || '',
        ownerChannelId: myYtChannelId,
        isOwner: true,
        source: 'catalog',
      };
    }

    return {
      youtubeId: ytId,
      title: catalog?.title || `YouTube video ${ytId}`,
      isOwner: false,
      source: 'stub',
    };
  }

  /**
   * Find a channel video from a natural-language question ("this video", title fragment).
   * Returns score so callers can prefer a strong title match over the thread's video.
   */
  async findVideoFromQuery(
    channelId: string,
    query: string,
    userId?: string,
  ): Promise<{ video: any; score: number; identity?: Awaited<ReturnType<PerformanceContextService['resolveVideoIdentity']>> } | null> {
    const cId = channelId as any;
    const q = String(query || '');
    if (!q.trim()) return null;

    // Explicit YouTube id (11 chars) — ALWAYS win over fuzzy title match
    const idMatch = q.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/|\/videos\/)([A-Za-z0-9_-]{11})/);
    if (idMatch && idMatch[1]) {
      const ytId = idMatch[1];
      const identity = userId
        ? await this.resolveVideoIdentity(userId, channelId, ytId)
        : null;
      const byYt = await this.videoModel.findOne({ channelId: cId, youtubeId: ytId }).lean();
      if (byYt && byYt.title && !/^youtube video /i.test(byYt.title)) {
        return { video: { ...byYt, ...identity, title: identity?.title || byYt.title }, score: 100, identity };
      }
      // API identity or stub — still lock to this id (never fuzzy-match another title)
      const title = identity?.title || `YouTube video ${ytId}`;
      return {
        video: {
          youtubeId: ytId,
          title,
          viewCount: identity?.viewCount,
          description: identity?.description,
          tags: identity?.tags,
          publishedAt: identity?.publishedAt,
        },
        score: 100,
        identity,
      };
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
      const uidForLookup = channel.userId?.toString() || userId || '';
      // Safe ObjectId only (C10)
      if (videoId && Types.ObjectId.isValid(videoId)) {
        video = await this.videoModel.findById(videoId).lean();
      }

      // Explicit URL id always wins (C3) — never fuzzy-match when a link is present
      const matched = await this.findVideoFromQuery(channelId, query, uidForLookup);
      const hasUrlId = /(?:v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/|\/videos\/)[A-Za-z0-9_-]{11}/.test(
        query || '',
      );
      if (matched && (hasUrlId || matched.score >= 6)) {
        video = matched.video;
      } else if (!video?.youtubeId && matched) {
        video = matched.video;
      }

      if (!video?.youtubeId) return null;

      // Resolve real title / ownership via Data API when stub or foreign
      const identity =
        matched?.identity ||
        (await this.resolveVideoIdentity(channel.userId?.toString() || '', channelId, video.youtubeId));
      const isOwner = identity?.isOwner ?? true;
      const realTitle = identity?.title || video.title || `YouTube video ${video.youtubeId}`;

      if (!identity || identity.source === 'stub' || /^youtube video /i.test(realTitle)) {
        return {
          text: [
            'VIDEO IDENTITY: UNRESOLVED',
            `YouTube ID: ${video.youtubeId}`,
            'Could not load a real title from catalog or YouTube Data API.',
            'DO NOT write a repackage kit. DO NOT invent a case, person, or topic.',
            'Reply briefly: ask the user to confirm the exact video title, or try again after metadata sync.',
            'You may still list the YouTube ID only.',
          ].join('\n'),
          ok: true,
          mode: 'autopsy',
        };
      }

      if (!isOwner) {
        // Public / competitor video — no private Analytics
        const lines: string[] = [];
        lines.push('PUBLIC VIDEO LOOKUP (not this channel — no private Analytics/CTR/impressions)');
        lines.push(`Title: "${realTitle}"`);
        lines.push(`YouTube ID: ${video.youtubeId}`);
        if (identity.channelTitle) lines.push(`Channel: ${identity.channelTitle}`);
        if (identity.publishedAt) lines.push(`Published: ${String(identity.publishedAt).slice(0, 10)}`);
        if (identity.viewCount != null) lines.push(`Public views: ${Number(identity.viewCount).toLocaleString()}`);
        if (identity.likeCount != null) lines.push(`Public likes: ${Number(identity.likeCount).toLocaleString()}`);
        if (identity.durationSeconds) lines.push(`Duration: ${Math.round(identity.durationSeconds)}s`);
        if (identity.description) {
          lines.push('Description (first 500 chars):');
          lines.push(String(identity.description).slice(0, 500));
        }
        if (identity.tags?.length) {
          lines.push('Tags: ' + identity.tags.slice(0, 15).join(', '));
        }
        lines.push('');
        lines.push(
          'MODE: PUBLIC VIDEO ANALYSIS. Never claim CTR, impressions, revenue, or Studio analytics for this video. Analyze title/thumbnail/angle/public performance only. If recommending a repackage, it must be for UNIQUE MECCA AUDIO’s remake — do not copy their brand or private claims. Never put the 11-char YouTube id in titles or tags.',
        );
        return { text: lines.join('\n'), ok: true, mode: 'public' as any };
      }

      video = { ...video, title: realTitle, viewCount: identity.viewCount ?? video.viewCount };
      const titleForPrompt = realTitle;

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
      lines.push(`Title: "${titleForPrompt}"`);
      lines.push(`YouTube ID: ${video.youtubeId}`);
      if (identity?.source) lines.push(`Identity source: ${identity.source}`);
      if (identity?.description) {
        lines.push('CURRENT DESCRIPTION (first 600 chars):');
        lines.push(String(identity.description).slice(0, 600));
      }
      if (identity?.tags?.length) {
        lines.push('CURRENT TAGS: ' + identity.tags.slice(0, 20).join(', '));
      }
      lines.push(
        'CRITICAL: Use THIS exact title and YouTube ID only. Never invent another video title. Never analyze a different person/case than this title. Base the repackage kit on THIS real topic (from the title/description above). NEVER put an 11-char YouTube id in title, tags, or hashtags.',
      );
      if (hasUrlId) {
        lines.push('(Locked to the YouTube link in the user message.)');
      } else if (matched && matched.score >= 6) {
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
          const ctrLabel =
            baseline.impressionsClickThroughRate > 0
              ? `target CTR ${baseline.impressionsClickThroughRate.toFixed(1)}%`
              : 'CTR unavailable (no impressions data)';
          const impLabel =
            baseline.impressions > 0
              ? `${baseline.impressions.toLocaleString()} impressions`
              : 'impressions unavailable';
          lines.push(
            `CHANNEL BASELINE (28d): ${ctrLabel} | avg ${Math.round(baseline.averageViewPercentage)}% viewed | ${impLabel} | ${baseline.views.toLocaleString()} views`,
          );
          if (baseline.impressionsClickThroughRate <= 0) {
            lines.push(
              'Do NOT invent a CTR target. When CTR is unavailable, say "CTR unavailable" and target packaging quality only.',
            );
          }
        }
        const peers = packagingRows
          .filter((r) => r.videoId !== video.youtubeId && r.views > 0)
          .slice(0, 3);
        if (peers.length) {
          lines.push('SIBLING / RECENT VIDEOS (use these TITLE PATTERNS for the kit):');
          peers.forEach((r, i) => {
            const impPart =
              r.impressions > 0 ? ` | imp ${Math.round(r.impressions).toLocaleString()}` : '';
            const ctrPart = r.ctr > 0 ? ` | CTR ${r.ctr.toFixed(1)}%` : ' | CTR unavailable';
            lines.push(
              `${i + 1}. "${r.title}" — ${r.views.toLocaleString()} views${impPart}${ctrPart} | ${Math.round(r.averageViewPercentage)}% viewed`,
            );
          });
          lines.push(
            'Title pattern to copy: Entity (person/case) + concrete consequence — never abstract category labels.',
          );
        }
        const selfRow = packagingRows.find((r) => r.videoId === video.youtubeId);
        if (selfRow) {
          const impPart =
            selfRow.impressions > 0 ? ` | imp ${Math.round(selfRow.impressions).toLocaleString()}` : '';
          const ctrPart =
            selfRow.ctr > 0 ? ` | CTR ${selfRow.ctr.toFixed(1)}%` : ' | CTR unavailable';
          lines.push(
            `THIS VIDEO (28d window): ${selfRow.views.toLocaleString()} views${impPart}${ctrPart} | ${Math.round(selfRow.averageViewPercentage)}% viewed`,
          );
          const ctrDelta = selfRow.ctr - baseline.impressionsClickThroughRate;
          if (baseline.impressionsClickThroughRate > 0 && selfRow.ctr > 0) {
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
