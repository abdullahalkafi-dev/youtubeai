import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppConfig, CONFIG } from '../config/config';
import { Reel, ReelDocument } from '../db/schemas/reel.schema';
import { StorageService } from '../storage/storage.service';

export interface PersonRef {
  name: string;
  imageUrl: string;
}

/** Real people we hold a checked photo of (the main app's subject library, read-only). Used by the thumbnails. */
@Injectable()
export class PeopleService {
  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @InjectModel(Reel.name) private readonly reels: Model<ReelDocument>,
    private readonly storage: StorageService,
  ) {}

  /** Client uploads win over auto-found photos. */
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
