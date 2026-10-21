import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ReelEntity, ReelEntityDocument } from '../db/schemas/reel-misc.schema';
import { ReelVideoPillar, ReelVideoPillarDocument } from '../db/schemas/reel-pillar.schema';
import { ReelSignal, ReelSignalDocument, SignalShare } from '../db/schemas/reel-signal.schema';
import { SharedChannel, SharedChannelDocument, SharedVideoDailyStat, SharedVideoDailyStatDocument, SourceVideo, SourceVideoDocument } from '../db/schemas/shared.readonly';
import { isBrandEntity, brandAliases } from './pillars.service';
import { BrainCandidate } from './daily-brain';

/** A trend scan older than this is not "today's news" any more. */
export const TREND_USABLE_HOURS = 30;
const FRESHNESS_HALF_LIFE_HOURS = 36;

export interface TrendRow {
  title: string;
  score: number | null;
  fetchedAt: Date;
  source?: string | null;
}

const norm = (s: string) =>
  String(s)
    .toLowerCase()
    .replace(/&#39;|&amp;|&quot;/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** How well the best current trend matches a candidate: 0..1, weighted by the trend's own opportunity score and by how fresh the scan is. */
export function matchTrend(c: Pick<BrainCandidate, 'keywords' | 'entity'>, trends: TrendRow[], now = Date.now()): { match: number; title: string | null } {
  const words = [...new Set([...(c.entity ? [c.entity] : []), ...c.keywords.slice(0, 4)].map(norm).filter((w) => w.length >= 3))];
  let best = { match: 0, title: null as string | null };
  for (const t of trends) {
    const title = ` ${norm(t.title)} `;
    const hits = words.filter((w) => title.includes(` ${w} `) || title.includes(w)).length;
    if (!hits) continue;
    const ageH = Math.max(0, (now - t.fetchedAt.getTime()) / 3_600_000);
    if (ageH > TREND_USABLE_HOURS) continue;
    const fresh = Math.pow(0.5, ageH / FRESHNESS_HALF_LIFE_HOURS);
    const relevance = Math.min(1, hits / Math.min(2, words.length));
    // opportunity score is 0-100 and mostly low (median in the live data is 13-50): scale so a mid score still counts
    const opp = t.score === null ? 0.4 : Math.min(1, 0.25 + t.score / 70);
    const m = Math.min(1, relevance * opp * (0.5 + 0.5 * fresh));
    if (m > best.match) best = { match: Math.round(m * 1000) / 1000, title: t.title };
  }
  return best;
}

/** Share of the channel's last-3-day views that went to videos about this candidate (by person first, then by pillar). */
export function velocityShareFor(c: Pick<BrainCandidate, 'entity' | 'pillar'>, snap: { byEntity: SignalShare[]; byPillar: SignalShare[] } | undefined): number {
  if (!snap) return 0;
  const e = c.entity ? snap.byEntity.find((x) => x.key === c.entity) : undefined;
  if (e) return e.share3d;
  const p = c.pillar ? snap.byPillar.find((x) => x.key === c.pillar) : undefined;
  return p ? p.share3d : 0;
}

/** Builds and stores the day's signal snapshot from data that already exists (no API calls, no cost). */
@Injectable()
export class SignalsService {
  private readonly logger = new Logger(SignalsService.name);

  constructor(
    @InjectModel(ReelSignal.name) private readonly signals: Model<ReelSignalDocument>,
    @InjectModel(ReelEntity.name) private readonly entities: Model<ReelEntityDocument>,
    @InjectModel(ReelVideoPillar.name) private readonly videoPillars: Model<ReelVideoPillarDocument>,
    @InjectModel(SharedVideoDailyStat.name) private readonly stats: Model<SharedVideoDailyStatDocument>,
    @InjectModel(SharedChannel.name) private readonly channels: Model<SharedChannelDocument>,
    @InjectModel(SourceVideo.name) private readonly videos: Model<SourceVideoDocument>,
  ) {}

  async trends(channelId: Types.ObjectId): Promise<TrendRow[]> {
    const since = new Date(Date.now() - 72 * 3_600_000);
    const rows = await this.signals.db
      .collection('trending_topics')
      .find({ channelId, fetchedAt: { $gte: since } }, { projection: { title: 1, opportunityScore: 1, fetchedAt: 1, sourceType: 1 } })
      .sort({ fetchedAt: -1 })
      .limit(120)
      .toArray()
      .catch(() => []);
    return rows.map((r: any) => ({ title: String(r.title), score: typeof r.opportunityScore === 'number' ? r.opportunityScore : null, fetchedAt: new Date(r.fetchedAt), source: r.sourceType ?? null }));
  }

  async brands(channelId: Types.ObjectId): Promise<string[]> {
    const ch = await this.channels.findOne({ _id: channelId }).lean();
    return brandAliases(ch?.name, (ch as any)?.handle);
  }

  async latest(channelId: Types.ObjectId) {
    return this.signals.findOne({ channelId }).sort({ date: -1 }).lean();
  }

  /** Person/case names (and their aliases) that count as entities: never the channel's own brand. */
  async entityKeys(channelId: Types.ObjectId): Promise<Array<{ key: string; names: string[] }>> {
    const brands = await this.brands(channelId);
    const ents = await this.entities.find({ channelId }).select('slug name aliases').lean();
    return ents
      .filter((e) => !isBrandEntity(e.name, brands) && !(e.aliases ?? []).some((a) => isBrandEntity(a, brands)))
      .map((e) => ({ key: e.name.toLowerCase(), names: [...new Set([e.name, ...(e.aliases ?? [])].map((n) => n.toLowerCase()).filter((n) => n.length >= 3))] }));
  }

  async snapshot(channelId: Types.ObjectId, date: string) {
    const degraded: string[] = [];

    // ---- own channel: what is actually being watched right now
    let own: ReelSignal['own'];
    const newest = await this.stats.find({ channelId }).sort({ date: -1 }).limit(1).select('date').lean();
    if (!newest.length) degraded.push('No channel analytics yet');
    else {
      const through = newest[0].date;
      const day = (back: number) => new Date(new Date(`${through}T00:00:00Z`).getTime() - back * 86_400_000).toISOString().slice(0, 10);
      const rows = await this.stats.aggregate<{ _id: Types.ObjectId; v3: number; v14: number }>([
        { $match: { channelId, date: { $gte: day(13), $lte: through } } },
        { $group: { _id: '$videoId', v3: { $sum: { $cond: [{ $gte: ['$date', day(2)] }, '$views', 0] } }, v14: { $sum: '$views' } } },
      ]);
      const vids = await this.videos.find({ _id: { $in: rows.map((r) => r._id) } }).select('youtubeId title').lean();
      const meta = new Map(vids.map((v: any) => [String(v._id), v]));
      const total3 = rows.reduce((n, r) => n + r.v3, 0);
      const total14 = rows.reduce((n, r) => n + r.v14, 0);
      const ents = await this.entityKeys(channelId);
      const pillarOf = new Map((await this.videoPillars.find({ channelId }).select('youtubeId pillar').lean()).map((p) => [p.youtubeId, p.pillar]));
      const entViews = new Map<string, number>();
      const pilViews = new Map<string, number>();
      for (const r of rows) {
        const m: any = meta.get(String(r._id));
        if (!m || !r.v3) continue;
        const title = norm(m.title);
        for (const e of ents) if (e.names.some((n) => title.includes(norm(n)))) entViews.set(e.key, (entViews.get(e.key) ?? 0) + r.v3);
        const p = pillarOf.get(m.youtubeId);
        if (p) pilViews.set(p, (pilViews.get(p) ?? 0) + r.v3);
      }
      const shares = (map: Map<string, number>): SignalShare[] =>
        [...map]
          .map(([key, views3d]) => ({ key, views3d, share3d: total3 ? Math.round((views3d / total3) * 1000) / 1000 : 0 }))
          .sort((a, b) => b.views3d - a.views3d)
          .slice(0, 12);
      own = {
        through,
        views3d: total3,
        views14d: total14,
        byEntity: shares(entViews),
        byPillar: shares(pilViews),
        topVideos: rows
          .sort((a, b) => b.v3 - a.v3)
          .slice(0, 8)
          .map((r) => ({ youtubeId: (meta.get(String(r._id)) as any)?.youtubeId ?? '', title: String((meta.get(String(r._id)) as any)?.title ?? ''), views3d: r.v3 })),
      };
      const behind = Math.floor((Date.now() - new Date(`${through}T00:00:00Z`).getTime()) / 86_400_000);
      if (behind > 3) degraded.push(`Channel analytics are ${behind} days behind`);
      if (total3 < 200) degraded.push('Channel traffic is too small to rank topics by velocity');
    }

    // ---- trends
    const rows = await this.trends(channelId);
    const freshest = rows[0]?.fetchedAt ?? null;
    const ageHours = freshest ? Math.round(((Date.now() - freshest.getTime()) / 3_600_000) * 10) / 10 : null;
    const usable = rows.filter((r) => (Date.now() - r.fetchedAt.getTime()) / 3_600_000 <= TREND_USABLE_HOURS);
    if (!rows.length) degraded.push('No trend scan in the last 72 hours');
    else if (!usable.length) degraded.push(`Trend scan is ${Math.round(ageHours ?? 0)} hours old`);
    const full = usable.filter((r) => r.source && r.source !== 'lite');
    if (usable.length && !full.length) degraded.push('Only quick ("lite") trend scans are available; the full daily scan has not succeeded recently');

    const doc = {
      own,
      trends: {
        count: rows.length,
        usable: usable.length,
        freshestAt: freshest,
        ageHours,
        top: [...usable].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 8).map((t) => ({ title: t.title, score: t.score, ageHours: Math.round(((Date.now() - t.fetchedAt.getTime()) / 3_600_000) * 10) / 10, source: t.source ?? null })),
      },
      degraded,
    };
    await this.signals.updateOne({ channelId, date }, { $set: doc, $setOnInsert: { channelId, date } }, { upsert: true });
    return { ...doc, trendRows: rows };
  }
}
