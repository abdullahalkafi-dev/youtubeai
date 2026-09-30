import { Injectable, Logger } from '@nestjs/common';
import { YouTubeService } from './youtube.service';
import { QuotaService } from '../quota/quota.service';

export interface LocalClip {
  videoId: string;
  title: string;
  channelTitle: string;
  videoUrl: string;
  durationSeconds: number;
  viewCount: number;
  thumbnailUrl?: string;
  publishedAt?: string;
  market?: string;
}

export interface LocalScenePack {
  market: string;
  locationLabel: string;
  topic: string;
  stations: string[];
  clips: LocalClip[];
  note: string;
}

type MarketDef = {
  /** Match keys in free text (city / region / famous place). */
  keys: string[];
  label: string;
  /** Local TV call signs / channel names to prefer in YouTube search. */
  stations: string[];
  regionCode?: string;
};

/** Expandable market → local affiliate map (station names used in search queries). */
const MARKETS: MarketDef[] = [
  {
    keys: ['shreveport', 'bossier', 'caddo', 'louisiana'],
    label: 'Shreveport, LA',
    stations: ['KSLA', 'KTBS', 'Fox 33 Shreveport'],
    regionCode: 'US',
  },
  {
    keys: ['new orleans', 'nola', 'orleans parish', 'jefferson parish'],
    label: 'New Orleans, LA',
    stations: ['WWL', 'WDSU', 'WGNO', 'WVUE'],
    regionCode: 'US',
  },
  {
    keys: ['compton', 'los angeles', 'la county', 'inglewood', 'south central'],
    label: 'Los Angeles, CA',
    stations: ['KABC', 'KNBC', 'KCBS', 'KTTV', 'KTLA'],
    regionCode: 'US',
  },
  {
    keys: ['brooklyn', 'manhattan', 'queens', 'bronx', 'nyc', 'new york city', 'harlem', 'mdc brooklyn'],
    label: 'New York, NY',
    stations: ['WABC', 'WNBC', 'WCBS', 'WNYW', 'PIX11'],
    regionCode: 'US',
  },
  {
    keys: ['chicago', 'cook county', 'illinois'],
    label: 'Chicago, IL',
    stations: ['WGN', 'WLS', 'WMAQ', 'WBBM'],
    regionCode: 'US',
  },
  {
    keys: ['houston', 'harris county', 'texas'],
    label: 'Houston, TX',
    stations: ['KPRC', 'KHOU', 'KRIV', 'KTRK'],
    regionCode: 'US',
  },
  {
    keys: ['atlanta', 'georgia', 'fulton county', 'dekalb'],
    label: 'Atlanta, GA',
    stations: ['WSB', 'WAGA', 'WXIA', 'WGCL'],
    regionCode: 'US',
  },
  {
    keys: ['miami', 'broward', 'fort lauderdale', 'florida'],
    label: 'Miami, FL',
    stations: ['WPLG', 'WTVJ', 'WSVN', 'WFOR'],
    regionCode: 'US',
  },
  {
    keys: ['baltimore', 'maryland', 'howard county'],
    label: 'Baltimore, MD',
    stations: ['WBAL', 'WMAR', 'WJZ', 'WBFF'],
    regionCode: 'US',
  },
  {
    keys: ['philadelphia', 'philly', 'pennsylvania'],
    label: 'Philadelphia, PA',
    stations: ['KYW', 'WPVI', 'WCAU', 'WTXF'],
    regionCode: 'US',
  },
  {
    keys: ['dallas', 'fort worth', 'tarrant county'],
    label: 'Dallas, TX',
    stations: ['KDFW', 'KXAS', 'WFAA', 'KTVT'],
    regionCode: 'US',
  },
  {
    keys: ['las vegas', 'clark county', 'nevada'],
    label: 'Las Vegas, NV',
    stations: ['KTNV', 'KLAS', 'KVVU', '8 News Now'],
    regionCode: 'US',
  },
  {
    keys: ['nashville', 'tennessee', 'shelby county', 'memphis'],
    label: 'Nashville / Memphis, TN',
    stations: ['WSMV', 'WKRN', 'WTVF', 'WMC', 'WHBQ'],
    regionCode: 'US',
  },
  {
    keys: ['st. louis', 'st louis', 'missouri', 'ferguson'],
    label: 'St. Louis, MO',
    stations: ['KSDK', 'KMOV', 'KTVI', 'KPLR'],
    regionCode: 'US',
  },
];

const MAX_CLIPS_DEFAULT = 5;
const MAX_SECONDS_DEFAULT = 360; // 6 minutes — more usable local B-roll than 4 min
const SEARCH_LOOKBACK_DAYS = 730; // allow older local archive for footage

@Injectable()
export class LocalNewsService {
  private readonly logger = new Logger(LocalNewsService.name);

  constructor(
    private readonly youtubeService: YouTubeService,
    private readonly quotaService: QuotaService,
  ) {}

  /** Resolve a free-text location / story to a known local market. */
  resolveMarket(locationHint?: string, topic?: string): MarketDef | null {
    const hay = `${locationHint || ''} ${topic || ''}`.toLowerCase();
    if (!hay.trim()) return null;
    for (const market of MARKETS) {
      if (market.keys.some((k) => hay.includes(k))) return market;
    }
    return null;
  }

  /** True when the client is asking for footage / local news clips. */
  isFootageRequest(message: string): boolean {
    const lower = (message || '').toLowerCase();
    return /\b(local news|footage|b-?roll|scene pack|news clips?|video clips?|collect (clips|footage)|clips? for (the )?script|local (tv|affiliates?|stations?))\b/i.test(
      lower,
    );
  }

  /**
   * Strip chat chrome so YouTube search gets a real subject, not
   * "write me a script about local news footage for…".
   */
  extractSearchTopic(message: string): string {
    let t = (message || '').trim();
    t = t.replace(
      /^(?:please\s+)?(?:can\s+you\s+)?(?:write\s+(?:me\s+)?a\s+)?(?:full\s+)?(?:10[- ]?minute\s+)?(?:video\s+)?script\s+(?:about|on|for)\s+/i,
      '',
    );
    t = t.replace(
      /^(?:find|get|show|give\s+me|search\s+for)?\s*(?:me\s+)?(?:some\s+)?(?:local\s+news\s+)?(?:footage|clips?|b-?roll|video\s+clips?)\s*(?:for|about|on|of)?\s+/i,
      '',
    );
    t = t.replace(
      /^(?:i\s+)?(?:need|want)\s+(?:local\s+)?(?:news\s+)?(?:footage|clips?|b-?roll)\s+(?:for|about|on|of)\s+/i,
      '',
    );
    t = t.replace(/\s+/g, ' ').trim();
    if (t.length > 100) t = t.slice(0, 100).trim();
    return t || (message || '').trim().slice(0, 80);
  }

  /**
   * Find short local-news YouTube clips for a story (≤ maxSeconds).
   * Quota: at most 2 search.list calls + 1 videos.list batch.
   */
  async findFootagePack(params: {
    userId: string;
    topic: string;
    locationHint?: string;
    maxClips?: number;
    maxSeconds?: number;
  }): Promise<LocalScenePack | null> {
    const topic = (params.topic || '').trim().slice(0, 120);
    if (!topic) return null;

    const market = this.resolveMarket(params.locationHint, topic);
    if (!market) {
      this.logger.log(`[LocalNews] no market for topic="${topic.slice(0, 60)}" hint="${params.locationHint || ''}"`);
      return null;
    }

    const maxClips = params.maxClips ?? MAX_CLIPS_DEFAULT;
    const maxSeconds = params.maxSeconds ?? MAX_SECONDS_DEFAULT;
    const publishedAfter = new Date(Date.now() - SEARCH_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

    // Market-first queries (max 2 — search.list is expensive)
    const primaryStation = market.stations[0];
    const queries = [
      `${primaryStation} ${topic}`,
      `${market.label.split(',')[0]} news ${topic}`,
    ];

    const found = new Map<string, { videoId: string; title: string; channelTitle: string; thumbnailUrl: string }>();
    for (const query of queries) {
      try {
        const rows = await this.youtubeService.searchVideos({
          userId: params.userId,
          query,
          publishedAfter,
          regionCode: market.regionCode || 'US',
          maxResults: 8,
        });
        await this.quotaService.logCall({
          channelId: 'local-news',
          endpoint: 'search.list (localNews)',
          quotaCost: 100,
          success: true,
          relatedId: query.slice(0, 80),
        });
        for (const r of rows) {
          if (r.videoId && !found.has(r.videoId)) {
            found.set(r.videoId, {
              videoId: r.videoId,
              title: r.title,
              channelTitle: r.channelTitle,
              thumbnailUrl: r.thumbnailUrl,
            });
          }
        }
      } catch (err: any) {
        this.logger.warn(`[LocalNews] search failed "${query}": ${err?.message || err}`);
      }
    }

    if (found.size === 0) {
      this.logger.log(`[LocalNews] no search hits market=${market.label} topic="${topic.slice(0, 60)}"`);
      return {
        market: market.label,
        locationLabel: market.label,
        topic,
        stations: market.stations,
        clips: [],
        note: 'No local affiliate clips found on YouTube for this market/topic. Do not invent stations or video IDs.',
      };
    }

    const ids = [...found.keys()].slice(0, 25);
    const details = await this.youtubeService.getVideoDetails(
      await this.youtubeService.getValidAccessToken(params.userId),
      ids,
    );

    const stationNames = market.stations.map((s) => s.toLowerCase());
    const clips: LocalClip[] = [];
    for (const d of details) {
      if (!d.videoId || d.durationSeconds <= 0 || d.durationSeconds > maxSeconds) continue;
      const meta = found.get(d.videoId);
      const channel = (d.channelTitle || meta?.channelTitle || '').toLowerCase();
      const isLocalStation = stationNames.some((s) => channel.includes(s.toLowerCase().slice(0, 4)));
      const isNews = /news|tv|abc|nbc|cbs|fox|cw|nbc/i.test(channel);
      if (!isLocalStation && !isNews) continue;
      clips.push({
        videoId: d.videoId,
        title: d.title,
        channelTitle: d.channelTitle || meta?.channelTitle || '',
        videoUrl: d.videoUrl || `https://www.youtube.com/watch?v=${d.videoId}`,
        durationSeconds: d.durationSeconds,
        viewCount: d.viewCount || 0,
        thumbnailUrl: d.thumbnailUrl || meta?.thumbnailUrl,
        publishedAt: d.publishedAt,
        market: market.label,
      });
    }

    // Prefer local station names, then views
    clips.sort((a, b) => {
      const aLocal = stationNames.some((s) => a.channelTitle.toLowerCase().includes(s.toLowerCase().slice(0, 4))) ? 1 : 0;
      const bLocal = stationNames.some((s) => b.channelTitle.toLowerCase().includes(s.toLowerCase().slice(0, 4))) ? 1 : 0;
      if (aLocal !== bLocal) return bLocal - aLocal;
      return (b.viewCount || 0) - (a.viewCount || 0);
    });

    const top = clips.slice(0, maxClips);
    this.logger.log(
      `[LocalNews] pack market=${market.label} clips=${top.length}/${clips.length} topic="${topic.slice(0, 50)}"`,
    );

    return {
      market: market.label,
      locationLabel: market.label,
      topic,
      stations: market.stations,
      clips: top,
      note:
        top.length > 0
          ? `Local news clips (≤${maxSeconds}s) for ${market.label}. Use as B-roll only; verify rights/editorial before monetized use.`
          : 'No short local clips passed duration filter. Do not invent stations or video IDs.',
    };
  }

  /** Render pack for model dynamic context. */
  formatPack(pack: LocalScenePack): string {
    const lines: string[] = [];
    lines.push(`LOCAL NEWS FOOTAGE PACK`);
    lines.push(`Market: ${pack.market} | Topic: ${pack.topic}`);
    lines.push(`Stations to prefer: ${pack.stations.join(', ')}`);
    if (pack.clips.length === 0) {
      lines.push(pack.note);
      return lines.join('\n');
    }
    lines.push(`Use these REAL YouTube clips (URL exactly once per clip) in §17 / B-roll:`);
    pack.clips.forEach((c, i) => {
      const mins = Math.floor(c.durationSeconds / 60);
      const secs = c.durationSeconds % 60;
      lines.push(
        `${i + 1}. [${c.channelTitle}: ${c.title}](${c.videoUrl}) — ${mins}:${String(secs).padStart(2, '0')} | ${c.viewCount.toLocaleString()} views`,
      );
    });
    lines.push(pack.note);
    return lines.join('\n');
  }
}
