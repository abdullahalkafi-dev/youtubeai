/**
 * Studio layout of a source video, for the full-screen reel look. Pure functions (no I/O): the vision call and the ffmpeg
 * work live in layout.service.ts.
 *
 * The studio set has two orientations that the editor swaps on a hard cut: the host on the left with the story picture on the
 * right (`host_left`) and the reverse (`host_right`). Anything else (host alone, a full-screen clip, an intro card) is `other`
 * and makes the reel fall back to the classic look.
 */
export const LAYOUT_VERSION = 'layout-v3';

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
  /** The host's head only (hat, face, headphones). The host stands in front of one end of the story panel, so his body box would cut into the picture. */
  head: Box | null;
  /** The story panel as the model sees it (it may run behind the host). */
  picture: Box | null;
}

/** A checked answer for one frame. `t` is source seconds; `host` and `picture` are the crops (source pixels) derived from the head and panel boxes. */
export interface LayoutSample {
  /** Why a frame was not accepted (audit). */
  why?: string;
  t: number;
  kind: LayoutKind;
  conf: number;
  /** The model's head box in source pixels (audit). */
  head?: Box;
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
  /** The story panel's gold frame ends here in every video of this set (the ticker overlaps its lower edge). */
  pictureMaxBottom: 0.77,
  minTop: 0.055,
  headWidth: [0.08, 0.42] as const,
  headHeight: [0.15, 0.75] as const,
  pictureWidth: [0.35, 0.8] as const,
  pictureAspect: [1.2, 2.3] as const,
  /** The host crop stops this far (share of the frame width) beyond the head on the picture side, and starts this far above it (share of the height). */
  hostMargin: 0.004,
  hostTopPad: 0.02,
  /** The picture crop is taken this far inside the model's panel box, to keep the gold frame out. */
  pictureInsetX: 0.01,
  pictureInsetY: 0.006,
  /** The host crop must be at least this wide and the picture crop at least this wide (shares of the frame width) to be usable. */
  minHostWidth: 0.2,
  minPictureWidth: 0.3,
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

/** A fractional box (clamped to the frame) in pixels, as edges. */
function edges(f: Box, W: number, H: number) {
  return { l: clamp(f.x, 0, 1) * W, t: clamp(f.y, 0, 1) * H, r: clamp(f.x + f.w, 0, 1) * W, b: clamp(f.y + f.h, 0, 1) * H };
}

const px = (l: number, t: number, r: number, b: number): Box => ({ x: Math.round(l), y: Math.round(t), w: Math.round(r - l), h: Math.round(b - t) });

/**
 * Turns the model's answer for a frame into a checked sample. The host crop runs from the frame edge to just past his head (his
 * body is partly in front of the picture panel, so the head is the divider); the picture crop is the panel from that divider to its
 * far edge, inside its gold frame. Impossible geometry makes the sample `other` with no confidence.
 */
export function checkSample(raw: RawFrameLayout, t: number, W: number, H: number, minConf: number): LayoutSample {
  const bad = (why: string): LayoutSample => ({ t, kind: 'other', conf: 0, why: `${why} (model said ${raw.kind} ${raw.confidence})` });
  if (raw.kind === 'other') return { t, kind: 'other', conf: clamp(raw.confidence, 0, 1) };
  if (!raw.head || !raw.picture) return bad('boxes missing');
  const R = LAYOUT_RULES;
  const hd = edges(raw.head, W, H);
  const pc = edges(raw.picture, W, H);
  const headW = (hd.r - hd.l) / W;
  const headH = (hd.b - hd.t) / H;
  if (headW < R.headWidth[0] || headW > R.headWidth[1] || headH < R.headHeight[0] || headH > R.headHeight[1]) return bad('head size outside the studio proportions');
  const pw = (pc.r - pc.l) / W;
  const pAspect = (pc.r - pc.l) / Math.max(1, pc.b - pc.t);
  if (pw < R.pictureWidth[0] || pw > R.pictureWidth[1] || pAspect < R.pictureAspect[0] || pAspect > R.pictureAspect[1]) return bad('picture panel outside the studio proportions');
  const left = raw.kind === 'host_left';
  if (left ? (hd.l + hd.r) / 2 >= (pc.l + pc.r) / 2 : (hd.l + hd.r) / 2 <= (pc.l + pc.r) / 2) return bad('host and picture on the wrong sides');

  const m = R.hostMargin * W;
  const top = Math.max(R.minTop * H, hd.t - R.hostTopPad * H);
  const bottom = R.maxBottom * H;
  const divider = left ? hd.r + m : hd.l - m;
  const host = left ? px(0, top, divider, bottom) : px(divider, top, W, bottom);
  const inX = R.pictureInsetX * W;
  const inY = R.pictureInsetY * H;
  const pTop = Math.max(R.minTop * H, pc.t + inY);
  const pBottom = Math.min(R.pictureMaxBottom * H, pc.b - inY);
  const picture = left ? px(Math.max(divider, pc.l), pTop, pc.r - inX, pBottom) : px(pc.l + inX, pTop, Math.min(divider, pc.r), pBottom);
  if (host.w / W < R.minHostWidth || picture.w / W < R.minPictureWidth || host.h <= 0 || picture.h <= 0) return bad('crops too small');
  const conf = clamp(raw.confidence, 0, 1);
  return { t, kind: conf >= minConf ? raw.kind : 'other', conf, head: px(hd.l, hd.t, hd.r, hd.b), host, picture };
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
