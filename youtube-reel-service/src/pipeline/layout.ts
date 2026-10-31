/**
 * Studio layout of a source video, for the full-screen reel look. Pure functions (no I/O): the vision call and the ffmpeg
 * work live in layout.service.ts.
 *
 * The studio set has two orientations that the editor swaps on a hard cut: the host on the left with the story picture on the
 * right (`host_left`) and the reverse (`host_right`). Anything else (host alone, a full-screen clip, an intro card) is `other`
 * and makes the reel fall back to the classic look.
 */
export const LAYOUT_VERSION = 'layout-v1';

export type LayoutKind = 'host_left' | 'host_right' | 'other';

/** A rectangle in source-video pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What the vision model said about one still frame, boxes as fractions of the whole frame. */
export interface RawFrameLayout {
  kind: LayoutKind;
  confidence: number;
  host: Box | null;
  picture: Box | null;
}

/** A checked answer for one frame, boxes in source pixels. `t` is source seconds. */
export interface LayoutSample {
  t: number;
  kind: LayoutKind;
  conf: number;
  host?: Box;
  picture?: Box;
}

/** The layout chosen for one stretch of a reel clip (`from`/`to` are seconds inside the clip). */
export interface ShotLayout {
  from: number;
  to: number;
  kind: Exclude<LayoutKind, 'other'>;
  host: Box;
  picture: Box;
}

export const LAYOUT_RULES = {
  /** The phone-number ticker and the channel header sit outside the story: nothing below this share of the frame counts. */
  maxBottom: 0.82,
  minTop: 0.03,
  hostWidth: [0.2, 0.6] as const,
  pictureWidth: [0.35, 0.8] as const,
  pictureAspect: [1.2, 2.3] as const,
  /** How much the two boxes may overlap, as a share of the frame width. */
  maxOverlap: 0.08,
  /** A sample whose own box is this close (IoU) to the video's typical box uses the typical one, so every reel from a video crops alike. */
  stickIou: 0.8,
  /** A cut closer than this to the previous one is not a new shot. */
  minShotSec: 0.6,
  /** Shots at least this long get two looks (their layout must agree). */
  twoLookSec: 3,
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const even = (n: number) => Math.round(n / 2) * 2;

export function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

function toPixels(f: Box, W: number, H: number): Box {
  const R = LAYOUT_RULES;
  const x = clamp(f.x, 0, 1) * W;
  const y = clamp(f.y, R.minTop, 1) * H;
  const right = clamp(f.x + f.w, 0, 1) * W;
  const bottom = clamp(f.y + f.h, 0, R.maxBottom) * H;
  return { x: Math.round(x), y: Math.round(y), w: Math.round(right - x), h: Math.round(bottom - y) };
}

/** Turns the model's answer for a frame into a checked sample: any impossible geometry makes it `other` with no confidence. */
export function checkSample(raw: RawFrameLayout, t: number, W: number, H: number, minConf: number): LayoutSample {
  const bad: LayoutSample = { t, kind: 'other', conf: 0 };
  if (raw.kind === 'other') return { t, kind: 'other', conf: clamp(raw.confidence, 0, 1) };
  if (!raw.host || !raw.picture) return bad;
  const R = LAYOUT_RULES;
  const host = toPixels(raw.host, W, H);
  const picture = toPixels(raw.picture, W, H);
  if (host.w <= 0 || host.h <= 0 || picture.w <= 0 || picture.h <= 0) return bad;
  const hw = host.w / W;
  const pw = picture.w / W;
  const aspect = picture.w / picture.h;
  if (hw < R.hostWidth[0] || hw > R.hostWidth[1] || pw < R.pictureWidth[0] || pw > R.pictureWidth[1]) return bad;
  if (aspect < R.pictureAspect[0] || aspect > R.pictureAspect[1]) return bad;
  const hostCentre = host.x + host.w / 2;
  const picCentre = picture.x + picture.w / 2;
  if (raw.kind === 'host_left' ? hostCentre >= picCentre : hostCentre <= picCentre) return bad;
  const overlap = Math.max(0, Math.min(host.x + host.w, picture.x + picture.w) - Math.max(host.x, picture.x));
  if (overlap / W > R.maxOverlap) return bad;
  const conf = clamp(raw.confidence, 0, 1);
  return { t, kind: conf >= minConf ? raw.kind : 'other', conf, host, picture };
}

export function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function medianBox(boxes: Box[]): Box {
  return { x: Math.round(median(boxes.map((b) => b.x))), y: Math.round(median(boxes.map((b) => b.y))), w: Math.round(median(boxes.map((b) => b.w))), h: Math.round(median(boxes.map((b) => b.h))) };
}

/** The video's typical boxes for one orientation (needs two confident samples), or null. */
export function typicalBoxes(samples: LayoutSample[], kind: 'host_left' | 'host_right'): { host: Box; picture: Box } | null {
  const own = samples.filter((s) => s.kind === kind && s.host && s.picture);
  if (own.length < 2) return null;
  return { host: medianBox(own.map((s) => s.host!)), picture: medianBox(own.map((s) => s.picture!)) };
}

/** The boxes a shot is cropped with: the video's typical ones when the sample agrees with them, else the sample's own. */
export function boxesFor(sample: LayoutSample, all: LayoutSample[]): { host: Box; picture: Box } | null {
  if (sample.kind === 'other' || !sample.host || !sample.picture) return null;
  const typical = typicalBoxes(all, sample.kind);
  if (typical && iou(typical.host, sample.host) >= LAYOUT_RULES.stickIou && iou(typical.picture, sample.picture) >= LAYOUT_RULES.stickIou) return typical;
  return { host: sample.host, picture: sample.picture };
}

/** Cut times (seconds inside the window) -> consecutive shots; cuts too close to the previous one or to the ends are ignored. */
export function shotsFromCuts(duration: number, cuts: number[]): Array<[number, number]> {
  const keep: number[] = [];
  let last = 0;
  for (const c of [...cuts].sort((a, b) => a - b)) {
    if (c - last < LAYOUT_RULES.minShotSec || duration - c < LAYOUT_RULES.minShotSec) continue;
    keep.push(c);
    last = c;
  }
  const edges = [0, ...keep, duration];
  return edges.slice(0, -1).map((a, i) => [a, edges[i + 1]] as [number, number]);
}

/** ffmpeg `showinfo` lines -> times (seconds) of the frames that passed the scene filter. */
export function parseCutTimes(stderr: string): number[] {
  return [...stderr.matchAll(/pts_time:\s*(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
}

/** When to look inside a shot (seconds inside the window): the middle for a short shot, a quarter in from each end for a long one. */
export function lookTimes(from: number, to: number): number[] {
  const len = to - from;
  if (len >= LAYOUT_RULES.twoLookSec) return [from + len * 0.25, from + len * 0.75];
  return [from + len / 2];
}

/** The central crop of `box` with the aspect `w/h` (even sizes), so a block of that aspect is filled without stretching. */
export function coverCrop(box: Box, aspect: number): Box {
  let w = box.w;
  let h = box.h;
  if (w / h > aspect) w = h * aspect;
  else h = w / aspect;
  w = even(w);
  h = even(h);
  return { x: Math.round(box.x + (box.w - w) / 2), y: Math.round(box.y + (box.h - h) / 2), w, h };
}

/** Joins neighbouring shots that crop the same way, so a reel is only cut where the look really changes. */
export function mergeShots(shots: ShotLayout[]): ShotLayout[] {
  const out: ShotLayout[] = [];
  for (const s of shots) {
    const prev = out[out.length - 1];
    if (prev && prev.kind === s.kind && iou(prev.host, s.host) >= 0.9 && iou(prev.picture, s.picture) >= 0.9) prev.to = s.to;
    else out.push({ ...s });
  }
  return out;
}

export interface ShotDecision {
  ok: boolean;
  /** Why it is not usable (for the reel's audit note). */
  reason?: string;
  sample?: LayoutSample;
}

/** All looks inside one shot must agree on a confident orientation; the first one supplies the boxes. */
export function decideShot(looks: LayoutSample[]): ShotDecision {
  if (!looks.length) return { ok: false, reason: 'no frame checked' };
  const kinds = new Set(looks.map((l) => l.kind));
  if (kinds.has('other')) return { ok: false, reason: 'not the two-person studio set-up' };
  if (kinds.size > 1) return { ok: false, reason: 'layout changes inside a shot' };
  return { ok: true, sample: looks[0] };
}
