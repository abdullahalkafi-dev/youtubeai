import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { z } from 'zod';
import { AiService } from '../ai/ai.service';
import { errMsg } from '../common/errors';
import { ReelCampaign, ReelCampaignDocument } from '../db/schemas/reel-campaign.schema';
import { ReelReview, ReelReviewDocument } from '../db/schemas/reel-review.schema';
import { ReelPost, ReelPostDocument } from '../db/schemas/reel-post.schema';
import { nyDate } from '../common/time';
import { AnalyticsService, BREAKDOWNS } from './analytics.service';

/** A claim needs at least this many posts behind it. With 5-7 posts a day the data is noisy: only big differences are real. */
export const MIN_POSTS_FOR_CLAIM = 5;
/** The review waits until this many posts have settled. */
export const MIN_POSTS_FOR_REVIEW = 12;

const ReviewSchema = z.object({
  summary: z.string(),
  findings: z
    .array(z.object({ claim: z.string(), evidence: z.string(), sample: z.number().int(), confidence: z.enum(['low', 'medium', 'high']), action: z.string() }))
    .max(6),
});

const SECTIONS: Array<(typeof BREAKDOWNS)[number]> = ['pillar', 'track', 'signal', 'slot', 'weekday', 'shape', 'duration', 'voice', 'look'];

export function mondayOf(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** The weekly review and the short "what worked" text the daily topic prompt reads. */
@Injectable()
export class LearningService {
  private readonly logger = new Logger(LearningService.name);

  constructor(
    @InjectModel(ReelReview.name) private readonly reviews: Model<ReelReviewDocument>,
    @InjectModel(ReelPost.name) private readonly posts: Model<ReelPostDocument>,
    @InjectModel(ReelCampaign.name) private readonly campaigns: Model<ReelCampaignDocument>,
    private readonly analytics: AnalyticsService,
    private readonly ai: AiService,
  ) {}

  async latest(channelId: string | Types.ObjectId) {
    return this.reviews.findOne({ channelId: new Types.ObjectId(String(channelId)) }).sort({ weekOf: -1 }).lean();
  }

  /** Weekly job: one review per channel per week, only for channels that publish. */
  async runWeekly() {
    const channels = (await this.posts.distinct('channelId', { status: 'published' })) as Types.ObjectId[];
    for (const c of channels) {
      try {
        await this.review(String(c));
      } catch (err) {
        this.logger.warn(`Weekly review for ${c} failed: ${errMsg(err)}`);
      }
    }
  }

  async review(channelId: string) {
    const cid = new Types.ObjectId(channelId);
    const weekOf = mondayOf(nyDate());
    if (await this.reviews.exists({ channelId: cid, weekOf })) return this.latest(cid);

    const tables: NonNullable<ReelReview['tables']> = {};
    for (const by of SECTIONS) {
      const r = await this.analytics.breakdown(channelId, by, '30d').catch(() => null);
      const rows = (r?.rows ?? []).filter((x) => x.posts >= MIN_POSTS_FOR_CLAIM).map((x) => ({ key: x.key, posts: x.posts, avgViews: x.avgViews, avgViewPct: x.avgViewPct }));
      if (rows.length >= 2) tables[by] = rows; // a single group has nothing to compare against
    }
    const total = await this.posts.countDocuments({ channelId: cid, status: 'published', publishedAt: { $gte: new Date(Date.now() - 30 * 86_400_000) } });
    if (total < MIN_POSTS_FOR_REVIEW || !Object.keys(tables).length) {
      await this.reviews.create({ channelId: cid, weekOf, posts: total, enoughData: false, summary: `Not enough posts yet to say what works (${total} of ${MIN_POSTS_FOR_REVIEW} needed). Every claim needs at least ${MIN_POSTS_FOR_CLAIM} posts behind it.`, findings: [], tables });
      return this.latest(cid);
    }

    const res = await this.ai.generateJson({
      task: `weekly-review:${channelId}:${weekOf}`,
      system: `You write the weekly "what worked" review for a YouTube Shorts channel from tables of its own results (last 30 days, average views per post and average % viewed).
Rules, all strict: use ONLY the numbers in the tables; every finding names the groups compared and quotes their numbers and post counts; never claim more than the sample supports
(under 8 posts in a group = "low" confidence; differences under about 1.5x between groups are noise with this volume, say so instead of declaring a winner); a single viral post can distort an
average, so prefer groups where the average is not carried by one post when the tables hint at it; prefer actions the system can take (cover a topic area more or less, change the
mix of main and explore, shift posting times). Never suggest changing the host's voice or deleting anything. Plain language for a creator, no jargon. At most 6 findings; return an
empty list and say so in the summary when nothing is clear yet.`,
      user: Object.entries(tables)
        .map(([name, rows]) => `TABLE ${name} (group | posts | avg views | avg % viewed):\n${rows.map((r) => `- ${r.key} | ${r.posts} | ${r.avgViews} | ${r.avgViewPct ?? 'n/a'}`).join('\n')}`)
        .join('\n\n'),
      schema: ReviewSchema,
      schemaName: 'weekly_review',
      reasoningEffort: 'medium',
    });
    await this.reviews.create({ channelId: cid, weekOf, posts: total, enoughData: true, summary: res.summary, findings: res.findings, tables });
    return this.latest(cid);
  }

  /** The few lines the daily topic prompt gets: only findings that are medium/high confidence. */
  async learnedLines(channelId: string | Types.ObjectId): Promise<string[]> {
    const r = await this.latest(channelId);
    if (!r?.enoughData) return [];
    return r.findings.filter((f) => f.confidence !== 'low' && f.sample >= MIN_POSTS_FOR_CLAIM).map((f) => `${f.claim} (${f.evidence}; ${f.sample} posts, ${f.confidence} confidence) → ${f.action}`);
  }
}
