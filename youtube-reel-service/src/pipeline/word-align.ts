import type { ReelWord } from '../db/schemas/reel.schema';

/**
 * Word times measured on the reel's own audio.
 *
 * The stored word times come from transcribing the whole source video. After a pause they can be
 * up to a second early (measured on a live Short: captions and pictures ran ahead of the voice at
 * every cut). A short, fresh transcription of exactly the planned audio is accurate, so its times
 * replace the stored ones. The stored TEXT is kept: the new transcript is only used for timing, and
 * the two are matched word by word.
 */

export interface HeardWord {
  word: string;
  start: number;
  end: number;
}

export interface ClipSpan {
  from: number;
  to: number;
}

export interface RealignResult {
  ok: boolean;
  reason?: string;
  words: ReelWord[];
  /** Stored words that found a clearly matching heard word (0-1 of all words). */
  coverage: number;
  /** Largest move of a word start, in seconds. */
  maxShift: number;
  /** Maps a time on the old timeline to the corrected timeline (used for the AI pictures). */
  correct(t: number): number;
}

const MIN_COVERAGE = 0.6;
const MIN_WORD = 0.04;

const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** 2 = same word, 1 = close ("tells"/"tell"), -0.5 = different (still the same position in the speech). */
function pairScore(a: string, b: string): number {
  if (!a || !b) return -0.5;
  if (a === b) return 2;
  const longest = Math.max(a.length, b.length);
  return longest >= 3 && 1 - levenshtein(a, b) / longest >= 0.5 ? 1 : -0.5;
}

const GAP = -1;

/** Needleman-Wunsch: for each stored word, the index of the heard word at the same place in the speech (or -1). */
function matchWords(old: string[], heard: string[]): number[] {
  const n = old.length;
  const m = heard.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) dp[i][0] = i * GAP;
  for (let j = 1; j <= m; j++) dp[0][j] = j * GAP;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = Math.max(
        dp[i - 1][j - 1] + pairScore(old[i - 1], heard[j - 1]),
        dp[i - 1][j] + GAP,
        dp[i][j - 1] + GAP,
      );
    }
  }
  const out = new Array(n).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (dp[i][j] === dp[i - 1][j - 1] + pairScore(old[i - 1], heard[j - 1])) {
      out[i - 1] = j - 1;
      i--;
      j--;
    } else if (dp[i][j] === dp[i - 1][j] + GAP) i--;
    else j--;
  }
  return out;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

function fail(reason: string, words: ReelWord[]): RealignResult {
  return { ok: false, reason, words, coverage: 0, maxShift: 0, correct: (t) => t };
}

export function realignWords(old: ReelWord[], heard: HeardWord[], spans: ClipSpan[]): RealignResult {
  if (!old.length) return fail('no words to align', old);
  if (!heard.length) return fail('no speech heard in the reel audio', old);

  const match = matchWords(old.map((w) => norm(w.w)), heard.map((h) => norm(h.word)));
  const good = old.filter((w, i) => match[i] >= 0 && pairScore(norm(w.w), norm(heard[match[i]].word)) > 0).length;
  const coverage = good / old.length;
  if (coverage < MIN_COVERAGE) return fail(`only ${Math.round(coverage * 100)}% of the words matched`, old);

  const spanOf = (t: number) => spans.find((s) => t >= s.from - 1e-6 && t <= s.to + 1e-6) ?? spans[spans.length - 1];
  const starts: number[] = new Array(old.length);
  const ends: number[] = new Array(old.length);
  for (let i = 0; i < old.length; i++) {
    if (match[i] >= 0) {
      starts[i] = heard[match[i]].start;
      ends[i] = Math.max(heard[match[i]].end, heard[match[i]].start + MIN_WORD);
    }
  }
  // Words with no heard partner share the room between their matched neighbours, by length.
  for (let i = 0; i < old.length; ) {
    if (match[i] >= 0) {
      i++;
      continue;
    }
    let k = i;
    while (k < old.length && match[k] < 0) k++;
    const left = i > 0 ? ends[i - 1] : undefined;
    const right = k < old.length ? starts[k] : undefined;
    const count = k - i;
    const weights = old.slice(i, k).map((w) => Math.max(1, norm(w.w).length));
    const total = weights.reduce((a, b) => a + b, 0);
    const lo = left ?? (right !== undefined ? Math.max(0, right - 0.3 * count) : old[i].s);
    const hi = right ?? lo + 0.3 * count;
    let at = lo;
    for (let x = i; x < k; x++) {
      const share = ((hi - lo) * weights[x - i]) / total;
      starts[x] = at;
      ends[x] = Math.max(at + share, at + MIN_WORD);
      at += share;
    }
    i = k;
  }

  const words: ReelWord[] = [];
  let maxShift = 0;
  let prevStart = 0;
  for (let i = 0; i < old.length; i++) {
    const span = spanOf((old[i].s + old[i].e) / 2);
    const lastStart = Math.max(span.from, span.to - MIN_WORD);
    const s = Math.min(Math.max(starts[i], span.from, prevStart), lastStart);
    const e = Math.min(Math.max(ends[i], s + MIN_WORD), Math.max(span.to, s + MIN_WORD));
    prevStart = s;
    maxShift = Math.max(maxShift, Math.abs(s - old[i].s));
    words.push({ ...old[i], s: r3(s), e: r3(e) });
  }

  // Words that share a stored start (the stored times often do) count once, at the first of them.
  const xs: number[] = [];
  const ys: number[] = [];
  old.forEach((w, i) => {
    if (!xs.length || w.s > xs[xs.length - 1] + 1e-9) {
      xs.push(w.s);
      ys.push(words[i].s);
    }
  });
  const correct = (t: number): number => {
    if (t <= xs[0]) return t + (ys[0] - xs[0]);
    const last = xs.length - 1;
    if (t >= xs[last]) return t + (ys[last] - xs[last]);
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= t) lo = mid;
      else hi = mid;
    }
    const span = xs[hi] - xs[lo];
    return span <= 1e-9 ? ys[lo] : ys[lo] + ((t - xs[lo]) * (ys[hi] - ys[lo])) / span;
  };

  return { ok: true, words, coverage, maxShift: r3(maxShift), correct };
}

/**
 * After the render: words whose caption starts well inside a stretch of silence in the real output
 * audio. Zero means the captions sit on the voice.
 */
export function captionsInSilence(
  words: ReelWord[],
  silences: Array<[number, number]>,
  tolerance = 0.25,
): { count: number; worst: number } {
  let count = 0;
  let worst = 0;
  for (const w of words) {
    for (const [a, b] of silences) {
      if (b - a < 0.3) continue;
      const inside = Math.min(w.s - a, b - w.s);
      if (inside > tolerance) {
        count++;
        worst = Math.max(worst, inside);
        break;
      }
    }
  }
  return { count, worst: r3(worst) };
}

/** Parses ffmpeg silencedetect lines into [start, end] pairs. */
export function parseSilences(stderr: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let open: number | null = null;
  for (const line of String(stderr || '').split('\n')) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (s) open = Math.max(0, Number(s[1]));
    const e = /silence_end:\s*(-?[\d.]+)/.exec(line);
    if (e && open !== null) {
      out.push([open, Number(e[1])]);
      open = null;
    }
  }
  return out;
}
