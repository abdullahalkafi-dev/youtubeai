import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import { AiService, UsageSink } from '../ai/ai.service';
import { errMsg } from '../common/errors';
import { run } from '../common/exec';
import { AppConfig, CONFIG } from '../config/config';
import { ReelLayout, ReelLayoutDocument } from '../db/schemas/reel-layout.schema';
import { ReelSource, ReelSourceDocument } from '../db/schemas/reel-source.schema';
import { buildLayoutUser, LAYOUT_SYSTEM, LayoutBatchSchema } from '../prompts/layout.prompt';
import { boxesFor, checkSample, decideShot, LAYOUT_VERSION, LayoutSample, lookTimes, mergeShots, parseCutTimes, ShotLayout, shotsFromCuts } from './layout';
import type { RenderClipInput } from './filtergraph';

export interface LayoutClip {
  youtubeId: string;
  /** Path or URL ffmpeg can read. */
  src: string;
  start: number;
  duration: number;
}

export interface LayoutAudit {
  youtubeId: string;
  /** Source seconds. */
  at: number;
  to: number;
  kind: string;
  host: object;
  picture: object;
}

export type LayoutResolution = { ok: true; clips: RenderClipInput[]; shots: LayoutAudit[] } | { ok: false; reason: string };

const BATCH = 8;
const FRAME_WIDTH = 1024;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Finds the studio layout of the footage a reel is cut from, so the full-screen look can crop the host and the story picture
 * by itself. Per clip: find the camera cuts, look at a still frame inside every shot (vision model), keep what was seen in the
 * database per source video, and split the clip wherever the layout changes. Anything unreadable makes the whole reel fall back
 * to the classic look (`ok: false`); this service never throws for a layout problem.
 */
@Injectable()
export class LayoutService {
  private readonly logger = new Logger(LayoutService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @InjectModel(ReelLayout.name) private readonly layouts: Model<ReelLayoutDocument>,
    @InjectModel(ReelSource.name) private readonly sources: Model<ReelSourceDocument>,
    private readonly ai: AiService,
  ) {}

  async resolve(input: { clips: LayoutClip[]; dir: string; usage?: UsageSink }): Promise<LayoutResolution> {
    try {
      return await this.resolveInner(input);
    } catch (err) {
      this.logger.warn(`Layout check failed, using the classic look: ${errMsg(err)}`);
      return { ok: false, reason: `layout check failed: ${errMsg(err).slice(0, 160)}` };
    }
  }

  private async resolveInner(input: { clips: LayoutClip[]; dir: string; usage?: UsageSink }): Promise<LayoutResolution> {
    const dims = new Map<string, { w: number; h: number }>();
    const docs = new Map<string, LayoutSample[]>();
    for (const id of new Set(input.clips.map((c) => c.youtubeId))) {
      const src = await this.sources.findOne({ youtubeId: id }).select('width height').lean();
      if (!src?.width || !src?.height) return { ok: false, reason: `${id}: video size unknown` };
      dims.set(id, { w: src.width, h: src.height });
      docs.set(id, await this.loadSamples(id, src.width, src.height));
    }

    // 1) shots of every clip, and which frames still need a look
    const plan = [];
    for (const [ci, clip] of input.clips.entries()) {
      const cuts = await this.detectCuts(clip, input.dir);
      const shots = shotsFromCuts(clip.duration, cuts).map(([from, to]) => ({ from, to, looks: lookTimes(from, to) }));
      plan.push({ ci, clip, shots });
    }
    const missing: Array<{ youtubeId: string; t: number }> = [];
    for (const p of plan) {
      const known = docs.get(p.clip.youtubeId)!;
      for (const s of p.shots) {
        for (const rel of s.looks) {
          const t = r3(p.clip.start + rel);
          if (!this.cachedLook(known, p.clip.start + s.from, p.clip.start + s.to, t)) missing.push({ youtubeId: p.clip.youtubeId, t });
        }
      }
    }

    // 2) look at what is new
    if (missing.length) await this.lookAtFrames(missing, input.clips, dims, docs, input.dir, input.usage);

    // 3) decide every shot, then build the clips
    const clips: RenderClipInput[] = [];
    const audit: LayoutAudit[] = [];
    for (const p of plan) {
      const known = docs.get(p.clip.youtubeId)!;
      const layouts: ShotLayout[] = [];
      for (const s of p.shots) {
        const a = p.clip.start + s.from;
        const b = p.clip.start + s.to;
        const looks = s.looks.map((rel) => this.cachedLook(known, a, b, r3(p.clip.start + rel))).filter((x): x is LayoutSample => !!x);
        const d = decideShot(looks.length === s.looks.length ? looks : []);
        if (!d.ok || !d.sample) return { ok: false, reason: `${p.clip.youtubeId} ${a.toFixed(1)}s-${b.toFixed(1)}s: ${d.reason ?? 'unreadable'}` };
        const boxes = boxesFor(d.sample, known);
        if (!boxes || d.sample.kind === 'other') return { ok: false, reason: `${p.clip.youtubeId} ${a.toFixed(1)}s: no boxes` };
        layouts.push({ from: s.from, to: s.to, kind: d.sample.kind, host: boxes.host, picture: boxes.picture });
      }
      for (const l of mergeShots(layouts)) {
        clips.push({ src: p.clip.src, start: r3(p.clip.start + l.from), duration: r3(l.to - l.from), layout: l });
        audit.push({ youtubeId: p.clip.youtubeId, at: r3(p.clip.start + l.from), to: r3(p.clip.start + l.to), kind: l.kind, host: l.host, picture: l.picture });
      }
    }
    return { ok: true, clips, shots: audit };
  }

  /** A stored look inside this shot at about this time (a layout cannot change inside a shot, so any stored look in it counts). */
  private cachedLook(known: LayoutSample[], a: number, b: number, t: number): LayoutSample | undefined {
    const inShot = known.filter((k) => k.t >= a - 1e-3 && k.t <= b + 1e-3);
    return inShot.sort((x, y) => Math.abs(x.t - t) - Math.abs(y.t - t)).find((k) => Math.abs(k.t - t) <= 1.5);
  }

  /** Camera cuts inside a clip window, as seconds from the clip start. Throws if ffmpeg fails (the caller falls back to classic). */
  private async detectCuts(clip: LayoutClip, dir: string): Promise<number[]> {
    const reconnect = /^https?:/i.test(clip.src) ? ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5'] : [];
    const res = await run(
      this.cfg.FFMPEG_BIN,
      ['-hide_banner', '-nostats', ...reconnect, '-ss', clip.start.toFixed(3), '-t', clip.duration.toFixed(3), '-i', clip.src, '-an', '-vf', `scale=320:-2,select='gt(scene,${this.cfg.REEL_LAYOUT_SCENE_THRESHOLD})',showinfo`, '-f', 'null', '-'],
      { cwd: dir, timeoutMs: 5 * 60_000, lowPriority: true },
    );
    return parseCutTimes(res.stderr).filter((t) => t > 0 && t < clip.duration);
  }

  private async loadSamples(youtubeId: string, width: number, height: number): Promise<LayoutSample[]> {
    const doc = await this.layouts.findOne({ youtubeId }).lean();
    if (doc && doc.version === LAYOUT_VERSION) return doc.samples ?? [];
    await this.layouts.updateOne({ youtubeId }, { $set: { version: LAYOUT_VERSION, width, height, samples: [] } }, { upsert: true });
    return [];
  }

  private async lookAtFrames(
    missing: Array<{ youtubeId: string; t: number }>,
    clips: LayoutClip[],
    dims: Map<string, { w: number; h: number }>,
    docs: Map<string, LayoutSample[]>,
    dir: string,
    usage?: UsageSink,
  ) {
    for (const id of new Set(missing.map((m) => m.youtubeId))) {
      const times = [...new Set(missing.filter((m) => m.youtubeId === id).map((m) => m.t))];
      const src = clips.find((c) => c.youtubeId === id)!.src;
      const { w, h } = dims.get(id)!;
      for (let i = 0; i < times.length; i += BATCH) {
        const group = times.slice(i, i + BATCH);
        const frames: Buffer[] = [];
        for (const t of group) frames.push(await this.grabFrame(src, t, dir));
        const res = await this.ai.generateJson({
          task: `layout:${id}`,
          tier: 'fast',
          system: LAYOUT_SYSTEM,
          user: buildLayoutUser(group.length),
          schema: LayoutBatchSchema,
          schemaName: 'studio_layout',
          reasoningEffort: 'low',
          images: frames.map((data) => ({ data })),
          imageDetail: 'high',
          usage,
        });
        const fresh: LayoutSample[] = group.map((t, k) => {
          const f = res.frames.find((x) => x.index === k);
          return f ? checkSample(f, t, w, h, this.cfg.REEL_LAYOUT_MIN_CONF) : { t, kind: 'other' as const, conf: 0 };
        });
        docs.get(id)!.push(...fresh);
        await this.layouts.updateOne({ youtubeId: id, version: LAYOUT_VERSION }, { $push: { samples: { $each: fresh, $slice: -400 } } });
      }
    }
  }

  private async grabFrame(src: string, t: number, dir: string): Promise<Buffer> {
    const out = path.join(dir, `look-${Math.round(t * 1000)}.jpg`);
    const reconnect = /^https?:/i.test(src) ? ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5'] : [];
    await run(this.cfg.FFMPEG_BIN, ['-hide_banner', '-loglevel', 'error', '-y', ...reconnect, '-ss', t.toFixed(3), '-i', src, '-frames:v', '1', '-vf', `scale=${FRAME_WIDTH}:-2`, '-q:v', '3', out], {
      cwd: dir,
      timeoutMs: 2 * 60_000,
      lowPriority: true,
    });
    const data = fs.readFileSync(out);
    fs.rmSync(out, { force: true });
    return data;
  }
}
