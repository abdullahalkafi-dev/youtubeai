/**
 * Silence trimming for a whole episode. Pure functions (no I/O): ffmpeg's silencedetect output goes in, a list of removed ranges comes out,
 * and the same list maps any moment of the original video to its moment in the trimmed audio (chapters).
 */

export interface Range {
  start: number;
  end: number;
}

export interface CutOptions {
  /** Only pauses at least this long are shortened. */
  minSilence: number;
  /** How much of a shortened pause stays (split half before, half after). */
  keep: number;
}

export const DEFAULT_CUT: CutOptions = { minSilence: 1.5, keep: 0.6 };

/** ffmpeg `silencedetect` lines -> [start, end] pairs. A silence that runs to the end of the file has no end line: it ends at `total`. */
export function parseSilences(stderr: string, total: number): Range[] {
  const out: Range[] = [];
  let open: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (s) {
      open = Math.max(0, parseFloat(s[1]));
      continue;
    }
    const e = /silence_end:\s*(-?[\d.]+)/.exec(line);
    if (e && open !== null) {
      out.push({ start: open, end: Math.min(total, parseFloat(e[1])) });
      open = null;
    }
  }
  if (open !== null && total > open) out.push({ start: open, end: total });
  return out;
}

/** The ranges to remove: each long pause keeps `keep/2` seconds on both sides. Sorted, never overlapping, always inside [0, total]. */
export function planCuts(silences: Range[], total: number, opts: CutOptions = DEFAULT_CUT): Range[] {
  const half = opts.keep / 2;
  const cuts: Range[] = [];
  for (const s of [...silences].sort((a, b) => a.start - b.start)) {
    if (s.end - s.start < opts.minSilence) continue;
    const start = Math.max(0, s.start + half);
    const end = Math.min(total, s.end - half);
    if (end - start < 0.3) continue;
    const last = cuts[cuts.length - 1];
    if (last && start < last.end) last.end = Math.max(last.end, end);
    else cuts.push({ start, end });
  }
  return cuts;
}

export function removedSeconds(cuts: Range[]): number {
  return cuts.reduce((a, c) => a + (c.end - c.start), 0);
}

/** The pieces of the original that stay, in order. */
export function keepSegments(cuts: Range[], total: number): Range[] {
  const segs: Range[] = [];
  let at = 0;
  for (const c of cuts) {
    if (c.start > at) segs.push({ start: at, end: c.start });
    at = Math.max(at, c.end);
  }
  if (at < total) segs.push({ start: at, end: total });
  return segs;
}

/** A moment in the original -> the same moment in the trimmed audio. A moment inside a removed pause lands where the pause was shortened. */
export function mapTime(t: number, cuts: Range[]): number {
  let removed = 0;
  for (const c of cuts) {
    if (t >= c.end) removed += c.end - c.start;
    else {
      if (t > c.start) removed += t - c.start;
      break;
    }
  }
  return Math.max(0, t - removed);
}

/**
 * ffmpeg audio filter (for `-filter_script:a`) that drops every `cuts` range in one pass and re-times the rest so there are no gaps.
 * One pass (aselect) instead of one atrim per piece: hundreds of pieces would need the input split hundreds of ways and buffered in memory.
 * aselect works on whole frames (about 23 ms), which is fine because every cut sits inside a pause.
 */
export function buildTrimFilter(cuts: Range[]): string {
  const f = (n: number) => n.toFixed(3);
  const drop = cuts.map((c) => `between(t,${f(c.start)},${f(c.end)})`).join('+');
  return `aselect='not(${drop})',asetpts=N/SR/TB`;
}

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
