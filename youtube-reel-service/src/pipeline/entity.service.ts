import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { slugify } from '../common/text';
import { ReelEntity, ReelEntityDocument } from '../db/schemas/reel-misc.schema';

/** Canonical people/cases/topics per channel so coverage and dedupe treat aliases as one entity. */
@Injectable()
export class EntityService {
  constructor(@InjectModel(ReelEntity.name) private readonly entities: Model<ReelEntityDocument>) {}

  async knownNames(channelId: string | Types.ObjectId, limit = 150): Promise<string[]> {
    const docs = await this.entities.find({ channelId }).sort({ updatedAt: -1 }).limit(limit).select('name').lean();
    return docs.map((d) => d.name);
  }

  /** Register names with their aliases (from research). */
  async upsertWithAliases(channelId: string | Types.ObjectId, items: Array<{ name: string; aliases: string[] }>) {
    for (const item of items) {
      const resolved = await this.resolveOne(channelId, item.name);
      if (!resolved) continue;
      const aliases = [...new Set([item.name, ...item.aliases].map((a) => a.trim().toLowerCase()).filter(Boolean))];
      await this.entities.updateOne({ channelId, slug: resolved.slug }, { $addToSet: { aliases: { $each: aliases } } });
    }
  }

  /** Map free-text names to canonical {slug, name}; creates new entities when unseen. */
  async resolve(channelId: string | Types.ObjectId, names: string[]): Promise<Array<{ slug: string; name: string }>> {
    const out = new Map<string, { slug: string; name: string }>();
    for (const raw of names) {
      const r = await this.resolveOne(channelId, raw);
      if (r) out.set(r.slug, r);
    }
    return [...out.values()];
  }

  private async resolveOne(channelId: string | Types.ObjectId, raw: string) {
    const name = raw.trim().replace(/\s+/g, ' ');
    const slug = slugify(name);
    if (!slug || slug.length < 2) return null;
    const lower = name.toLowerCase();
    const existing = await this.entities.findOne({ channelId, $or: [{ slug }, { aliases: lower }] }).lean();
    if (existing) return { slug: existing.slug, name: existing.name };
    try {
      await this.entities.create({ channelId, slug, name, aliases: [lower] });
    } catch {
      /* raced with another insert — fine */
    }
    return { slug, name };
  }
}
