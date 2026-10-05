import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Video } from '../mongo/schemas/video.schema';
import { Channel, ChannelDocument } from '../mongo/schemas/channel.schema';

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;
const MIN_IMPRESSIONS = 100;

export interface SeoPatternContext {
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
  /** Impression-weighted channel baseline CTR (%) over measured videos. */
  channelBaselineCtr?: number;
  /** How many videos currently have a trusted CTR (impressions >= 100). */
  measuredCount: number;
  /** Human label of the CTR window — printed in prompts and UI. */
  windowLabel: string;
  /** Last sync time from the daily performance sync (ISO) if known. */
  lastSyncedAt?: string;
  /** Channel traffic mix (7d) — Browse vs Search vs Suggested, etc. */
  trafficMix?: Array<{ source: string; sharePct: number }>;
}

/**
 * Single source of truth for "what titles convert on THIS channel".
 * Used by: details-page SEO, daily automation batch, and the chat SEO skill —
 * so every surface reasons from the same winners/misses/baseline numbers.
 *
 * Data comes from the daily PerformanceSyncService (7-day rolling CTR window).
 */
@Injectable()
export class SeoDataService {
  constructor(
    @InjectModel(Video.name) private readonly videoModel: Model<any>,
    @InjectModel(Channel.name) private readonly channelModel: Model<ChannelDocument>,
  ) {}

  async getSeoPatternContext(
    channelId: Types.ObjectId | string,
    excludeVideoId?: Types.ObjectId | string,
  ): Promise<SeoPatternContext> {
    const cid =
      channelId instanceof Types.ObjectId
        ? channelId
        : new Types.ObjectId(String(channelId));
    const sixtyDaysAgo = new Date(Date.now() - SIXTY_DAYS_MS);

    const base: SeoPatternContext = {
      highCtrWinners: [],
      lowCtrMisses: [],
      measuredCount: 0,
      windowLabel: 'CTR window: last 7 days (daily YouTube sync)',
    };

    try {
      const channel = await this.channelModel
        .findById(cid)
        .select('performanceSync')
        .lean();
      if (channel?.performanceSync?.lastRunAt) {
        base.lastSyncedAt = new Date(channel.performanceSync.lastRunAt).toISOString();
        base.windowLabel = `CTR window: last 7 days (synced from YouTube ${new Date(
          channel.performanceSync.lastRunAt,
        ).toISOString()})`;
      }
    } catch {
      /* channel lookup optional */
    }

    // Channel baseline: impression-weighted mean CTR of every measured video
    try {
      const agg = await this.videoModel.aggregate([
        {
          $match: {
            channelId: cid,
            ctr: { $gt: 0 },
            impressions: { $gte: MIN_IMPRESSIONS },
          },
        },
        {
          $group: {
            _id: null,
            imp: { $sum: '$impressions' },
            weighted: { $sum: { $multiply: ['$ctr', '$impressions'] } },
            n: { $sum: 1 },
          },
        },
      ]);
      if (agg?.[0]?.imp > 0) {
        base.channelBaselineCtr =
          Math.round((agg[0].weighted / agg[0].imp) * 10) / 10;
        base.measuredCount = agg[0].n || 0;
      }
    } catch {
      /* baseline optional */
    }

    // Measured pool: recent videos with a trusted CTR
    const pool = await this.videoModel
      .find({
        channelId: cid,
        publishedAt: { $gte: sixtyDaysAgo },
        ...(excludeVideoId ? { _id: { $ne: excludeVideoId } } : {}),
        deletedFromYoutube: { $ne: true },
        ctr: { $gt: 0 },
        impressions: { $gte: MIN_IMPRESSIONS },
      })
      .sort({ ctr: -1 })
      .limit(20)
      .select('title description viewCount ctr impressions tags')
      .lean();

    const fmt = (v: any) => ({
      title: v.title,
      description: v.description ? String(v.description).slice(0, 300) : undefined,
      views: v.viewCount || 0,
      ctr: v.ctr,
      impressions: v.impressions,
      tags: v.tags,
    });

    if (pool.length >= 3) {
      const baseline = base.channelBaselineCtr ?? 0;
      const winners = pool.filter((v) => v.ctr >= baseline).slice(0, 8);
      base.highCtrWinners = (
        winners.length >= 3 ? winners : pool.slice(0, 8)
      ).map(fmt);
      const winnerTitles = new Set(
        base.highCtrWinners.map((w) => w.title.toLowerCase()),
      );
      base.lowCtrMisses = pool
        .filter((v) => v.ctr < baseline && !winnerTitles.has(v.title.toLowerCase()))
        .sort((a, b) => a.ctr - b.ctr)
        .slice(0, 5)
        .map(fmt);
    } else {
      // Fallback: not enough measured videos yet → top views (no CTR claims)
      const topViewDocs = await this.videoModel
        .find({
          channelId: cid,
          publishedAt: { $gte: sixtyDaysAgo },
          ...(excludeVideoId ? { _id: { $ne: excludeVideoId } } : {}),
          deletedFromYoutube: { $ne: true },
        })
        .sort({ viewCount: -1 })
        .limit(8)
        .select('title description viewCount tags')
        .lean();
      base.highCtrWinners = topViewDocs.map(fmt);
    }

    // Traffic mix (7d) — tells SEO whether to win the home feed or search
    try {
      const withTraffic = await this.videoModel
        .find({ channelId: cid, trafficSourceBreakdown: { $exists: true, $ne: [] } })
        .select('trafficSourceBreakdown')
        .lean();
      const totals = new Map<string, number>();
      for (const v of withTraffic) {
        for (const row of v.trafficSourceBreakdown || []) {
          if (!row?.source) continue;
          totals.set(row.source, (totals.get(row.source) || 0) + (row.views || 0));
        }
      }
      if (totals.size) {
        const sum = [...totals.values()].reduce((s, n) => s + n, 0);
        base.trafficMix = [...totals.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([source, views]) => ({
            source,
            sharePct: sum > 0 ? Math.round((views / sum) * 1000) / 10 : 0,
          }));
      }
    } catch {
      /* traffic mix optional */
    }

    return base;
  }
}
