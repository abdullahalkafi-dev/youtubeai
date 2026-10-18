import type { ReelWord } from '../db/schemas/reel.schema';
import type { RenderClipInput } from './filtergraph';

/**
 * Pace of a rendered reel: pauses inside clips are cut out (jump cuts) and the whole reel is sped up.
 * Everything that is timed on the reel — captions, AI image beats, the cover frame, QA — goes through the
 * same `map()`, so nothing can drift out of sync.
 *
 * Times come in three flavours:
 *  - source time: seconds inside a source video
 *  - reel time:   the planned reel timeline (clips back to back), what `reel.words` uses
 *  - output time: the finished file after pause cuts and speed-up
 */
export type Voice = 'chipmunk' | 'natural';

export interface PaceOptions {
  /** Playback speed of the whole reel (1 = unchanged). */
  speed: number;
  /** chipmunk: pitch rises with speed ("Mickey Mouse"); natural: pitch kept. */
  voice: Voice;
  /** Remove silences longer than this inside a clip (0 = never). */
  minGap: number;
  /** Silence kept on each side of a removed pause. */
  keep: number;
  /** Upper bound on ffmpeg inputs (clips + cuts). */
  maxSegments: number;
}

export const NO_PACE: PaceOptions = { speed: 1, voice: 'natural', minGap: 0, keep: 0, maxSegments: 1000 };

export interface Timeline {
  speed: number;
  voice: Voice;
  /** Removed pauses on the reel timeline: [start, end). */
  cuts: Array<[number, number]>;
  /** What ffmpeg reads, in order. */
  segments: RenderClipInput[];
  /** Planned reel length before pacing. */
  reelDuration: number;
  /** Final length of the output file. */
  duration: number;
  /** Reel time → output time. */
  map(t: number): number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function buildTimeline(clips: RenderClipInput[], words: ReelWord[], pace: PaceOptions): Timeline {
  const speed = pace.speed > 0 ? pace.speed : 1;

  // Clip spans on the reel timeline.
  const spans: Array<{ from: number; to: number; clip: RenderClipInput }> = [];
  let off = 0;
  for (const c of clips) {
    spans.push({ from: off, to: off + c.duration, clip: c });
    off += c.duration;
  }
  const reelDuration = off;

  // Candidate pauses: gaps between consecutive words that sit inside the same clip.
  const candidates: Array<[number, number]> = [];
  if (pace.minGap > 0) {
    const sorted = [...words].sort((a, b) => a.s - b.s);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (b.s - a.e <= pace.minGap) continue;
      const span = spans.find((s) => a.e >= s.from - 1e-6 && b.s <= s.to + 1e-6);
      if (!span) continue; // the gap crosses a clip boundary: that is already a cut
      const cs = a.e + pace.keep;
      const ce = b.s - pace.keep;
      if (ce - cs >= 0.1) candidates.push([cs, ce]);
    }
  }
  // Keep the longest pauses when there are too many to cut.
  const budget = Math.max(0, pace.maxSegments - clips.length);
  const cuts = candidates
    .sort((x, y) => y[1] - y[0] - (x[1] - x[0]))
    .slice(0, budget)
    .sort((x, y) => x[0] - y[0])
    .map(([a, b]) => [r3(a), r3(b)] as [number, number]);

  // Split every clip around the cuts that fall inside it.
  const segments: RenderClipInput[] = [];
  for (const s of spans) {
    let cursor = s.from;
    for (const [a, b] of cuts) {
      if (a < s.from || b > s.to) continue;
      if (a > cursor) segments.push({ src: s.clip.src, start: r3(s.clip.start + (cursor - s.from)), duration: r3(a - cursor) });
      cursor = b;
    }
    if (s.to - cursor > 0.02) segments.push({ src: s.clip.src, start: r3(s.clip.start + (cursor - s.from)), duration: r3(s.to - cursor) });
  }

  const removedBefore = (t: number) => {
    let removed = 0;
    for (const [a, b] of cuts) {
      if (t <= a) break;
      removed += Math.min(t, b) - a;
    }
    return removed;
  };
  const map = (t: number) => Math.max(0, (t - removedBefore(t)) / speed);
  const kept = segments.reduce((n, sg) => n + sg.duration, 0);

  return { speed, voice: pace.voice, cuts, segments, reelDuration: r3(reelDuration), duration: r3(kept / speed), map };
}

/** Words moved onto the output timeline (for captions and subtitles). */
export function mapWords(words: ReelWord[], tl: Timeline): ReelWord[] {
  return words.map((w) => {
    const s = tl.map(w.s);
    const e = Math.max(tl.map(w.e), s + 0.04);
    return { ...w, s: r3(s), e: r3(e) };
  });
}
