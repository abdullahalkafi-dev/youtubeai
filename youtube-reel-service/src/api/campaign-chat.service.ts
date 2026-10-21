import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AiService } from '../ai/ai.service';
import { campaignFamily } from '../common/campaign-family';
import { ReelCampaign, ReelCampaignDocument } from '../db/schemas/reel-campaign.schema';
import { ReelCampaignChat, ReelCampaignChatDocument } from '../db/schemas/reel-campaign-chat.schema';
import { Reel, ReelDocument } from '../db/schemas/reel.schema';
import { ReelPost, ReelPostDocument } from '../db/schemas/reel-post.schema';
import { AnalyticsService } from '../publishing/analytics.service';

const MAX_STORED = 60;
const HISTORY_SENT = 16;

const SYSTEM = `You are the campaign assistant inside "Reels Studio", talking to the channel owner (a creator, not a developer).
You help with ONE campaign of short vertical reels cut from the creator's own long videos.

How to answer:
- Plain, friendly English. Short: 2-6 sentences or a few bullets. No jargon (never say "API", "pipeline", "LUFS", "ObjectId", "checkpoint").
- Use ONLY the facts in CAMPAIGN DATA. If a number is missing, say it is not available yet; never invent numbers.
- Views take time: posts under ~48 hours old are still growing, say so when relevant.
- When asked "is it doing well", compare with the channel's other campaigns using the comparison given, and explain simply.
- Give concrete next steps the creator can take in the app: publish a specific To-do reel (name it by title), make more reels on this topic ("Find more reels" on the campaign page), start a new campaign on a related angle, or reject weak reels.
- Suggest new reel angles using the research angles, audience questions and what performed best.
- Platforms: only YouTube is connected today; Instagram, Facebook, X and LinkedIn are coming later. Posts made elsewhere can be added by link on a reel.
- Do not promise actions you cannot do: you cannot publish, edit or delete anything yourself.`;

/** A small assistant scoped to one campaign: knows its reels, research, what was published and how it performs. */
@Injectable()
export class CampaignChatService {
  private readonly logger = new Logger(CampaignChatService.name);

  constructor(
    @InjectModel(ReelCampaign.name) private readonly campaigns: Model<ReelCampaignDocument>,
    @InjectModel(Reel.name) private readonly reels: Model<ReelDocument>,
    @InjectModel(ReelPost.name) private readonly posts: Model<ReelPostDocument>,
    @InjectModel(ReelCampaignChat.name) private readonly chats: Model<ReelCampaignChatDocument>,
    private readonly analytics: AnalyticsService,
    private readonly ai: AiService,
  ) {}

  async history(channelId: string, campaignId: string) {
    await this.mustOwn(channelId, campaignId);
    const doc = await this.chats.findOne({ campaignId }).lean();
    return { messages: (doc?.messages ?? []).map((m) => ({ role: m.role, content: m.content, at: m.at })) };
  }

  async clear(channelId: string, campaignId: string) {
    await this.mustOwn(channelId, campaignId);
    await this.chats.deleteOne({ campaignId });
    return { ok: true };
  }

  async ask(channelId: string, campaignId: string, question: string) {
    const q = question.trim();
    if (!q) throw new BadRequestException('Type a question first');
    await this.mustOwn(channelId, campaignId);

    const doc = await this.chats.findOne({ campaignId }).lean();
    const past = (doc?.messages ?? []).slice(-HISTORY_SENT).map((m) => ({ role: m.role, content: m.content }));
    const data = await this.buildContext(channelId, campaignId);

    const { text } = await this.ai.chat({
      task: 'campaign-chat',
      system: SYSTEM,
      messages: [{ role: 'user', content: `CAMPAIGN DATA (current, for reference):\n${data}` }, { role: 'assistant', content: 'Got it.' }, ...past, { role: 'user', content: q }],
    });
    const answer = text.trim() || 'Sorry, I could not come up with an answer. Please try asking in a different way.';

    const now = new Date();
    await this.chats.updateOne(
      { campaignId },
      {
        $setOnInsert: { campaignId: new Types.ObjectId(campaignId), channelId: new Types.ObjectId(channelId) },
        $push: { messages: { $each: [{ role: 'user', content: q, at: now }, { role: 'assistant', content: answer, at: new Date() }], $slice: -MAX_STORED } },
      },
      { upsert: true },
    );
    return { answer };
  }

  private async mustOwn(channelId: string, campaignId: string) {
    if (!Types.ObjectId.isValid(campaignId)) throw new NotFoundException('Campaign not found');
    const ok = await this.campaigns.exists({ _id: campaignId, channelId });
    if (!ok) throw new NotFoundException('Campaign not found');
  }

  /** Compact, factual snapshot of the campaign for the model (no ids, no internals). */
  async buildContext(channelId: string, campaignId: string): Promise<string> {
    // a daily campaign's explore part is part of the same campaign for the client
    const fam = await campaignFamily(this.campaigns, campaignId);
    const ids = fam?.ids ?? [new Types.ObjectId(campaignId)];
    const [c, reels, perf, posts] = await Promise.all([
      this.campaigns.findById(fam?.root._id ?? campaignId).select('name brief status settings research stats createdAt finishedAt').lean(),
      this.reels.find({ campaignId: { $in: ids } }).select('index status shape concept hookText durationSec themes entityNames scores packaging.title rejectReason').sort({ index: 1 }).lean(),
      this.analytics.campaignPerformance(channelId, campaignId),
      this.posts.find({ campaignId: { $in: ids } }).select('reelId platform status publishedAt latestMetrics requestedPrivacy').lean(),
    ]);
    if (!c) return 'Campaign not found.';
    const day = (d?: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : '?');
    const lines: string[] = [];
    lines.push(`Campaign: "${c.name}" — brief: ${c.brief}`);
    lines.push(`Status: ${c.status}; created ${day(c.createdAt as Date)}; target ${c.settings?.targetReels ?? '?'} reels.`);

    const r = c.research as Record<string, any> | undefined;
    if (r) {
      if (r.topicSummary) lines.push(`Research summary: ${String(r.topicSummary).slice(0, 700)}`);
      const angles = (r.angles ?? []).slice(0, 6).map((a: any) => (typeof a === 'string' ? a : a.title || a.angle || JSON.stringify(a)).slice(0, 140));
      if (angles.length) lines.push(`Research angles: ${angles.join(' | ')}`);
      const qs = (r.audienceQuestions ?? []).slice(0, 6).map((x: any) => String(typeof x === 'string' ? x : x.question ?? '').slice(0, 140));
      if (qs.length) lines.push(`Audience questions: ${qs.join(' | ')}`);
    }

    const postsByReel = new Map<string, typeof posts>();
    for (const p of posts) postsByReel.set(String(p.reelId), [...(postsByReel.get(String(p.reelId)) ?? []), p]);
    lines.push(`\nReels (${reels.length}):`);
    for (const x of reels) {
      const ps = postsByReel.get(String(x._id)) ?? [];
      const posted = ps.length
        ? ps
            .map((p) => {
              const ageH = p.publishedAt ? Math.round((Date.now() - new Date(p.publishedAt).getTime()) / 3_600_000) : null;
              const m = p.latestMetrics;
              return `${p.platform} ${p.status}${p.requestedPrivacy ? ` (${p.requestedPrivacy})` : ''}${ageH !== null ? `, ${ageH}h old` : ''}${m ? `, ${m.views} views, ${m.likes ?? 0} likes, ${m.comments ?? 0} comments` : ''}`;
            })
            .join('; ')
        : 'not published';
      lines.push(
        `- #${x.index} "${x.packaging?.title || x.concept}" [${x.status}] ${Math.round(x.durationSec ?? 0)}s, style ${x.shape}, quality ${x.scores?.overall ?? '?'}/10; hook: "${(x.hookText ?? '').slice(0, 120)}"; topics: ${(x.themes ?? []).slice(0, 4).join(', ') || '-'}; people: ${(x.entityNames ?? []).slice(0, 4).join(', ') || '-'}; ${posted}${x.rejectReason ? `; rejected because: ${x.rejectReason}` : ''}`,
      );
    }

    lines.push(`\nPerformance: ${perf.totals.views} views, ${perf.totals.likes} likes, ${perf.totals.comments} comments from ${perf.totals.posts} published posts (${perf.totals.reelsPublished} of ${perf.totals.reelsReady} ready reels published).`);
    if (perf.byPlatform.length) lines.push(`By platform: ${perf.byPlatform.map((p) => `${p.platform} ${p.views} views over ${p.posts} posts`).join('; ')}`);
    const cmp = perf.comparison;
    if (cmp.verdict === 'not_enough_data') lines.push('Comparison with other campaigns: not enough published data yet.');
    else
      lines.push(
        `Comparison with the channel's other ${cmp.otherCampaigns} campaign(s), using ${cmp.basis === 'first_day' ? 'first-day views per post' : 'views per post so far'}: this campaign ${cmp.campaignAvg} vs others ${cmp.channelAvg} → ${cmp.verdict}.`,
      );
    return lines.join('\n');
  }
}
