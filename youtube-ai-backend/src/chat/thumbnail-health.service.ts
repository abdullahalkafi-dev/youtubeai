import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Thread, ThreadDocument } from '../mongo/schemas/thread.schema';
import { claimsNoImages, hasConceptBlock } from './thumbnail-intent';

/** A thumbnail ask that ended without the images the client was owed. */
export interface ThumbnailProblem {
  threadId: string;
  messageId: string;
  at: Date;
  kind: 'refused' | 'images_missing';
  detail: string;
}

/** A package reply this old with fewer images than concepts (and no "waiting for a photo" note) is a lost concept. */
export const GRACE_MINUTES = 20;

interface MessageLike {
  _id?: any;
  role: string;
  content?: string;
  createdAt?: Date;
  metadata?: any;
}

/**
 * Every way a thumbnail ask can quietly end without an image, found from the saved chats alone:
 *  - a reply that tells the client the app cannot make images;
 *  - a reply flagged for automatic images (autoImages), older than the grace time, that has fewer images
 *    than concepts and no saved "waiting for a photo" for the missing one.
 * Pure (no database), so the rules are tested directly.
 */
export function findThumbnailProblems(
  threads: Array<{ _id: any; messages?: MessageLike[] }>,
  now: Date,
  since: Date,
): ThumbnailProblem[] {
  const out: ThumbnailProblem[] = [];
  for (const t of threads) {
    for (const m of t.messages || []) {
      if (m.role !== 'assistant' || !m.createdAt || m.createdAt < since) continue;
      const base = { threadId: String(t._id), messageId: String(m._id), at: m.createdAt };
      const content = String(m.content || '');
      const md = m.metadata || {};
      if (claimsNoImages(content)) {
        out.push({ ...base, kind: 'refused', detail: content.slice(0, 120).replace(/\s+/g, ' ') });
        continue;
      }
      if (!hasConceptBlock(content)) continue;
      const concepts = (content.match(/###\s*Concept\s*\d/gi) || []).length || 2;
      const images = (md.images || []).filter((i: any) => i?.mode === 'thumbnail' && i?.url);
      const waiting = Object.keys(md.waitingPhotos || {}).length;
      const ageMin = (now.getTime() - m.createdAt.getTime()) / 60000;
      // only a reply that promised automatic images (autoImages) owes them; concepts offered for a manual
      // "1-Click Generate" are not a failure when nobody pressed it
      if (md.autoImages === true && ageMin > GRACE_MINUTES && images.length + waiting < Math.min(concepts, 2)) {
        out.push({
          ...base,
          kind: 'images_missing',
          detail: `${images.length} of ${Math.min(concepts, 2)} images, ${waiting} waiting for a photo`,
        });
      }
    }
  }
  return out;
}

/**
 * Hourly: looks at the chats of the last day and logs every thumbnail ask that ended without its images, so a
 * failure like the Nov 25 chat ("generate thumbnail" answered with "the tool isn't available", one concept
 * silently missing) is seen the same day instead of by the client. Each problem is logged once.
 */
@Injectable()
export class ThumbnailHealthService {
  private readonly logger = new Logger('ThumbnailHealth');
  private readonly reported = new Set<string>();

  constructor(@InjectModel(Thread.name) private readonly threadModel: Model<ThreadDocument>) {}

  @Cron('17 * * * *')
  async hourlyCheck(): Promise<ThumbnailProblem[]> {
    try {
      const now = new Date();
      const since = new Date(now.getTime() - 26 * 3600 * 1000);
      const threads = await this.threadModel
        .find({ updatedAt: { $gte: since } })
        .select('title messages._id messages.role messages.content messages.createdAt messages.metadata.images messages.metadata.autoImages messages.metadata.waitingPhotos')
        .lean();
      const problems = findThumbnailProblems(threads as any, now, since);
      const fresh = problems.filter((p) => {
        const key = `${p.messageId}:${p.kind}`;
        if (this.reported.has(key)) return false;
        this.reported.add(key);
        return true;
      });
      for (const p of fresh) {
        this.logger.error(`${p.kind} in thread ${p.threadId} at ${p.at.toISOString()}: ${p.detail}`);
      }
      if (!fresh.length) this.logger.log(`ok: ${threads.length} chats checked, no thumbnail ask ended without its images`);
      return fresh;
    } catch (err: any) {
      this.logger.warn(`check failed: ${err?.message || err}`);
      return [];
    }
  }
}
