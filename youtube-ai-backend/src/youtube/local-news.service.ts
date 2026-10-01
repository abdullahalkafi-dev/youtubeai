import { Injectable, Logger } from '@nestjs/common';
import { YouTubeService } from './youtube.service';
import { QuotaService } from '../quota/quota.service';
import {
  TIER2_LABEL,
  COMMENTARY_TITLE_SKIP,
  getAllowedChannel,
} from './news-channels';

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
  /** Provenance label for Tier-2 clips ("urban news outlet"). */
  tierLabel?: string;
}

export interface LocalScenePack {
  market: string;
  locationLabel: string;
  topic: string;
  stations: string[];
  clips: LocalClip[];
  note: string;
  /** 'local' = market/affiliate pack; 'topic' = marketless allowlist search pack. */
  kind?: 'local' | 'topic';
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
    keys: [
      'brooklyn',
      'manhattan',
      'queens',
      'bronx',
      'nyc',
      'new york city',
      'harlem',
      'mdc brooklyn',
    ],
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
    // Florida Panhandle — Fort Walton Beach / Okaloosa / Pensacola / Panama City.
    // MUST come before Miami and must own 'florida' so panhandle stories never
    // resolve to Miami stations.
    keys: [
      'fort walton beach',
      'okaloosa',
      'pensacola',
      'panama city',
      'destin',
      'crestview',
      'niceville',
      'mary esther',
      'northwest florida',
      'northwest florida daily news',
      'emerald coast',
      'santa rosa',
      'escambia',
      'florida panhandle',
      'florida',
    ],
    label: 'Pensacola / Panama City, FL',
    stations: ['WEAR', 'WJHG', 'WECP', 'WKRG', 'WMBB', 'WZVN'],
    regionCode: 'US',
  },
  {
    keys: ['miami', 'broward', 'fort lauderdale', 'dade', 'palm beach'],
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

/**
 * State-level catch-all keys: tier 0 in resolveMarket. Any city/county key
 * (tier 1) beats them, so "Dallas, Texas" → Dallas (not Houston) and
 * "Miami, Florida" → Miami (not the 'florida' panhandle fallback).
 */
const GENERIC_STATE_KEYS = new Set([
  'florida',
  'louisiana',
  'texas',
  'illinois',
  'georgia',
  'maryland',
  'pennsylvania',
  'nevada',
  'tennessee',
  'missouri',
]);

const MAX_CLIPS_DEFAULT = 5;
const MAX_SECONDS_DEFAULT = 360; // 6 minutes — more usable local B-roll than 4 min
const SEARCH_LOOKBACK_DAYS = 730; // allow older local archive for footage

/** Topic pack (Phase 2 lite): search-first, marketless. */
const TOPIC_SEARCH_LOOKBACK_DAYS = 30; // Claude condition: publishedAfter ~30 days
const TOPIC_SEARCH_MAX_RESULTS = 50; // same price per call — take the max
const TOPIC_MAX_SECONDS = 900; // 15 min — packaged news segments OK, raw 1h streams not
const TOPIC_MAX_CLIPS = 8; // within Claude's §17 6–10 target; relevance-sliced
const FOOTAGE_ENDPOINT = 'search.list (footage)';
const FOOTAGE_DAILY_SEARCH_CAP = 25; // of the shared 100/day search bucket
const FOOTAGE_SEARCH_COST = 100; // 1 call in the search bucket (ceil(cost/100))
const TIER2_MAX_CLIPS = 3;
const TOPIC_VERIFY_CAP = 20; // candidates sent to videos.list
const CACHE_FRESH_MS = 4 * 60 * 60 * 1000; // newest match ≤72h old
const CACHE_STALE_MS = 24 * 60 * 60 * 1000; // older stories — results won't change
const CACHE_NEGATIVE_MS = 30 * 60 * 1000; // empty/error result retry window
const CACHE_MAX_ENTRIES = 200;
const FRESH_STORY_MS = 72 * 60 * 60 * 1000;

@Injectable()
export class LocalNewsService {
  private readonly logger = new Logger(LocalNewsService.name);

  /** Topic-pack result cache: key `${userId}::${topic}` → expiry + pack. */
  private readonly topicCache = new Map<
    string,
    { expiresAt: number; pack: LocalScenePack }
  >();

  constructor(
    private readonly youtubeService: YouTubeService,
    private readonly quotaService: QuotaService,
  ) {}

  /**
   * Resolve a free-text location / story to a known local market.
   * Priority: any city/county key beats state-level catch-all keys (tier),
   * then longest key wins, then array order. So:
   * - "Miami, Florida" → Miami ('miami' city key beats 'florida' state key)
   * - "Fort Walton Beach, Florida" → Panhandle ('fort walton beach' beats 'florida')
   * - "Florida man fentanyl" (no city) → Panhandle (first market owning 'florida')
   */
  resolveMarket(locationHint?: string, topic?: string): MarketDef | null {
    const hay = `${locationHint || ''} ${topic || ''}`.toLowerCase();
    if (!hay.trim()) return null;
    let best: {
      market: MarketDef;
      tier: number;
      keyLen: number;
      order: number;
    } | null = null;
    MARKETS.forEach((market, order) => {
      for (const key of market.keys) {
        if (!hay.includes(key)) continue;
        const candidate = {
          market,
          tier: GENERIC_STATE_KEYS.has(key) ? 0 : 1,
          keyLen: key.length,
          order,
        };
        const beats =
          !best ||
          candidate.tier > best.tier ||
          (candidate.tier === best.tier &&
            (candidate.keyLen > best.keyLen ||
              (candidate.keyLen === best.keyLen &&
                candidate.order < best.order)));
        if (beats) best = candidate;
      }
    });
    return best ? (best as { market: MarketDef }).market : null;
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
      this.logger.log(
        `[LocalNews] no market for topic="${topic.slice(0, 60)}" hint="${params.locationHint || ''}"`,
      );
      return null;
    }

    const maxClips = params.maxClips ?? MAX_CLIPS_DEFAULT;
    const maxSeconds = params.maxSeconds ?? MAX_SECONDS_DEFAULT;
    const publishedAfter = new Date(
      Date.now() - SEARCH_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );

    // Market-first queries (max 2 — search.list is expensive)
    const primaryStation = market.stations[0];
    const queries = [
      `${primaryStation} ${topic}`,
      `${market.label.split(',')[0]} news ${topic}`,
    ];

    const found = new Map<
      string,
      {
        videoId: string;
        title: string;
        channelTitle: string;
        thumbnailUrl: string;
      }
    >();
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
        this.logger.warn(
          `[LocalNews] search failed "${query}": ${err?.message || err}`,
        );
      }
    }

    if (found.size === 0) {
      this.logger.log(
        `[LocalNews] no search hits market=${market.label} topic="${topic.slice(0, 60)}"`,
      );
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
      if (
        !d.videoId ||
        d.durationSeconds <= 0 ||
        d.durationSeconds > maxSeconds
      )
        continue;
      const meta = found.get(d.videoId);
      const channel = (
        d.channelTitle ||
        meta?.channelTitle ||
        ''
      ).toLowerCase();
      const isLocalStation = stationNames.some((s) =>
        channel.includes(s.toLowerCase().slice(0, 4)),
      );
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
      const aLocal = stationNames.some((s) =>
        a.channelTitle.toLowerCase().includes(s.toLowerCase().slice(0, 4)),
      )
        ? 1
        : 0;
      const bLocal = stationNames.some((s) =>
        b.channelTitle.toLowerCase().includes(s.toLowerCase().slice(0, 4)),
      )
        ? 1
        : 0;
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
      kind: 'local',
      note:
        top.length > 0
          ? `Local news clips (≤${maxSeconds}s) for ${market.label}. Use as B-roll only; verify rights/editorial before monetized use.`
          : 'No short local clips passed duration filter. Do not invent stations or video IDs.',
    };
  }

  /**
   * Marketless TOPIC footage pack — Phase 2 lite (Claude conditions 1-4).
   *
   * - search.list FIRST (allowlist filters results; it is not the source)
   * - query 1 = leading core (≤4 words) for long topics / "<topic> news" for
   *   short ones; query 2 (only if <3 survive) = "<topic> courthouse"
   * - long-topic result titles must share ≥2 tokens with the query
   * - publishedAfter ~30d, maxResults=50 (same price per call)
   * - denylist (own + competitors) always wins; commentary titles skipped
   * - Tier 2 only when Tier 1 yields <2, capped at 3, labeled
   * - videos.list verify (embeddable + duration + date)
   * - ≤25 footage search calls/day (endpoint counter) + shared 100/day bucket
   * - topic cache: 4h when newest match ≤72h old, else 24h; empty → 30min
   *
   * Never throws. Returns null only when topic is empty; otherwise returns a
   * pack (possibly with 0 clips) so callers can render the "footage thin" note.
   */
  async findTopicFootagePack(params: {
    userId: string;
    /** Real channel _id — lets the shared search-bucket pre-check see true usage. */
    channelId?: string;
    topic: string;
    denyChannelIds?: string[];
    maxClips?: number;
    maxSeconds?: number;
  }): Promise<LocalScenePack | null> {
    const topic = (params.topic || '').trim().slice(0, 120);
    if (!topic) return null;

    const maxClips = params.maxClips ?? TOPIC_MAX_CLIPS;
    const maxSeconds = params.maxSeconds ?? TOPIC_MAX_SECONDS;
    const cacheKey = `${params.userId}::${topic.toLowerCase().replace(/\s+/g, ' ')}`;

    // 0. Cache hit — repeated asks cost 0 units
    const hit = this.topicCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      this.logger.log(`[TopicPack] cache hit topic="${topic.slice(0, 50)}"`);
      return hit.pack;
    }

    const deny = new Set(params.denyChannelIds || []);
    const publishedAfter = new Date(
      Date.now() - TOPIC_SEARCH_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );
    // Trend/summary titles run long; newsroom titles are short. For long
    // topics q1 uses the leading core so allowlisted coverage surfaces, and
    // results must overlap the query (≥2 tokens) to stay on-topic. Short
    // topics keep the original "<topic> news" phrasing (gate parity).
    const topicWords = topic.split(/\s+/);
    const longTopic = topicWords.length > 4;
    const queries = longTopic
      ? [topicWords.slice(0, 4).join(' '), `${topic} courthouse`]
      : [`${topic} news`, `${topic} courthouse`];
    const tokens = (s: string) =>
      new Set(
        (s || '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .split(/\s+/)
          .filter((t) => t.length >= 2),
      );
    const overlapsQuery = (title: string, q: Set<string>) => {
      let n = 0;
      for (const t of tokens(title)) if (q.has(t) && ++n >= 2) return true;
      return false;
    };

    type Row = {
      videoId: string;
      title: string;
      channelTitle: string;
      channelId: string;
      thumbnailUrl: string;
    };
    const seen = new Set<string>();
    const tier1: Row[] = [];
    const tier2: Row[] = [];
    let searchesRun = 0;
    let stopReason = '';

    const absorb = (rows: Row[]) => {
      for (const row of rows) {
        if (!row.videoId || seen.has(row.videoId)) continue;
        seen.add(row.videoId);
        if (deny.has(row.channelId)) continue;
        if (COMMENTARY_TITLE_SKIP.test(row.title)) continue;
        const allowed = getAllowedChannel(row.channelId);
        if (!allowed) continue;
        (allowed.tier === 1 ? tier1 : tier2).push(row);
      }
    };

    const effectiveCount = () =>
      tier1.length +
      (tier1.length < 2 ? Math.min(tier2.length, TIER2_MAX_CLIPS) : 0);

    // 1-2. Search (max 2 queries, caps enforced per query)
    for (const query of queries) {
      if (searchesRun > 0 && effectiveCount() >= 3) break; // condition 3: stop after enough survive
      if (searchesRun >= 2) break;

      const usedToday =
        await this.quotaService.countEndpointCallsToday(FOOTAGE_ENDPOINT);
      if (usedToday >= FOOTAGE_DAILY_SEARCH_CAP) {
        stopReason = `footage search cap reached (${usedToday}/${FOOTAGE_DAILY_SEARCH_CAP} today)`;
        break;
      }
      if (params.channelId) {
        try {
          await this.quotaService.checkQuota(
            params.channelId,
            FOOTAGE_ENDPOINT,
            FOOTAGE_SEARCH_COST,
          );
        } catch {
          stopReason = 'shared search.list bucket exhausted';
          break;
        }
      }

      try {
        const rows = await this.youtubeService.searchVideos({
          userId: params.userId,
          query,
          publishedAfter,
          regionCode: 'US',
          maxResults: TOPIC_SEARCH_MAX_RESULTS,
        });
        searchesRun++;
        await this.quotaService.logCall({
          channelId: 'footage-pack',
          endpoint: FOOTAGE_ENDPOINT,
          quotaCost: FOOTAGE_SEARCH_COST,
          success: true,
          relatedId: query.slice(0, 80),
        });
        const qTokens = longTopic ? tokens(query) : null;
        absorb(
          qTokens
            ? (rows as Row[]).filter((r) => overlapsQuery(r.title, qTokens))
            : rows,
        );
      } catch (err: any) {
        this.logger.warn(
          `[TopicPack] search failed "${query}": ${err?.message || err}`,
        );
        await this.quotaService
          .logCall({
            channelId: 'footage-pack',
            endpoint: FOOTAGE_ENDPOINT,
            quotaCost: FOOTAGE_SEARCH_COST,
            success: false,
            errorMessage: String(err?.message || err).slice(0, 200),
            relatedId: query.slice(0, 80),
          })
          .catch(() => {});
        stopReason = 'search error';
        break;
      }
    }

    // Tier assembly: Tier 2 only when Tier 1 is thin; ≤3; already labeled later.
    const chosen: Row[] =
      tier1.length < 2
        ? [...tier1, ...tier2.slice(0, TIER2_MAX_CLIPS)]
        : [...tier1];

    const pack: LocalScenePack = {
      market: 'Topic (no local market)',
      locationLabel: 'Topic footage pack',
      topic,
      stations: [...new Set(chosen.map((r) => r.channelTitle))],
      clips: [],
      note: '',
      kind: 'topic',
    };

    if (chosen.length === 0) {
      pack.note =
        `No allowlisted newsroom clips found for this topic${stopReason ? ` (${stopReason})` : ''}. ` +
        'Do not invent video IDs — render the "footage thin" note.';
      this.cacheTopicPack(cacheKey, pack, true);
      this.logger.log(
        `[TopicPack] empty topic="${topic.slice(0, 50)}" ${stopReason}`,
      );
      return pack;
    }

    // 4. Verify via videos.list (embeddable + duration + date)
    const toVerify = chosen.slice(0, TOPIC_VERIFY_CAP);
    try {
      const details = await this.youtubeService.getVideoDetails(
        await this.youtubeService.getValidAccessToken(params.userId),
        toVerify.map((r) => r.videoId),
      );
      const detailById = new Map(details.map((d) => [d.videoId, d]));
      const clips: LocalClip[] = [];
      for (const row of toVerify) {
        const d = detailById.get(row.videoId);
        if (!d) continue;
        if (d.embeddable === false) continue;
        if (
          !d.durationSeconds ||
          d.durationSeconds <= 0 ||
          d.durationSeconds > maxSeconds
        )
          continue;
        const allowed = getAllowedChannel(row.channelId);
        clips.push({
          videoId: row.videoId,
          title: d.title || row.title,
          channelTitle: d.channelTitle || row.channelTitle,
          videoUrl:
            d.videoUrl || `https://www.youtube.com/watch?v=${row.videoId}`,
          durationSeconds: d.durationSeconds,
          viewCount: d.viewCount || 0,
          thumbnailUrl: d.thumbnailUrl || row.thumbnailUrl,
          publishedAt: d.publishedAt,
          market: allowed?.tier === 2 ? TIER2_LABEL : 'newsroom',
          tierLabel: allowed?.tier === 2 ? TIER2_LABEL : undefined,
        });
      }
      pack.clips = clips.slice(0, maxClips);
    } catch (err: any) {
      this.logger.warn(`[TopicPack] verify failed: ${err?.message || err}`);
      pack.note =
        'Clip verification failed. Do not invent video IDs — render the "footage thin" note.';
      this.cacheTopicPack(cacheKey, pack, true);
      return pack;
    }

    if (pack.clips.length === 0) {
      pack.note =
        `Verified clips did not pass embeddable/duration filters${stopReason ? ` (${stopReason})` : ''}. ` +
        'Render the "footage thin" note.';
      this.cacheTopicPack(cacheKey, pack, true);
      return pack;
    }

    const channels = [...new Set(pack.clips.map((c) => c.channelTitle))];
    pack.stations = channels;
    pack.note =
      `Verified newsroom clips (≤${maxSeconds}s) from allowlisted channels: ${channels.join(', ')}. ` +
      `Use as B-roll only; verify rights/editorial before monetized use.` +
      (pack.clips.some((c) => c.tierLabel)
        ? ` Clips labeled "${TIER2_LABEL}" are urban-news outlets.`
        : '');

    this.cacheTopicPack(cacheKey, pack, false);
    this.logger.log(
      `[TopicPack] pack topic="${topic.slice(0, 50)}" clips=${pack.clips.length} (t1=${tier1.length} t2=${tier2.length} q=${searchesRun})`,
    );
    return pack;
  }

  /** Cache with adaptive TTL: fresh stories 4h, older stories 24h, empty 30min. */
  private cacheTopicPack(
    key: string,
    pack: LocalScenePack,
    empty: boolean,
  ): void {
    let ttl = CACHE_NEGATIVE_MS;
    if (!empty && pack.clips.length > 0) {
      const newest = Math.max(
        ...pack.clips.map((c) =>
          c.publishedAt ? new Date(c.publishedAt).getTime() : 0,
        ),
      );
      ttl =
        Date.now() - newest <= FRESH_STORY_MS ? CACHE_FRESH_MS : CACHE_STALE_MS;
    }
    if (this.topicCache.size >= CACHE_MAX_ENTRIES) {
      const now = Date.now();
      for (const [k, v] of this.topicCache)
        if (v.expiresAt <= now) this.topicCache.delete(k);
      if (this.topicCache.size >= CACHE_MAX_ENTRIES) {
        const firstKey = this.topicCache.keys().next().value;
        if (firstKey) this.topicCache.delete(firstKey);
      }
    }
    this.topicCache.set(key, { expiresAt: Date.now() + ttl, pack });
  }

  /** Render pack for model dynamic context. */
  formatPack(pack: LocalScenePack): string {
    const lines: string[] = [];
    lines.push(
      pack.kind === 'topic'
        ? `VERIFIED TOPIC FOOTAGE PACK`
        : `LOCAL NEWS FOOTAGE PACK`,
    );
    lines.push(`Market: ${pack.market} | Topic: ${pack.topic}`);
    if (pack.stations.length > 0) {
      lines.push(
        pack.kind === 'topic'
          ? `Channels: ${pack.stations.join(', ')}`
          : `Stations to prefer: ${pack.stations.join(', ')}`,
      );
    }
    if (pack.clips.length === 0) {
      lines.push(pack.note);
      return lines.join('\n');
    }
    lines.push(
      `Use these REAL YouTube clips (URL exactly once per clip) in §17 / B-roll:`,
    );
    pack.clips.forEach((c, i) => {
      const mins = Math.floor(c.durationSeconds / 60);
      const secs = c.durationSeconds % 60;
      const label = c.tierLabel ? ` | ${c.tierLabel}` : '';
      lines.push(
        `${i + 1}. [${c.channelTitle}: ${c.title}](${c.videoUrl}) — ${mins}:${String(secs).padStart(2, '0')} | ${c.viewCount.toLocaleString()} views${label}`,
      );
    });
    lines.push(pack.note);
    return lines.join('\n');
  }
}
