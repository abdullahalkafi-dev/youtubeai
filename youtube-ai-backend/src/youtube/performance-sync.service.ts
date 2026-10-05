import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import { Channel, ChannelDocument } from '../mongo/schemas/channel.schema';
import { Video } from '../mongo/schemas/video.schema';
import { VideoDailyStats } from '../mongo/schemas/video-daily-stats.schema';
import { YoutubeReportingService } from './youtube-reporting.service';
import { YoutubeAnalyticsService } from './youtube-analytics.service';

/** Rolling window for the "fresh" fields (ctr, impressions, views7d, ...). */
const WINDOW_DAYS = 7;
/** Reach download window — also refreshes lifetimeCtr/lifetimeImpressions (rolling). */
const LIFETIME_WINDOW_DAYS = 35;
/** Minimum impressions before a CTR value is trusted (below this ctr is cleared). */
const MIN_IMPRESSIONS = 100;
/** Daily snapshots only for videos published within this window OR actively measured. */
const SNAPSHOT_MAX_AGE_DAYS = 120;
const CHUNK = 500;

export interface RunReport {
  ok: boolean;
  source: string;
  channelId: string;
  windowDays: number;
  videosUpdated: number;
  clearedStale: number;
  snapshotRows: number;
  filesUsed: number;
  durationMs: number;
  errors: string[];
}

const num = (v: string | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Report CSV date column is YYYYMMDD (e.g. "20260901") — normalize to
 * YYYY-MM-DD so window comparisons ("date >= cutoff") work lexicographically.
 * A raw YYYYMMDD string would otherwise ALWAYS compare >= "2026-09-28"
 * (digit '0' > '-'), silently widening the 7-day window to the full file set.
 */
const toIsoDate = (raw: string): string => {
  if (raw && /^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return raw;
};

/** Numeric traffic_source_type codes → human labels (YouTube Reporting enum). */
const TRAFFIC_SOURCE_LABELS: Record<string, string> = {
  '0': 'Direct / Unknown',
  '1': 'YouTube Ads',
  '3': 'Browse / Home',
  '4': 'Channels',
  '5': 'YouTube Search',
  '7': 'Suggested Videos',
  '8': 'Other YouTube',
  '9': 'External Websites',
  '11': 'Cards / Annotations',
  '14': 'Playlists',
  '17': 'Notifications',
  '18': 'Playlist Pages',
  '20': 'End Screens',
  '23': 'Stories',
  '24': 'Shorts',
  '25': 'Product Pages',
  '26': 'Hashtag Pages',
  '27': 'Sound Pages',
  '28': 'Live Redirect',
  '29': 'Podcasts',
  '30': 'Remixes',
  '31': 'Vertical Live',
  '32': 'Shorts Related',
};

const trafficLabel = (code: string): string =>
  TRAFFIC_SOURCE_LABELS[code] || `Source ${code}`;

const prettyAge = (raw: string): string => {
  const m = /^AGE_(\d+)_(\d+)$/.exec(raw);
  if (m) return `${m[1]}–${m[2]}`;
  if (raw === 'AGE_65_' || raw === 'AGE_65_PLUS') return '65+';
  if (raw === 'AGE_UNKNOWN') return 'Unknown';
  return raw.replace(/^AGE_/, '').replace(/_/g, ' ').trim();
};

const prettyGender = (raw: string): string => {
  if (raw === 'MALE') return 'Male';
  if (raw === 'FEMALE') return 'Female';
  return raw.charAt(0) + raw.slice(1).toLowerCase();
};

/**
 * Daily performance sync — pulls ALL four YouTube Reporting API report types
 * plus the Analytics API bulk query, then persists a fresh performance
 * snapshot for every video (and the channel) in one bulkWrite.
 *
 * Sources (all Reporting API = 0 Data API quota units):
 *  - channel_reach_basic_a1   → ctr / impressions (fresh 7d + rolling 35d lifetime)
 *  - channel_basic_a3         → views, watch minutes, likes, comments, subs (7d)
 *  - channel_traffic_source_a3→ per-video traffic mix (7d)
 *  - channel_demographics_a1  → channel audience profile (7d, weighted by country views)
 *  - Analytics API (1 query)  → avgWatchTime, retentionPercent, revenue (existing method)
 *
 * Runs daily at 6:00 AM America/New_York (before the 7:30 SEO batch) and on
 * demand via POST /channels/:id/performance-sync.
 */
@Injectable()
export class PerformanceSyncService {
  private readonly logger = new Logger(PerformanceSyncService.name);
  private readonly running = new Set<string>();

  constructor(
    @InjectModel(Channel.name) private readonly channelModel: Model<ChannelDocument>,
    @InjectModel(Video.name) private readonly videoModel: Model<any>,
    @InjectModel(VideoDailyStats.name) private readonly dailyStatsModel: Model<VideoDailyStats>,
    private readonly reporting: YoutubeReportingService,
    private readonly analytics: YoutubeAnalyticsService,
  ) {}

  @Cron('0 6 * * *', { timeZone: 'America/New_York' })
  async handleDailySync() {
    const channels = await this.channelModel
      .find({ youtubeChannelId: { $exists: true, $ne: null } })
      .lean();
    this.logger.log(
      `Daily performance sync starting for ${channels.length} channel(s)`,
    );
    for (const ch of channels) {
      const id = ch._id.toString();
      try {
        const report = await this.syncChannel(id, 'cron');
        this.logger.log(
          `Daily performance sync done for ${id}: videos=${report.videosUpdated} snapshot=${report.snapshotRows} files=${report.filesUsed} errors=${report.errors.length} (${report.durationMs}ms)`,
        );
      } catch (err: any) {
        this.logger.warn(
          `Daily performance sync failed for ${id}: ${err?.message || err}`,
        );
      }
    }
  }

  /** Manual trigger (POST /channels/:id/performance-sync). */
  async syncChannelNow(channelId: string, userId: string): Promise<RunReport> {
    return this.syncChannel(channelId, 'manual', userId);
  }

  async syncChannel(
    channelId: string,
    source: string,
    userIdOverride?: string,
  ): Promise<RunReport> {
    if (this.running.has(channelId)) {
      throw new ConflictException('Performance sync is already running for this channel');
    }
    this.running.add(channelId);
    const startedAt = Date.now();
    const errors: string[] = [];
    let filesUsed = 0;

    const report: RunReport = {
      ok: false,
      source,
      channelId,
      windowDays: WINDOW_DAYS,
      videosUpdated: 0,
      clearedStale: 0,
      snapshotRows: 0,
      filesUsed: 0,
      durationMs: 0,
      errors,
    };

    try {
      const channel = await this.channelModel.findById(channelId);
      if (!channel?.youtubeChannelId) {
        throw new ConflictException('Channel has no linked YouTube channel');
      }
      const uid = userIdOverride || channel.userId?.toString();
      if (!uid) throw new ConflictException('Channel has no linked user account');
      const ytChannelId = channel.youtubeChannelId;

      const videoDocs = await this.videoModel
        .find({ channelId: channel._id, youtubeId: { $exists: true, $ne: null } })
        .select('youtubeId channelId publishedAt performanceSyncedAt')
        .lean();
      const docByYt = new Map<string, any>(videoDocs.map((v) => [v.youtubeId, v]));

      const freshCutoff = new Date(Date.now() - WINDOW_DAYS * 864e5)
        .toISOString()
        .slice(0, 10);
      const snapshotCutoff = freshCutoff;
      const publishCutoff = Date.now() - SNAPSHOT_MAX_AGE_DAYS * 864e5;

      // Accumulators -------------------------------------------------------
      /** ytId -> rolling 35d reach */
      const lifetimeReach = new Map<string, { imp: number; clicks: number }>();
      /** ytId -> fresh 7d reach */
      const freshReach = new Map<string, { imp: number; clicks: number }>();
      /** `${ytId}|${date}` -> daily metrics (reach + basic merged) */
      const daily = new Map<string, {
        impressions: number;
        clicks: number;
        views: number;
        watchMinutes: number;
        likes: number;
        subsGained: number;
        retentionNum: number;
        retentionDen: number;
      }>();
      /** ytId -> 7d basic aggregates */
      const basic = new Map<string, {
        views: number;
        watchMinutes: number;
        likes: number;
        comments: number;
        subsGained: number;
        subsLost: number;
        retentionNum: number;
        retentionDen: number;
      }>();
      /** ytId -> traffic source -> 7d views */
      const traffic = new Map<string, Map<string, number>>();
      /** country -> 7d views (weights for demographics) */
      const countryViews = new Map<string, number>();
      /** age/gender weighted accumulators */
      const ageW = new Map<string, number>();
      const genderW = new Map<string, number>();

      const dayCell = (ytId: string, date: string) => {
        const key = `${ytId}|${date}`;
        let c = daily.get(key);
        if (!c) {
          c = { impressions: 0, clicks: 0, views: 0, watchMinutes: 0, likes: 0, subsGained: 0, retentionNum: 0, retentionDen: 0 };
          daily.set(key, c);
        }
        return c;
      };

      // A. Reach: impressions + CTR (fresh 7d, lifetime 35d, daily snapshot) --
      try {
        const res = await this.reporting.streamReport(
          uid,
          'channel_reach_basic_a1',
          LIFETIME_WINDOW_DAYS,
          ['video_id', 'video_thumbnail_impressions', 'video_thumbnail_impressions_ctr'],
          (date, [ytId, impS, ctrS]) => {
            if (!ytId) return;
            const imp = num(impS);
            if (imp <= 0) return;
            const d = toIsoDate(date);
            const clicks = imp * num(ctrS); // Reporting API delivers CTR as 0..1 fraction
            let life = lifetimeReach.get(ytId);
            if (!life) { life = { imp: 0, clicks: 0 }; lifetimeReach.set(ytId, life); }
            life.imp += imp;
            life.clicks += clicks;
            if (d >= freshCutoff) {
              let f = freshReach.get(ytId);
              if (!f) { f = { imp: 0, clicks: 0 }; freshReach.set(ytId, f); }
              f.imp += imp;
              f.clicks += clicks;
            }
            if (d >= snapshotCutoff) {
              const c = dayCell(ytId, d);
              c.impressions += imp;
              c.clicks += clicks;
            }
          },
        );
        filesUsed += res.files;
        if (res.missing.length) errors.push(`reach missing columns: ${res.missing.join(',')}`);
        if (!res.files) errors.push('reach: no report files in window');
      } catch (e: any) {
        errors.push(`reach: ${e?.message || e}`);
      }

      // B. Basic: views/watch/likes/comments/subs + country weights + daily ----
      try {
        const res = await this.reporting.streamReport(
          uid,
          'channel_basic_a3',
          WINDOW_DAYS,
          ['video_id', 'country_code', 'views', 'watch_time_minutes', 'likes', 'comments', 'subscribers_gained', 'subscribers_lost', 'average_view_duration_percentage'],
          (date, [ytId, country, viewsS, watchS, likesS, commentsS, subsGS, subsLS, pctS]) => {
            if (country) countryViews.set(country, (countryViews.get(country) || 0) + num(viewsS));
            if (!ytId) return;
            const d = toIsoDate(date);
            const views = num(viewsS);
            const pct = num(pctS);
            let b = basic.get(ytId);
            if (!b) {
              b = { views: 0, watchMinutes: 0, likes: 0, comments: 0, subsGained: 0, subsLost: 0, retentionNum: 0, retentionDen: 0 };
              basic.set(ytId, b);
            }
            b.views += views;
            b.watchMinutes += num(watchS);
            b.likes += num(likesS);
            b.comments += num(commentsS);
            b.subsGained += num(subsGS);
            b.subsLost += num(subsLS);
            b.retentionNum += views * pct;
            b.retentionDen += views;
            if (d >= snapshotCutoff) {
              const c = dayCell(ytId, d);
              c.views += views;
              c.watchMinutes += num(watchS);
              c.likes += num(likesS);
              c.subsGained += num(subsGS);
              c.retentionNum += views * pct;
              c.retentionDen += views;
            }
          },
        );
        filesUsed += res.files;
        if (res.missing.length) errors.push(`basic missing columns: ${res.missing.join(',')}`);
      } catch (e: any) {
        errors.push(`basic: ${e?.message || e}`);
      }

      // C. Traffic sources per video (7d) ------------------------------------
      try {
        const res = await this.reporting.streamReport(
          uid,
          'channel_traffic_source_a3',
          WINDOW_DAYS,
          ['video_id', 'traffic_source_type', 'views'],
          (date, [ytId, sourceCol, viewsS]) => {
            if (!ytId || !sourceCol) return;
            const label = trafficLabel(sourceCol); // numeric enum → human label
            let t = traffic.get(ytId);
            if (!t) { t = new Map(); traffic.set(ytId, t); }
            t.set(label, (t.get(label) || 0) + num(viewsS));
          },
        );
        filesUsed += res.files;
        if (res.missing.length) errors.push(`traffic missing columns: ${res.missing.join(',')}`);
      } catch (e: any) {
        errors.push(`traffic: ${e?.message || e}`);
      }

      // D. Demographics (7d, weighted by country views) ------------------------
      try {
        const res = await this.reporting.streamReport(
          uid,
          'channel_demographics_a1',
          WINDOW_DAYS,
          ['country_code', 'age_group', 'gender', 'views_percentage'],
          (_date, [country, ageGroup, gender, pctS]) => {
            if (!ageGroup || ageGroup === 'AGE_UNKNOWN') return;
            const w = num(pctS) / 100 * (countryViews.get(country || '') || 0);
            if (w <= 0) return;
            ageW.set(ageGroup, (ageW.get(ageGroup) || 0) + w);
            if (gender === 'MALE' || gender === 'FEMALE') {
              genderW.set(gender, (genderW.get(gender) || 0) + w);
            }
          },
        );
        filesUsed += res.files;
        if (res.missing.length) errors.push(`demographics missing columns: ${res.missing.join(',')}`);
      } catch (e: any) {
        errors.push(`demographics: ${e?.message || e}`);
      }

      // E. Analytics API bulk (lifetime avgWatchTime / retention / revenue) -----
      const analyticsByYt = new Map<string, any>();
      try {
        const map = await this.analytics.getChannelVideoAnalytics(uid, ytChannelId);
        for (const [ytId, a] of map) analyticsByYt.set(ytId, a);
      } catch (e: any) {
        errors.push(`analytics: ${e?.message || e}`);
      }

      // Compose per-video updates -------------------------------------------
      const now = new Date();
      const ops: any[] = [];

      const mergeMap = new Map<string, any>();
      const sources = new Set<string>([
        ...lifetimeReach.keys(),
        ...basic.keys(),
        ...traffic.keys(),
        ...analyticsByYt.keys(),
      ]);
      for (const ytId of sources) {
        const doc = docByYt.get(ytId);
        if (!doc) continue;
        const set: any = { performanceSyncedAt: now };

        const fresh = freshReach.get(ytId);
        if (fresh) {
          set.impressions = fresh.imp;
          set.ctr = fresh.imp >= MIN_IMPRESSIONS
            ? Math.round((fresh.clicks / fresh.imp) * 10000) / 100
            : null;
        } else if (doc.performanceSyncedAt) {
          // Data in other sources (or older windows) but ZERO reach this week →
          // clear the fresh fields so SEO/UI never trust a stale CTR.
          set.ctr = null;
          set.impressions = 0;
        }
        const life = lifetimeReach.get(ytId);
        if (life && life.imp > 0) {
          set.lifetimeImpressions = life.imp;
          set.lifetimeCtr = Math.round((life.clicks / life.imp) * 10000) / 100;
        }
        const b = basic.get(ytId);
        if (b) {
          set.views7d = b.views;
          set.watchMinutes7d = Math.round(b.watchMinutes * 100) / 100;
          set.likes7d = b.likes;
          set.comments7d = b.comments;
          set.subsGained7d = b.subsGained;
          set.subsLost7d = b.subsLost;
        }
        const t = traffic.get(ytId);
        if (t && t.size) {
          const total = [...t.values()].reduce((s, v) => s + v, 0);
          const top = [...t.entries()]
            .sort((a, c) => c[1] - a[1])
            .slice(0, 5)
            .map(([source, v]) => ({
              source,
              views: v,
              sharePct: total > 0 ? Math.round((v / total) * 1000) / 10 : 0,
            }));
          set.trafficSourceBreakdown = top;
        }
        const a = analyticsByYt.get(ytId);
        if (a) {
          set.avgWatchTime = a.averageViewDuration;
          set.retentionPercent = a.averageViewPercentage;
          set.estimatedRevenue = a.estimatedRevenue;
          set.lastAnalyticsSync = now;
        }
        mergeMap.set(String(doc._id), set);
      }

      // Clear stale fresh fields: previously synced videos with zero reach in window
      let clearedStale = 0;
      for (const doc of videoDocs) {
        if (!doc.performanceSyncedAt) continue;
        const ytId = doc.youtubeId;
        if (freshReach.has(ytId)) continue;
        const set = mergeMap.get(String(doc._id)) || {};
        if (!('impressions' in set)) {
          set.ctr = null;
          set.impressions = 0;
          set.performanceSyncedAt = now;
          mergeMap.set(String(doc._id), set);
          clearedStale++;
        }
      }

      for (const [id, set] of mergeMap) {
        ops.push({ updateOne: { filter: { _id: new Types.ObjectId(id) }, update: { $set: set } } });
      }

      let updated = 0;
      for (let i = 0; i < ops.length; i += CHUNK) {
        const res = await this.videoModel.bulkWrite(ops.slice(i, i + CHUNK), { ordered: false });
        updated += res.modifiedCount || 0;
      }
      report.videosUpdated = updated;
      report.clearedStale = clearedStale;

      // Daily snapshot rows ---------------------------------------------------
      let snapshotRows = 0;
      const snapshotOps: any[] = [];
      for (const [key, cell] of daily) {
        const sep = key.lastIndexOf('|');
        const ytId = key.slice(0, sep);
        const date = key.slice(sep + 1);
        const doc = docByYt.get(ytId);
        if (!doc) continue;
        const life = lifetimeReach.get(ytId);
        const fresh = freshReach.get(ytId);
        const active =
          (doc.publishedAt && new Date(doc.publishedAt).getTime() >= publishCutoff) ||
          (fresh && fresh.imp >= MIN_IMPRESSIONS) ||
          (life && life.imp >= MIN_IMPRESSIONS);
        if (!active) continue;
        const ctr =
          cell.impressions >= MIN_IMPRESSIONS && cell.clicks > 0
            ? Math.round((cell.clicks / cell.impressions) * 10000) / 100
            : undefined;
        snapshotOps.push({
          updateOne: {
            filter: { videoId: doc._id, date },
            update: {
              $set: {
                channelId: doc.channelId ?? channel._id,
                views: cell.views,
                impressions: cell.impressions,
                ...(ctr !== undefined ? { ctr } : {}),
                watchMinutes: Math.round(cell.watchMinutes * 100) / 100,
                ...(cell.retentionDen > 0
                  ? { retentionPct: Math.round(cell.retentionNum / cell.retentionDen * 100) / 100 }
                  : {}),
                likes: cell.likes,
                subsGained: cell.subsGained,
              },
            },
            upsert: true,
          },
        });
      }
      for (let i = 0; i < snapshotOps.length; i += CHUNK) {
        const res = await this.dailyStatsModel.bulkWrite(snapshotOps.slice(i, i + CHUNK), { ordered: false });
        snapshotRows += res.upsertedCount || 0;
      }
      report.snapshotRows = snapshotRows;

      // Channel-level: audience profile + run report --------------------------
      const channelUpdate: any = {};
      if (ageW.size) {
        const ageTotal = [...ageW.values()].reduce((s, v) => s + v, 0);
        const genderTotal = [...genderW.values()].reduce((s, v) => s + v, 0);
        const ageGroups = [...ageW.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([label, v]) => ({
            label: prettyAge(label),
            sharePct: ageTotal > 0 ? Math.round((v / ageTotal) * 1000) / 10 : 0,
          }));
        const genderSplit = [...genderW.entries()].map(([label, v]) => ({
          label: prettyGender(label),
          sharePct: genderTotal > 0 ? Math.round((v / genderTotal) * 1000) / 10 : 0,
        }));
        channelUpdate.audienceProfile = {
          ageGroups,
          genderSplit,
          windowDays: WINDOW_DAYS,
          syncedAt: now,
        };
      }

      report.filesUsed = filesUsed;
      report.durationMs = Date.now() - startedAt;
      report.ok = errors.length === 0;

      channelUpdate.performanceSync = {
        lastRunAt: now,
        windowDays: WINDOW_DAYS,
        videosUpdated: updated,
        snapshotRows,
        filesUsed,
        durationMs: report.durationMs,
        errors: errors.slice(0, 10),
        nextRunAt: new Date(now.getTime() + 24 * 3600 * 1000),
        source,
      };
      await this.channelModel.updateOne({ _id: channel._id }, { $set: channelUpdate });

      this.logger.log(
        `Performance sync (${source}) channel=${channelId}: videos=${updated} cleared=${clearedStale} snapshots=${snapshotRows} files=${filesUsed} errors=${errors.length} (${report.durationMs}ms)`,
      );
      if (errors.length) this.logger.warn(`Performance sync errors: ${errors.join(' | ')}`);

      return report;
    } finally {
      this.running.delete(channelId);
    }
  }
}
