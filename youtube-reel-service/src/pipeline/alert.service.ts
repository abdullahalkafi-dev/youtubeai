import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppConfig, CONFIG } from '../config/config';
import { errMsg } from '../common/errors';
import { nyDate } from '../common/time';
import { ReelCampaign, ReelCampaignDocument, TERMINAL_CAMPAIGN_STATUSES } from '../db/schemas/reel-campaign.schema';
import { ReelSetting, ReelSettingDocument } from '../db/schemas/reel-misc.schema';
import { QueueService } from '../queue/queue.service';
import { Alert, alertsFor, AlertState, dueAlerts } from './alerts';
import { nyDayRange } from './ops-report';

const KEY = 'ops-alerts';
const MADE = ['queued', 'rendering', 'todo', 'posted'];

/** Checks the pipeline every maintenance tick and pushes new problems to the developer (see alerts.ts). Read-only towards the pipeline. */
@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @InjectModel(ReelCampaign.name) private readonly campaigns: Model<ReelCampaignDocument>,
    @InjectModel(ReelSetting.name) private readonly settings: Model<ReelSettingDocument>,
    private readonly queues: QueueService,
  ) {}

  async state(channelId: Types.ObjectId, now = new Date()): Promise<AlertState> {
    const db = this.campaigns.db;
    const date = nyDate(now);
    const { start, end } = nyDayRange(date);
    const session = ((await this.settings.findOne({ key: 'youtube-session' }).lean())?.value ?? {}) as { status?: string; lastError?: string };
    const camps = await this.campaigns.find({ channelId, origin: 'daily', dailyDate: date }).select('_id status').lean();
    const made = camps.length ? await db.collection('reels').countDocuments({ campaignId: { $in: camps.map((c) => c._id) }, deletedAt: null, status: { $in: MADE } }) : 0;
    const run = await db.collection('reel_daily_runs').findOne({ channelId, date }, { projection: { status: 1 } });
    const auto = ((await this.settings.findOne({ key: `autopublish:${channelId}` }).lean())?.value ?? {}) as { enabled?: boolean; pausedReason?: string | null; slots?: string[] };
    const nyHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(now)) % 24;
    return {
      nyHour,
      session: { status: session.status ?? null, lastError: session.lastError ?? null },
      downloadsPaused: await this.queues.q.download.isPaused(),
      today: { made, target: this.cfg.REEL_DAILY_REELS, working: camps.some((c) => !TERMINAL_CAMPAIGN_STATUSES.includes(c.status)), runStatus: (run as any)?.status ?? null },
      autoPublish: { enabled: !!auto.enabled, pausedReason: auto.pausedReason ?? null },
      failedPostsToday: await db.collection('reel_posts').countDocuments({ channelId, status: 'failed', updatedAt: { $gte: start, $lt: end } }),
      stock: {
        todo: await db.collection('reels').countDocuments({ channelId, status: 'todo', deletedAt: null }),
        queuedPosts: await db.collection('reel_posts').countDocuments({ channelId, status: 'queued' }),
        postsPerDay: Math.max(1, auto.slots?.length ?? this.cfg.REEL_DAILY_REELS),
      },
      stuckCampaigns: await this.campaigns.countDocuments({ channelId, origin: 'daily', status: 'preparing', createdAt: { $lt: new Date(now.getTime() - 6 * 3_600_000) } }),
    };
  }

  /** Called from the 10-minute maintenance tick. Sends each new problem once per REPEAT_HOURS. */
  async check(now = new Date()) {
    if (!this.cfg.REELS_ENABLED) return [];
    const doc = await this.settings.findOne({ key: KEY }).lean();
    const sent: Record<string, string | Date> = { ...((doc?.value as any)?.sent ?? {}) };
    const fresh: Alert[] = [];
    for (const id of (await this.campaigns.distinct('channelId')) as Types.ObjectId[]) {
      try {
        const all = alertsFor(await this.state(id, now));
        // a channel-independent alert (downloads) is sent once, not per channel
        for (const a of dueAlerts(all, sent, now)) if (!fresh.some((f) => f.key === a.key)) fresh.push(a);
      } catch (err) {
        this.logger.warn(`Alert check for ${id} failed: ${errMsg(err)}`);
      }
    }
    if (!fresh.length) return [];
    for (const a of fresh) {
      this.logger.warn(`ALERT ${a.key}: ${a.text}`);
      sent[a.key] = now;
    }
    await this.push(fresh);
    await this.settings.updateOne({ key: KEY }, { $set: { value: { sent, last: fresh.map((a) => ({ ...a, at: now })) } } }, { upsert: true });
    return fresh;
  }

  /** The alerts sent most recently (for `ops:alerts`). */
  async latest() {
    return ((await this.settings.findOne({ key: KEY }).lean())?.value ?? null) as { sent: Record<string, Date>; last: Array<Alert & { at: Date }> } | null;
  }

  private async push(alerts: Alert[]) {
    const url = this.cfg.ALERT_WEBHOOK_URL;
    if (!url) return;
    const text = alerts.map((a) => `- ${a.text}`).join('\n');
    try {
      const ntfy = /ntfy/i.test(url);
      const res = await fetch(url, {
        method: 'POST',
        headers: ntfy ? { Title: 'Reel pipeline alert', Tags: 'warning' } : { 'Content-Type': 'application/json' },
        body: ntfy ? text : JSON.stringify({ text, content: text }),
      });
      if (!res.ok) this.logger.warn(`Alert webhook answered ${res.status}`);
    } catch (err) {
      this.logger.warn(`Alert webhook failed: ${errMsg(err)}`);
    }
  }
}
