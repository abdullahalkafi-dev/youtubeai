import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { z } from 'zod';
import { AiService } from '../ai/ai.service';
import { slugify } from '../common/text';
import { AppConfig, CONFIG } from '../config/config';
import { Reel, ReelDocument } from '../db/schemas/reel.schema';
import { ReelMoment, ReelMomentDocument } from '../db/schemas/reel-moment.schema';
import { ReelPost, ReelPostDocument } from '../db/schemas/reel-post.schema';
import { PillarDef, ReelPillarSet, ReelPillarSetDocument, ReelVideoPillar, ReelVideoPillarDocument } from '../db/schemas/reel-pillar.schema';
import { SourceVideo, SourceVideoDocument } from '../db/schemas/shared.readonly';
import { PillarState } from './daily-brain';

const TaxonomySchema = z.object({
  pillars: z.array(z.object({ key: z.string(), name: z.string(), description: z.string() })).min(6).max(14),
});
const LabelSchema = z.object({ labels: z.array(z.object({ id: z.number().int(), pillar: z.string() })) });

const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Brand and generic names that are not people/cases: never an "entity" for coverage or saturation. */
export function brandAliases(channelName?: string | null, handle?: string | null): string[] {
  return [channelName, handle, channelName?.replace(/\s+/g, '')]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase().replace(/^@/, '').trim())
    .filter((s) => s.length >= 3);
}
export function isBrandEntity(name: string, brands: string[]): boolean {
  const n = name.toLowerCase().trim();
  return brands.some((b) => n === b || n.replace(/\s+/g, '') === b.replace(/\s+/g, ''));
}

/**
 * Content pillars: a stable topic list the whole Daily Brain aggregates on. Built once by the model from the channel's own
 * themes, people and catalog titles; every new moment, reel and catalog video is then filed under exactly one pillar.
 */
@Injectable()
export class PillarService {
  private readonly logger = new Logger(PillarService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @InjectModel(ReelPillarSet.name) private readonly sets: Model<ReelPillarSetDocument>,
    @InjectModel(ReelVideoPillar.name) private readonly videoPillars: Model<ReelVideoPillarDocument>,
    @InjectModel(ReelMoment.name) private readonly moments: Model<ReelMomentDocument>,
    @InjectModel(Reel.name) private readonly reels: Model<ReelDocument>,
    @InjectModel(ReelPost.name) private readonly posts: Model<ReelPostDocument>,
    @InjectModel(SourceVideo.name) private readonly videos: Model<SourceVideoDocument>,
    private readonly ai: AiService,
  ) {}

  async list(channelId: Types.ObjectId): Promise<PillarDef[]> {
    return (await this.sets.findOne({ channelId }).lean())?.pillars ?? [];
  }

  /** The taxonomy, created on first use. */
  async ensureTaxonomy(channelId: Types.ObjectId): Promise<PillarDef[]> {
    const existing = await this.list(channelId);
    if (existing.length) return existing;

    const [themes, entities, titles] = await Promise.all([
      this.moments.aggregate<{ _id: string; n: number }>([{ $match: { channelId } }, { $unwind: '$themes' }, { $group: { _id: '$themes', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 120 }]),
      this.moments.aggregate<{ _id: string; n: number }>([{ $match: { channelId } }, { $unwind: '$entityNames' }, { $group: { _id: '$entityNames', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 40 }]),
      this.videos.find({ channelId, deletedFromYoutube: { $ne: true }, durationSeconds: { $gt: 240 } }).sort({ viewCount: -1 }).limit(120).select('title').lean(),
    ]);
    const res = await this.ai.generateJson({
      task: `pillars:${channelId}`,
      system: `You design the content pillars of a YouTube channel: 8-12 STABLE topic buckets that every video, short and quote from the channel can be filed under exactly once.
Rules: pillars are about the kind of story or lesson, never about one person (people are tracked separately); they must be mutually exclusive enough that two people would
file the same video the same way; cover the whole channel, including the rare topics; key = lowercase-hyphen slug (2-4 words); name = 2-5 words; description = one sentence
saying what belongs in it and what does not. Never create a pillar for the channel itself or its host.`,
      user: [
        'MOST COMMON FREE-FORM THEMES TAGGED ON MINED MOMENTS (count):',
        ...themes.map((t) => `- ${t._id} (${t.n})`),
        '',
        'PEOPLE / CASES THAT COME UP (count):',
        ...entities.map((e) => `- ${e._id} (${e.n})`),
        '',
        'TITLES OF THE MOST VIEWED LONG VIDEOS:',
        ...titles.map((t: any) => `- ${t.title}`),
      ].join('\n'),
      schema: TaxonomySchema,
      schemaName: 'pillars',
      reasoningEffort: 'medium',
    });
    const seen = new Set<string>();
    const pillars: PillarDef[] = [];
    for (const p of res.pillars) {
      const key = slugify(p.key || p.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      pillars.push({ key, name: p.name.trim(), description: p.description.trim() });
    }
    await this.sets.updateOne({ channelId }, { $setOnInsert: { channelId, pillars, version: 1 } }, { upsert: true });
    this.logger.log(`Pillars for ${channelId}: ${pillars.map((p) => p.key).join(', ')}`);
    return this.list(channelId);
  }

  private async label(channelId: Types.ObjectId, pillars: PillarDef[], items: Array<{ id: number; text: string }>, task: string): Promise<Map<number, string>> {
    const keys = new Set(pillars.map((p) => p.key));
    const out = new Map<number, string>();
    const BATCH = 70;
    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH);
      const res = await this.ai.generateJson({
        task: `${task}:${channelId}`,
        tier: 'fast',
        system: `File every item under exactly ONE content pillar. Use only the pillar keys listed. Pick the pillar whose description fits the story or lesson best, not the person named.`,
        user: [
          'PILLARS:',
          ...pillars.map((p) => `- ${p.key}: ${p.name}. ${p.description}`),
          '',
          'ITEMS (id | text):',
          ...batch.map((b) => `${b.id} | ${b.text}`),
        ].join('\n'),
        schema: LabelSchema,
        schemaName: 'pillar_labels',
        reasoningEffort: 'low',
      });
      for (const l of res.labels) if (keys.has(l.pillar) && batch.some((b) => b.id === l.id)) out.set(l.id, l.pillar);
    }
    return out;
  }

  /** File unlabelled moments (cheap fast-model batches). Returns how many were labelled. */
  async labelMoments(channelId: Types.ObjectId, max = 400): Promise<number> {
    const pillars = await this.ensureTaxonomy(channelId);
    const todo = await this.moments.find({ channelId, pillar: { $exists: false } }).limit(max).select('title summary themes').lean();
    if (!todo.length) return 0;
    const labels = await this.label(
      channelId,
      pillars,
      todo.map((m, i) => ({ id: i, text: `${m.title ?? ''} — ${String(m.summary ?? '').slice(0, 160)} [${(m.themes ?? []).slice(0, 4).join(', ')}]` })),
      'pillar-moments',
    );
    const ops = [...labels].map(([i, pillar]) => ({ updateOne: { filter: { _id: todo[i]._id }, update: { $set: { pillar } } } }));
    if (ops.length) await this.moments.bulkWrite(ops);
    return ops.length;
  }

  /** File catalog videos by title (long videos, newest and most viewed first). */
  async labelVideos(channelId: Types.ObjectId, max = 600): Promise<number> {
    const pillars = await this.ensureTaxonomy(channelId);
    const done = new Set((await this.videoPillars.find({ channelId }).select('youtubeId').lean()).map((d) => d.youtubeId));
    const vids = (
      await this.videos
        .find({ channelId, deletedFromYoutube: { $ne: true }, durationSeconds: { $gt: 240 } })
        .sort({ publishedAt: -1 })
        .limit(done.size + max + 50)
        .select('youtubeId title')
        .lean()
    )
      .filter((v: any) => v.youtubeId && !done.has(v.youtubeId))
      .slice(0, max);
    if (!vids.length) return 0;
    const labels = await this.label(
      channelId,
      pillars,
      vids.map((v: any, i) => ({ id: i, text: String(v.title).slice(0, 140) })),
      'pillar-videos',
    );
    const ops = [...labels].map(([i, pillar]) => ({
      updateOne: { filter: { channelId, youtubeId: (vids[i] as any).youtubeId }, update: { $set: { pillar, version: 1 } }, upsert: true },
    }));
    if (ops.length) await this.videoPillars.bulkWrite(ops);
    return ops.length;
  }

  /** A reel takes the pillar most of its moments have. */
  async tagReels(channelId: Types.ObjectId): Promise<number> {
    const todo = await this.reels.find({ channelId, pillar: { $exists: false }, momentIds: { $exists: true, $ne: [] } }).select('momentIds').lean();
    if (!todo.length) return 0;
    const ids = [...new Set(todo.flatMap((r) => (r.momentIds ?? []).map(String)))].map((i) => new Types.ObjectId(i));
    const moms = await this.moments.find({ _id: { $in: ids }, pillar: { $exists: true } }).select('pillar').lean();
    const byId = new Map(moms.map((m) => [String(m._id), m.pillar as string]));
    const ops = [];
    for (const r of todo) {
      const counts = new Map<string, number>();
      for (const id of r.momentIds ?? []) {
        const p = byId.get(String(id));
        if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
      }
      const top = [...counts].sort((a, b) => b[1] - a[1])[0];
      if (top) ops.push({ updateOne: { filter: { _id: r._id }, update: { $set: { pillar: top[0] } } } });
    }
    if (ops.length) await this.reels.bulkWrite(ops as any);
    return ops.length;
  }

  /** Everything the brain needs to be current. Safe to call every day (does nothing when up to date). */
  async prepare(channelId: Types.ObjectId) {
    const taxonomy = await this.ensureTaxonomy(channelId);
    const [moments, videos] = await Promise.all([this.labelMoments(channelId), this.labelVideos(channelId)]);
    const reels = await this.tagReels(channelId);
    return { pillars: taxonomy.length, moments, videos, reels };
  }

  /** Per pillar: days since we last made a reel on it, and how well it does (catalog prior, then our own posts). */
  async state(channelId: Types.ObjectId): Promise<Record<string, PillarState>> {
    const pillars = await this.list(channelId);
    const out: Record<string, PillarState> = {};
    for (const p of pillars) out[p.key] = { daysSinceCovered: null, lift: 1, posts: 0 };
    if (!pillars.length) return out;

    // coverage: our latest reel per pillar
    const last = await this.reels.aggregate<{ _id: string; last: Date }>([
      { $match: { channelId, pillar: { $exists: true }, status: { $in: ['queued', 'rendering', 'todo', 'posted'] } } },
      { $group: { _id: '$pillar', last: { $max: '$createdAt' } } },
    ]);
    for (const l of last) if (out[l._id]) out[l._id].daysSinceCovered = Math.max(0, Math.floor((Date.now() - l.last.getTime()) / 86_400_000));

    // prior: where the host's catalog videos of this pillar rank among videos published in the same quarter (removes the age bias of lifetime views)
    const labelled = await this.videoPillars.find({ channelId }).select('youtubeId pillar').lean();
    const pillarOf = new Map(labelled.map((l) => [l.youtubeId, l.pillar]));
    const vids = await this.videos
      .find({ channelId, deletedFromYoutube: { $ne: true }, durationSeconds: { $gt: 240 }, publishedAt: { $gte: new Date(Date.now() - 730 * 86_400_000) } })
      .select('youtubeId viewCount publishedAt')
      .lean();
    const byQuarter = new Map<string, number[]>();
    const quarter = (d: Date) => `${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3)}`;
    for (const v of vids as any[]) byQuarter.set(quarter(v.publishedAt), [...(byQuarter.get(quarter(v.publishedAt)) ?? []), v.viewCount ?? 0]);
    const pct = new Map<string, number[]>();
    for (const v of vids as any[]) {
      const p = pillarOf.get(v.youtubeId);
      const peers = byQuarter.get(quarter(v.publishedAt)) ?? [];
      if (!p || peers.length < 5) continue;
      const rank = peers.filter((x) => x < (v.viewCount ?? 0)).length / peers.length;
      pct.set(p, [...(pct.get(p) ?? []), rank]);
    }
    for (const [p, ranks] of pct) if (out[p] && ranks.length >= 5) out[p].lift = clamp(0.6 + median(ranks), 0.6, 1.6);

    // learned: our own posts of this pillar against the median of all our posts (shrunk until about 8 posts)
    const posted = await this.posts
      .find({ channelId, status: 'published', 'latestMetrics.views': { $gte: 0 } })
      .select('reelId latestMetrics.views')
      .lean();
    if (posted.length >= 6) {
      const reelIds = posted.map((p) => p.reelId);
      const reels = await this.reels.find({ _id: { $in: reelIds }, channelId, pillar: { $exists: true } }).select('pillar').lean();
      const pillarByReel = new Map(reels.map((r) => [String(r._id), r.pillar as string]));
      const all = posted.map((p) => p.latestMetrics?.views ?? 0);
      const base = Math.max(1, median(all));
      const per = new Map<string, number[]>();
      for (const p of posted) {
        const k = pillarByReel.get(String(p.reelId));
        if (k) per.set(k, [...(per.get(k) ?? []), p.latestMetrics?.views ?? 0]);
      }
      for (const [k, v] of per) {
        if (!out[k]) continue;
        const w = Math.min(1, v.length / 8);
        const learned = clamp(median(v) / base, 0.6, 1.6);
        out[k].lift = clamp((1 - w) * out[k].lift + w * learned, 0.6, 1.6);
        out[k].posts = v.length;
      }
    }
    return out;
  }
}
