import type { TLine, TWord } from '../db/schemas/reel-transcript.schema';
import type { ClipRole, ReelWord } from '../db/schemas/reel.schema';

/** A source video prepared for composition (transcript + identity). */
export interface Material {
  key: string; // "V1"
  youtubeId: string;
  videoId: string;
  title: string;
  viewCount: number;
  publishedAt?: Date;
  durationSec: number;
  lines: TLine[];
  words: TWord[];
}

export interface PlannedClip {
  video: string;
  startLine: number;
  endLine: number;
  role: ClipRole;
}

export interface ResolvedClip {
  material: Material;
  role: ClipRole;
  startLine: number;
  endLine: number;
  start: number;
  end: number;
  w0: number;
  w1: number;
  text: string;
}

export interface AssembleRules {
  minSec: number;
  maxSec: number;
  allowCrossVideo: boolean;
}

export interface Assembled {
  ok: boolean;
  errors: string[];
  warnings: string[];
  clips: ResolvedClip[];
  duration: number;
  words: ReelWord[];
  /** What the viewer hears, with ‖CUT‖ markers and reel-timeline stamps (for the critic). */
  script: string;
  videoKeys: string[];
}

const LEAD_PAD = 0.12;
const TAIL_PAD = 0.2;
const MAX_WORD_SPAN = 1.0; // whisper sometimes stretches a word across a pause
const FILLER_OPENERS = new Set(['so', 'and', 'but', 'um', 'uh', 'like', 'yeah', 'okay', 'ok', 'well', 'now', 'listen', 'look']);

/** Word-snapped cut points for an inclusive line range. Never bleeds into neighbouring words. */
export function resolveClipTimes(m: Material, startLine: number, endLine: number) {
  const first = m.lines[startLine];
  const last = m.lines[endLine];
  const w0 = first.w0;
  const w1 = last.w1;
  const fw = m.words[w0];
  const lw = m.words[w1];
  const prev = w0 > 0 ? m.words[w0 - 1] : null;
  const next = w1 < m.words.length - 1 ? m.words[w1 + 1] : null;

  const firstStart = Math.max(fw.s, fw.e - MAX_WORD_SPAN);
  const lastEnd = Math.min(lw.e, lw.s + MAX_WORD_SPAN);

  let start = firstStart - LEAD_PAD;
  if (prev) start = Math.max(start, Math.min(prev.e, firstStart) + 0.03);
  start = Math.max(0, Math.min(start, firstStart));

  let end = lastEnd + TAIL_PAD;
  if (next) end = Math.min(end, Math.max(next.s, lastEnd) - 0.03);
  end = Math.max(end, lastEnd);
  if (m.durationSec > 0) end = Math.min(end, m.durationSec);

  const text = m.lines
    .slice(startLine, endLine + 1)
    .map((l) => l.t)
    .join(' ');
  return { start: r3(start), end: r3(end), w0, w1, text };
}

export function assemble(clips: PlannedClip[], materials: Map<string, Material>, rules: AssembleRules): Assembled {
  const errors: string[] = [];
  const warnings: string[] = [];
  const resolved: ResolvedClip[] = [];

  if (!clips.length) errors.push('reel has no clips');
  if (clips.length > 6) errors.push(`reel has ${clips.length} clips (max 6) — simplify`);

  clips.forEach((c, i) => {
    const n = i + 1;
    const m = materials.get(c.video);
    if (!m) {
      errors.push(`clip ${n}: unknown video "${c.video}"`);
      return;
    }
    if (!Number.isInteger(c.startLine) || !Number.isInteger(c.endLine) || c.startLine < 0 || c.endLine >= m.lines.length) {
      errors.push(`clip ${n}: ${c.video} line range L${c.startLine}–L${c.endLine} does not exist (0–${m.lines.length - 1})`);
      return;
    }
    if (c.endLine < c.startLine) {
      errors.push(`clip ${n}: ${c.video} endLine L${c.endLine} is before startLine L${c.startLine}`);
      return;
    }
    const t = resolveClipTimes(m, c.startLine, c.endLine);
    resolved.push({ material: m, role: c.role, startLine: c.startLine, endLine: c.endLine, ...t });
  });

  const videoKeys = [...new Set(resolved.map((c) => c.material.key))];
  if (videoKeys.length > 2) errors.push(`uses ${videoKeys.length} videos (max 2)`);
  if (videoKeys.length === 2 && !rules.allowCrossVideo) errors.push('cross-video reels are not allowed in this campaign — use one video');

  resolved.forEach((c, i) => {
    const d = c.end - c.start;
    const oneLineHook = i === 0 && c.startLine === c.endLine;
    if (d < 3 && !oneLineHook) errors.push(`clip ${i + 1} is only ${d.toFixed(1)}s (min 3s unless it is a one-line opening hook)`);
  });

  // Same-video clips must not overlap; after a cold-open hook they must move forward in time.
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const a = resolved[i];
      const b = resolved[j];
      if (a.material.key !== b.material.key) continue;
      if (a.startLine <= b.endLine && b.startLine <= a.endLine) {
        errors.push(`clips ${i + 1} and ${j + 1} overlap in ${a.material.key} (L${a.startLine}–L${a.endLine} vs L${b.startLine}–L${b.endLine})`);
      } else if (i > 0 && b.startLine < a.startLine) {
        errors.push(`clips ${i + 1}→${j + 1} jump backwards in ${a.material.key}; only the opening hook may come from later in the video`);
      }
    }
  }

  // Reel timeline: words + script.
  const words: ReelWord[] = [];
  const scriptParts: string[] = [];
  let offset = 0;
  for (const c of resolved) {
    const m = c.material;
    const eosWords = new Set<number>();
    for (let li = c.startLine; li <= c.endLine; li++) if (/[.!?]["')\]]*$/.test(m.lines[li].t.trim())) eosWords.add(m.lines[li].w1);
    for (let wi = c.w0; wi <= c.w1; wi++) {
      const w = m.words[wi];
      const s = Math.max(0, w.s - c.start) + offset;
      const e = Math.min(c.end - c.start, Math.max(w.e - c.start, w.s - c.start + 0.05)) + offset;
      words.push({ w: w.w, s: r3(s), e: r3(Math.max(e, s + 0.04)), ...(eosWords.has(wi) ? { eos: true } : {}) });
    }
    const d = c.end - c.start;
    scriptParts.push(
      `[${offset.toFixed(1)}–${(offset + d).toFixed(1)}s] (${m.key} L${pad(c.startLine)}–L${pad(c.endLine)}, ${c.role}) "${c.text}"`,
    );
    offset += d;
  }
  const duration = r3(offset);

  if (resolved.length && !errors.length) {
    const lo = rules.minSec - 3;
    const hi = rules.maxSec + 2;
    if (duration < lo) errors.push(`total ${duration.toFixed(1)}s is below the ${rules.minSec}s minimum — add ~${Math.ceil(rules.minSec - duration)}s of story`);
    if (duration > hi) errors.push(`total ${duration.toFixed(1)}s is above the ${rules.maxSec}s maximum — cut ~${Math.ceil(duration - rules.maxSec)}s`);

    const firstWord = (resolved[0].material.words[resolved[0].w0]?.w || '').toLowerCase().replace(/[^a-z']/g, '');
    if (FILLER_OPENERS.has(firstWord)) warnings.push(`opens on filler word "${firstWord}"`);
    const lastClip = resolved[resolved.length - 1];
    if (!/[.!?]["')\]]*$/.test(lastClip.material.lines[lastClip.endLine].t.trim())) warnings.push('last line may not be a finished sentence');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    clips: resolved,
    duration,
    words,
    script: scriptParts.join('\n‖CUT‖\n'),
    videoKeys,
  };
}

function pad(n: number) {
  return String(n).padStart(4, '0');
}
function r3(n: number) {
  return Math.round(n * 1000) / 1000;
}
