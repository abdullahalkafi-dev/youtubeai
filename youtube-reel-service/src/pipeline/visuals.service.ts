import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import { AiService, UsageSink } from '../ai/ai.service';
import { ImageGenService, ImageRefusedError } from '../ai/image-gen.service';
import { AppConfig, CONFIG } from '../config/config';
import { errMsg } from '../common/errors';
import { Reel, ReelDocument, ReelVisual, ReelWord } from '../db/schemas/reel.schema';
import { BEATS_SYSTEM, BEATS_VERSION, BeatsSchema, buildBeatsUser, placeBeats } from '../prompts/beats.prompt';
import { OrchestratorService } from '../queue/orchestrator.service';
import { BUCKETS, StorageService } from '../storage/storage.service';

export const BEAT_SIZE = '1344x944'; // ≈ the 1080x760 template window, multiples of 16

export interface PersonRef {
  name: string;
  imageUrl: string;
}

/**
 * AI images inside reels ("visual beats"): plan where they help, generate them once, store them, reuse them on
 * every re-render. Never fails a reel: anything that goes wrong just means fewer images.
 */
@Injectable()
export class VisualsService {
  private readonly logger = new Logger(VisualsService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @InjectModel(Reel.name) private readonly reels: Model<ReelDocument>,
    private readonly ai: AiService,
    private readonly images: ImageGenService,
    private readonly storage: StorageService,
    private readonly orchestrator: OrchestratorService,
  ) {}

  /** Plan (first time) and generate any missing images. Returns the visuals ready to render. */
  async ensure(reel: ReelDocument): Promise<ReelVisual[]> {
    if (!this.cfg.REEL_IMAGES_ENABLED) return [];
    const usage = this.orchestrator.usageSink(reel.campaignId);
    let visuals = reel.visuals ?? [];
    if (reel.visualsVersion !== BEATS_VERSION) {
      visuals = await this.plan(reel, usage);
      await this.reels.updateOne({ _id: reel._id }, { $set: { visuals, visualsVersion: BEATS_VERSION } });
    }
    const pending = visuals.filter((v) => v.status === 'pending');
    if (pending.length) {
      const people = await this.peopleWithPhotos();
      await mapLimit(pending, 2, (v) => this.generateOne(reel, v, people, usage));
      await this.reels.updateOne({ _id: reel._id }, { $set: { visuals } });
    }
    return visuals.filter((v) => v.status === 'ready' && v.key);
  }

  /** Ask for a fresh image for one beat; the next render generates it. */
  async replace(reelId: string, visualId: string) {
    const reel = await this.reels.findById(reelId).select('visuals').lean();
    const v = reel?.visuals?.find((x) => x.id === visualId);
    if (!v) throw new NotFoundException('Image not found');
    await this.reels.updateOne(
      { _id: reelId, 'visuals.id': visualId },
      { $set: { 'visuals.$.status': 'pending', 'visuals.$.variant': (v.variant ?? 0) + 1, 'visuals.$.error': null } },
    );
  }

  async remove(reelId: string, visualId: string) {
    const res = await this.reels.updateOne({ _id: reelId, 'visuals.id': visualId }, { $set: { 'visuals.$.status': 'removed' } });
    if (!res.matchedCount) throw new NotFoundException('Image not found');
  }

  // ------------------------------------------------------------------ planning

  private async plan(reel: ReelDocument, usage: UsageSink): Promise<ReelVisual[]> {
    const words = (reel.words ?? []) as ReelWord[];
    if (words.length < 10) return [];
    const protectedFrom = this.payoffWordIndex(reel, words);
    const known = await this.peopleWithPhotos();
    const spoken = ` ${words.map((w) => w.w.toLowerCase()).join(' ')} ${(reel.entityNames ?? []).join(' ').toLowerCase()} `;
    const relevant = known.filter((p) => nameTokens(p.name).some((t) => spoken.includes(` ${t}`)));
    try {
      const res = await this.ai.generateJson({
        task: `beats:${reel._id}`,
        tier: 'fast',
        system: BEATS_SYSTEM,
        user: buildBeatsUser({ concept: reel.concept, headline: reel.packaging?.headline ?? reel.concept, words, protectedFrom, knownPeople: relevant.map((p) => p.name) }),
        schema: BeatsSchema,
        schemaName: 'reel_beats',
        reasoningEffort: 'medium',
        usage,
      });
      const placed = placeBeats(res, words, protectedFrom, this.cfg.REEL_IMAGES_MAX);
      return placed.map((b) => ({
        id: crypto.randomBytes(4).toString('hex'),
        start: b.start,
        end: b.end,
        importance: b.importance,
        purpose: b.purpose,
        phrase: b.phrase,
        prompt: `${res.style.trim()}. ${b.prompt}`,
        safePrompt: `${res.style.trim()}. ${b.safePrompt}`,
        people: b.people,
        status: 'pending' as const,
      }));
    } catch (err) {
      this.logger.warn(`Image planning skipped for reel ${reel._id}: ${errMsg(err)}`);
      return [];
    }
  }

  /** First word of the payoff/close clip: images never cover the punchline. */
  private payoffWordIndex(reel: ReelDocument, words: ReelWord[]): number {
    let off = 0;
    let payoffAt: number | null = null;
    for (const c of reel.clips) {
      if (payoffAt === null && (c.role === 'payoff' || c.role === 'close')) payoffAt = off;
      off += c.end - c.start;
    }
    const at = payoffAt ?? off * 0.75;
    const idx = words.findIndex((w) => w.s >= at - 0.05);
    return idx < 0 ? words.length : idx;
  }

  // ------------------------------------------------------------------ generation

  private async generateOne(reel: ReelDocument, v: ReelVisual, people: PersonRef[], usage: UsageSink) {
    const refs: Array<{ name: string; data: Buffer }> = [];
    for (const name of v.people ?? []) {
      const p = people.find((x) => sameName(x.name, name));
      if (!p || refs.length >= 2) continue;
      const data = await this.readPhoto(p.imageUrl);
      if (data) refs.push({ name: p.name, data });
    }
    const refNote = refs.length ? ` The person${refs.length > 1 ? 's' : ''} in the reference photo${refs.length > 1 ? 's are' : ' is'} ${refs.map((r) => r.name).join(' and ')}; keep their real likeness.` : '';
    const variantNote = v.variant ? ` Alternative take #${v.variant}: different angle and composition.` : '';
    const attempts: Array<{ prompt: string; references?: typeof refs; safe: boolean }> = [
      { prompt: v.prompt + refNote + variantNote, references: refs.length ? refs : undefined, safe: false },
      { prompt: v.safePrompt + variantNote, safe: true },
    ];
    for (const a of attempts) {
      try {
        const img = await this.images.generate({ prompt: a.prompt, size: BEAT_SIZE, references: a.references, channelId: String(reel.channelId), task: `beat:${reel._id}:${v.id}` });
        const key = `${reel.channelId}/${reel.campaignId}/${reel._id}/beats/${v.id}-${v.variant ?? 0}.jpg`;
        await this.storage.putBuffer(BUCKETS.reels, key, img.data, 'image/jpeg');
        Object.assign(v, { status: 'ready', key, usedSafe: a.safe, realPerson: !a.safe && (v.people?.length ?? 0) > 0, error: undefined });
        await usage({ images: 1 });
        return;
      } catch (err) {
        if (err instanceof ImageRefusedError && !a.safe) {
          this.logger.warn(`Image refused for reel ${reel._id} beat ${v.id}; retrying without real people`);
          continue;
        }
        Object.assign(v, { status: 'failed', error: errMsg(err).slice(0, 200) });
        this.logger.warn(`Image failed for reel ${reel._id} beat ${v.id}: ${errMsg(err)}`);
        return;
      }
    }
  }

  /** Real people we hold a checked photo of (main app's subject library, read-only; client uploads win). */
  async peopleWithPhotos(): Promise<PersonRef[]> {
    try {
      const rows = await this.reels.db
        .collection('subject_references')
        .find({ $or: [{ verified: true }, { source: { $in: ['manual', 'client_upload'] } }] }, { projection: { displayName: 1, canonicalName: 1, imageUrl: 1 } })
        .limit(300)
        .toArray();
      return rows.filter((r) => r.imageUrl).map((r) => ({ name: String(r.displayName || r.canonicalName), imageUrl: String(r.imageUrl) }));
    } catch {
      return [];
    }
  }

  /** `…/api/assets/minio/<key>` (a key in the main app's bucket) → bytes, read-only. */
  async readPhoto(url: string): Promise<Buffer | null> {
    const key = url.split('?')[0].split('/api/assets/minio/')[1];
    try {
      if (key) return await this.storage.readShared(this.cfg.MAIN_MINIO_BUCKET, decodeURIComponent(key));
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    } catch {
      return null;
    }
  }
}

export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !['lil', 'king', 'the', 'young'].includes(t));
}
export function sameName(a: string, b: string) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  return a.toLowerCase() === b.toLowerCase() || ta.some((t) => tb.includes(t));
}

async function mapLimit<T>(items: T[], limit: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

export const _test = { nameTokens, sameName };
