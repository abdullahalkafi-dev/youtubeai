import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppConfig, CONFIG } from '../config/config';
import { ReelSetting, ReelSettingDocument } from '../db/schemas/reel-misc.schema';

/** The calendar day in Pacific time — YouTube quota buckets reset at midnight Pacific. */
export function pacificDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Milliseconds until the next Pacific midnight (plus a one-minute margin). */
export function msUntilPacificMidnight(now = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0) % 24;
  const sinceMidnight = (get('hour') * 3600 + get('minute') * 60 + get('second')) * 1000;
  return 86_400_000 - sinceMidnight + 60_000;
}

/**
 * Our own per-day upload counter. Google gives the project 100 uploads/day in a separate bucket; we keep a much
 * lower, configurable cap so a mistake can't burn the channel's allowance, and we show "n/cap today" in the UI.
 */
@Injectable()
export class PublishQuotaService {
  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @InjectModel(ReelSetting.name) private readonly settings: Model<ReelSettingDocument>,
  ) {}

  private key(platform: string, now = new Date()) {
    return `${platform}-uploads:${pacificDate(now)}`;
  }

  get dailyCap(): number {
    return this.cfg.PUBLISH_YT_DAILY_CAP;
  }

  async usedToday(platform = 'yt'): Promise<number> {
    const doc = await this.settings.findOne({ key: this.key(platform) }).lean();
    return Number(doc?.value ?? 0);
  }

  /** Called when YouTube accepts a NEW upload session (a resumed session is not counted twice). */
  async recordUpload(platform = 'yt'): Promise<number> {
    const doc = await this.settings.findOneAndUpdate({ key: this.key(platform) }, { $inc: { value: 1 } }, { upsert: true, new: true }).lean();
    return Number(doc?.value ?? 1);
  }

  async hasRoom(platform = 'yt'): Promise<boolean> {
    return (await this.usedToday(platform)) < this.dailyCap;
  }
}
