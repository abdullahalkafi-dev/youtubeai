import type { TLine, TWord } from '../db/schemas/reel-transcript.schema';
import type { WhisperResult } from '../ai/ai.service';
import { fmtTime } from '../common/text';

/**
 * Merge chunked speech-to-text results into one transcript:
 *  - words with precise timing (seconds in the source video)
 *  - sentence-level lines, each mapped to an inclusive word range
 * Pure function — unit tested.
 */
export function buildTranscript(chunks: Array<{ offset: number; result: WhisperResult }>): { lines: TLine[]; words: TWord[] } {
  const words: TWord[] = [];
  const segments: Array<{ s: number; e: number; t: string }> = [];

  for (const { offset, result } of chunks) {
    const dropped: Array<[number, number]> = [];
    for (const seg of result.segments) {
      const s = seg.start + offset;
      const e = seg.end + offset;
      const text = (seg.text || '').trim();
      if (!text || isHallucination(seg)) {
        dropped.push([s, e]);
        continue;
      }
      segments.push({ s, e, t: text });
    }
    for (const w of result.words) {
      const token = (w.word || '').trim();
      if (!token) continue;
      const s = w.start + offset;
      const e = Math.max(w.end + offset, s + 0.04);
      if (dropped.some(([a, b]) => s >= a - 0.01 && e <= b + 0.01)) continue;
      words.push({ w: token, s: round(s), e: round(e) });
    }
  }

  words.sort((a, b) => a.s - b.s);
  const dedup: TWord[] = [];
  for (const w of words) {
    const prev = dedup[dedup.length - 1];
    if (prev && prev.w === w.w && Math.abs(prev.s - w.s) < 0.05) continue;
    dedup.push(w);
  }
  segments.sort((a, b) => a.s - b.s);

  // Assign every word to the latest segment that started at or before its midpoint.
  const assigned: number[][] = segments.map(() => []);
  let p = 0;
  dedup.forEach((w, idx) => {
    const mid = (w.s + w.e) / 2;
    while (p < segments.length - 1 && mid >= segments[p + 1].s) p++;
    if (segments.length) assigned[p].push(idx);
  });

  const lines: TLine[] = [];
  segments.forEach((seg, i) => {
    const idxs = assigned[i];
    if (!idxs.length) return;
    for (const piece of splitSentences(seg.t, idxs)) {
      const w0 = piece.idxs[0];
      const w1 = piece.idxs[piece.idxs.length - 1];
      lines.push({ s: dedup[w0].s, e: dedup[w1].e, t: piece.text, w0, w1 });
    }
  });

  return { lines, words: dedup };
}

/** Whisper sometimes invents text over silence/music; drop those segments. */
function isHallucination(seg: WhisperResult['segments'][number]): boolean {
  const noSpeech = seg.no_speech_prob ?? 0;
  const logprob = seg.avg_logprob ?? 0;
  const ratio = seg.compression_ratio ?? 1;
  return (noSpeech > 0.6 && logprob < -1.0) || ratio > 2.6;
}

/**
 * Split a multi-sentence segment into sentence lines, distributing its words by token count.
 * Falls back to the whole segment when the token count doesn't line up with the timed words.
 */
function splitSentences(text: string, idxs: number[]): Array<{ text: string; idxs: number[] }> {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  if (sentences.length <= 1) return [{ text, idxs }];
  const counts = sentences.map((s) => s.split(/\s+/).filter(Boolean).length);
  const total = counts.reduce((a, b) => a + b, 0);
  if (Math.abs(total - idxs.length) > 2) return [{ text, idxs }];

  const out: Array<{ text: string; idxs: number[] }> = [];
  let cursor = 0;
  sentences.forEach((sentence, i) => {
    const isLast = i === sentences.length - 1;
    const take = isLast ? idxs.length - cursor : Math.min(counts[i], idxs.length - cursor - (sentences.length - 1 - i));
    if (take <= 0) {
      // Not enough words left: merge into previous piece.
      if (out.length) out[out.length - 1].text += ` ${sentence}`;
      return;
    }
    out.push({ text: sentence, idxs: idxs.slice(cursor, cursor + take) });
    cursor += take;
  });
  return out.length ? out : [{ text, idxs }];
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Render lines for prompts: `L0042 [3:12.4–3:15.0] text`. */
export function formatLine(i: number, line: TLine): string {
  return `L${String(i).padStart(4, '0')} [${fmtTime(line.s)}–${fmtTime(line.e)}] ${line.t}`;
}

export function formatLines(lines: TLine[], from = 0, to = lines.length - 1): string {
  const out: string[] = [];
  for (let i = Math.max(0, from); i <= Math.min(to, lines.length - 1); i++) out.push(formatLine(i, lines[i]));
  return out.join('\n');
}

/**
 * Start offset of every chunk, built from the TRUE length of the chunks before it.
 * (A previous version summed container durations that already included each chunk's own start time,
 * so offsets grew 1200, 3600, 7200, … and every video over ~40 min got corrupt timestamps.)
 */
export function chunkOffsets(durations: number[]): number[] {
  const offsets: number[] = [];
  let acc = 0;
  for (const d of durations) {
    offsets.push(acc);
    acc += d;
  }
  return offsets;
}

/** Every chunk except the last must be ≈ the requested length; anything else means timestamps are not zero-based. */
export function assertChunkDurations(durations: number[], chunkSec: number, slackSec = 10): void {
  durations.forEach((d, i) => {
    if (!(d > 0)) throw new Error(`chunk ${i + 1} has no duration`);
    if (i < durations.length - 1 && Math.abs(d - chunkSec) > slackSec) {
      throw new Error(`chunk ${i + 1} is ${d.toFixed(1)}s long, expected ≈${chunkSec}s — chunk timestamps are not zero-based`);
    }
    if (i === durations.length - 1 && d > chunkSec + slackSec) {
      throw new Error(`last chunk is ${d.toFixed(1)}s long, longer than the ${chunkSec}s chunk size`);
    }
  });
}

/** A transcript can never run past the end of the audio it came from. */
export function assertTranscriptExtent(lines: TLine[], audioDurationSec: number, slackSec = 8): void {
  if (!lines.length) throw new Error('transcript has no lines');
  const lastEnd = lines[lines.length - 1].e;
  if (lastEnd > audioDurationSec + slackSec) {
    throw new Error(`transcript ends at ${lastEnd.toFixed(0)}s but the audio is only ${audioDurationSec.toFixed(0)}s long — timing is corrupt`);
  }
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].s + 0.5 < lines[i - 1].s) throw new Error(`transcript lines are out of order at line ${i}`);
  }
}
