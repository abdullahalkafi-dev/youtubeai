import { Logger } from '@nestjs/common';
import { Model } from 'mongoose';
import { Channel, ChannelDocument } from '../mongo/schemas/channel.schema';

const GENERIC_TERMS = new Set([
  'case', 'story', 'news', 'update', 'latest', 'man', 'woman', 'person', 'people',
  'officer', 'judge', 'court', 'prison', 'jail', 'federal', 'state', 'local',
  'breaking', 'today', 'yesterday', 'this week', 'arrested', 'charged', 'sentenced',
  'indicted', 'guilty', 'verdict', 'trial', 'hearing', 'appeal', 'released', 'freed', 'convicted',
]);

const NOISE_PATTERNS = [/^\d+$/, /^https?:\/\//, /^[a-zA-Z0-9]+\.[a-zA-Z]{2,}/, /^[^\w\s]+$/];

export function validateExtractedEntity(entity: string): { valid: boolean; reason?: string } {
  const trimmed = entity.trim();
  if (!trimmed) return { valid: false, reason: 'Entity is empty' };
  const words = trimmed.split(/\s+/).filter(w => w.length > 0);
  if (words.length < 3) return { valid: false, reason: `Entity too short (${words.length} words, minimum 3): "${trimmed}"` };
  for (const pattern of NOISE_PATTERNS) {
    if (pattern.test(trimmed)) return { valid: false, reason: `Entity matches noise pattern: "${trimmed}"` };
  }
  const genericCount = words.filter(w => GENERIC_TERMS.has(w.toLowerCase())).length;
  if (genericCount > words.length / 2) return { valid: false, reason: `Entity too generic (${genericCount}/${words.length}): "${trimmed}"` };
  return { valid: true };
}

const SEARCH_LIST_DAILY_LIMIT = 10;
const SEARCH_LIST_WARN_THRESHOLD = 7;

export class SearchListQuotaCounter {
  private readonly logger = new Logger('SearchListQuota');
  private readonly quotaModel: Model<any>;

  constructor(channelModel: Model<ChannelDocument>) {
    // Get the SearchListQuota model from the connection
    this.quotaModel = channelModel.db.model('SearchListQuota') as any;
  }

  private getTodayString(): string {
    return new Date().toISOString().split('T')[0];
  }

  private async ensureTodayRow(): Promise<{ callCount: number; limit: number }> {
    const today = this.getTodayString();
    const row = await this.quotaModel.findOneAndUpdate(
      { date: today },
      { $setOnInsert: { callCount: 0, limit: SEARCH_LIST_DAILY_LIMIT } },
      { upsert: true, new: true },
    ).lean() as any;
    if (!row) return { callCount: 0, limit: SEARCH_LIST_DAILY_LIMIT };
    return { callCount: row.callCount || 0, limit: row.limit || SEARCH_LIST_DAILY_LIMIT };
  }

  async canUse(): Promise<{ allowed: boolean; remaining: number; used: number; limit: number }> {
    const { callCount, limit } = await this.ensureTodayRow();
    return { allowed: callCount < limit, remaining: Math.max(0, limit - callCount), used: callCount, limit };
  }

  async use(): Promise<void> {
    const today = this.getTodayString();
    const row = await this.quotaModel.findOneAndUpdate(
      { date: today },
      { $inc: { callCount: 1 } },
      { upsert: true, new: true },
    ).lean() as any;
    if (!row) return;
    const count = row.callCount || 0;
    const limit = row.limit || SEARCH_LIST_DAILY_LIMIT;
    if (count >= limit) this.logger.warn(`search.list quota EXHAUSTED: ${count}/${limit}`);
    else if (count >= SEARCH_LIST_WARN_THRESHOLD) this.logger.warn(`search.list quota warning: ${count}/${limit}`);
  }

  async getStats(): Promise<{ used: number; remaining: number; limit: number; date: string }> {
    const { callCount, limit } = await this.ensureTodayRow();
    return { used: callCount, remaining: limit - callCount, limit, date: this.getTodayString() };
  }
}
