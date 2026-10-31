import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { AiService } from '../ai/ai.service';
import { ImageGenService, ImageRefusedError } from '../ai/image-gen.service';
import { run } from '../common/exec';
import { errMsg } from '../common/errors';
import { AppConfig, CONFIG } from '../config/config';
import { Reel, ReelDocument, ReelThumbnail } from '../db/schemas/reel.schema';
import { buildThumbnailUser, THUMBNAIL_SYSTEM, THUMBNAIL_VERSION, ThumbnailPlan, ThumbnailPlanSchema } from '../prompts/thumbnail.prompt';
import { OrchestratorService } from '../queue/orchestrator.service';
import { BUCKETS, StorageService } from '../storage/storage.service';
import { ensureDir, jobDir, removeDir } from './media';
import { buildThumbAss, HOST_POSES, THUMB_SCENE_SIZE, thumbGraph } from './thumb-compose';
import { nameTokens, PeopleService, sameName } from './people.service';

type Variant = ThumbnailPlan['variants'][number];

/**
 * Click-bait 9:16 thumbnails for reels: the AI plans 2 variants (headline + scene), the image model draws the scene
 * (real person from a verified photo when we have one), and we composite the host's real cut-out, the logo and a crisp
 * headline with ffmpeg. Never fails the reel; worst case the scene falls back to a frame of the reel.
 */
@Injectable()
export class ThumbnailService {
  private readonly logger = new Logger(ThumbnailService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @InjectModel(Reel.name) private readonly reels: Model<ReelDocument>,
    private readonly ai: AiService,
    private readonly images: ImageGenService,
    private readonly storage: StorageService,
    private readonly people: PeopleService,
    private readonly orchestrator: OrchestratorService,
  ) {}

  /** First-time thumbnails (called after a render). `coverFile` is a frame of the finished reel (fallback scene). */
  async ensure(reel: ReelDocument, coverFile: string | null) {
    if (!this.cfg.REEL_THUMBNAILS_ENABLED) return;
    if (reel.thumbnails?.some((t) => t.status === 'ready')) return;
    await this.generate(reel, coverFile);
  }

  /** Fresh pair of thumbnails (replaces the old ones). */
  async regenerate(reelId: string) {
    const reel = await this.reels.findById(reelId);
    if (!reel) throw new NotFoundException('Reel not found');
    const dir = jobDir(this.cfg.REEL_WORK_DIR, 'thumb', reelId);
    try {
      let cover: string | null = null;
      if (reel.assets?.coverKey) {
        cover = path.join(dir, 'cover.jpg');
        await this.storage.getFile(BUCKETS.reels, reel.assets.coverKey, cover).catch(() => (cover = null));
      }
      await this.generate(reel, cover);
    } finally {
      removeDir(dir);
    }
  }

  async choose(reelId: string, thumbId: string) {
    const res = await this.reels.updateOne({ _id: reelId, thumbnails: { $elemMatch: { id: thumbId, status: 'ready' } } }, { $set: { thumbnailChoice: thumbId } });
    if (!res.matchedCount) throw new NotFoundException('Thumbnail not found');
  }

  /** The thumbnail to use when publishing (chosen one, else the first ready one). */
  async chosenImage(reel: Pick<Reel, 'thumbnails' | 'thumbnailChoice'>): Promise<Buffer | null> {
    const ready = (reel.thumbnails ?? []).filter((t) => t.status === 'ready' && t.key);
    const pick = ready.find((t) => t.id === reel.thumbnailChoice) ?? ready[0];
    return pick ? this.storage.getBuffer(BUCKETS.reels, pick.key!) : null;
  }

  // ------------------------------------------------------------------

  private async generate(reel: ReelDocument, coverFile: string | null) {
    const usage = this.orchestrator.usageSink(reel.campaignId);
    const people = await this.people.peopleWithPhotos();
    const spoken = ` ${(reel.entityNames ?? []).join(' ')} ${reel.concept} ${reel.packaging?.title ?? ''} `.toLowerCase();
    const relevant = people.filter((p) => (reel.entityNames ?? []).some((n) => sameName(n, p.name)) || nameTokens(p.name).some((t) => spoken.includes(` ${t}`)));

    let plan: ThumbnailPlan;
    try {
      plan = await this.ai.generateJson({
        task: `thumbs:${reel._id}`,
        tier: 'fast',
        system: THUMBNAIL_SYSTEM,
        user: buildThumbnailUser({
          title: reel.packaging?.title ?? reel.concept,
          headline: reel.packaging?.headline ?? '',
          concept: reel.concept,
          hook: reel.hookText ?? '',
          payoff: reel.payoffText ?? '',
          people: reel.entityNames ?? [],
          knownPeople: relevant.map((p) => p.name),
        }),
        schema: ThumbnailPlanSchema,
        schemaName: 'reel_thumbnails',
        reasoningEffort: 'medium',
        usage,
      });
    } catch (err) {
      this.logger.warn(`Thumbnail planning failed for reel ${reel._id}: ${errMsg(err)}`);
      return;
    }

    const dir = jobDir(this.cfg.REEL_WORK_DIR, 'thumbgen', String(reel._id));
    try {
      const fonts = ensureDir(path.join(dir, 'fonts'));
      for (const f of fs.readdirSync(this.cfg.fontsDir).filter((x) => /\.(ttf|otf)$/i.test(x))) fs.copyFileSync(path.join(this.cfg.fontsDir, f), path.join(fonts, f));
      const out: ReelThumbnail[] = [];
      await Promise.all(
        plan.variants.slice(0, 2).map(async (v, i) => {
          const t = await this.makeOne(reel, v, i, dir, coverFile, relevant, usage);
          if (t) out[i] = t;
        }),
      );
      const ready = out.filter(Boolean);
      if (!ready.length) return;
      await this.reels.updateOne({ _id: reel._id }, { $set: { thumbnails: ready, thumbnailChoice: ready[0].id, thumbnailsVersion: THUMBNAIL_VERSION } });
    } finally {
      removeDir(dir);
    }
  }

  private async makeOne(
    reel: ReelDocument,
    v: Variant,
    i: number,
    dir: string,
    coverFile: string | null,
    people: Array<{ name: string; imageUrl: string }>,
    usage: (d: { images?: number }) => Promise<void> | void,
  ): Promise<ReelThumbnail | null> {
    const id = crypto.randomBytes(4).toString('hex');
    const scene = path.join(dir, `scene-${i}.jpg`);
    let source: ReelThumbnail['source'] = 'frame';
    const person = v.subject ? people.find((p) => sameName(p.name, v.subject!)) : undefined;
    const ref = person ? await this.people.readPhoto(person.imageUrl) : null;
    const tries: Array<{ prompt: string; refs?: Array<{ name: string; data: Buffer }>; source: ReelThumbnail['source'] }> = [
      { prompt: v.scene + (ref ? ` The person in the reference photo is ${person!.name}; keep his real likeness.` : ''), refs: ref ? [{ name: person!.name, data: ref }] : undefined, source: ref ? 'photo-ref' : 'ai' },
      { prompt: v.safeScene, source: 'ai-safe' },
    ];
    for (const t of tries) {
      try {
        const img = await this.images.generate({ prompt: `Vertical 9:16 YouTube thumbnail scene, no text. ${t.prompt}`, size: THUMB_SCENE_SIZE, references: t.refs, channelId: String(reel.channelId), task: `thumb:${reel._id}:${i}` });
        fs.writeFileSync(scene, img.data);
        await usage({ images: 1 });
        source = t.source;
        break;
      } catch (err) {
        if (err instanceof ImageRefusedError && t.source !== 'ai-safe') continue;
        this.logger.warn(`Thumbnail scene failed for reel ${reel._id}: ${errMsg(err)}`);
        break;
      }
    }
    if (!fs.existsSync(scene)) {
      if (!coverFile || !fs.existsSync(coverFile)) return null;
      fs.copyFileSync(coverFile, scene);
      source = 'frame';
    }

    try {
      const hosts = HOST_POSES[v.hostPose] ?? HOST_POSES.pointing;
      const host = path.join(this.cfg.assetsDir, 'thumb', hosts[i % hosts.length]);
      const logo = path.join(this.cfg.assetsDir, 'thumb', 'logo.png');
      const ass = `thumb-${i}.ass`;
      fs.writeFileSync(path.join(dir, ass), buildThumbAss(v.headline, v.accent));
      const file = path.join(dir, `thumb-${i}.jpg`);
      await run(
        this.cfg.FFMPEG_BIN,
        ['-hide_banner', '-y', '-i', scene, '-i', host, '-i', logo, '-filter_complex', thumbGraph(ass, 'fonts'), '-map', '[out]', '-frames:v', '1', '-q:v', '2', file],
        { cwd: dir, timeoutMs: 2 * 60_000, lowPriority: true },
      );
      const key = `${reel.channelId}/${reel.campaignId}/${reel._id}/thumbs/${id}.jpg`;
      await this.storage.putFile(BUCKETS.reels, key, file, 'image/jpeg');
      return { id, key, headline: v.headline.toUpperCase(), subject: v.subject ?? null, source, status: 'ready', createdAt: new Date() };
    } catch (err) {
      this.logger.warn(`Thumbnail compose failed for reel ${reel._id}: ${errMsg(err)}`);
      return null;
    }
  }
}
