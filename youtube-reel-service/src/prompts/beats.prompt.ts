import { z } from 'zod';
import type { ReelWord } from '../db/schemas/reel.schema';

/** v2: the model quotes the spoken PHRASE; code finds it in the transcript and sets the timing (v1 asked for a line index and landed 2-5 s off). */
export const BEATS_VERSION = 'beats-v2';

export const BEATS_SYSTEM = `You are the visual editor for vertical YouTube Shorts cut from a long talk/podcast video.
The host talks on camera. You choose the moments where a short AI-generated picture should appear as a CARD on top of
his video (his video stays visible around it) so the viewer SEES what he is describing. His voice never stops.

HOW MANY
- Aim for roughly ONE picture every 4-5 seconds of the reel (a 35 s reel -> 5-7 pictures). More pictures keep attention
  up, so show EVERY concrete scene, place, object, person, event, number-as-a-thing or action he describes.
- Skip only pure opinion, abstract advice, or a moment where his own face and reaction ARE the point.
- NEVER cover the payoff: the transcript marks it with <<PAYOFF>>. Nothing from that mark on.

WHEN (this is the most important part)
- "phrase": copy 2-6 CONSECUTIVE words EXACTLY as written in the transcript, taken from the moment he STARTS saying the
  thing the picture shows (the first words of that description), never from earlier context. The picture will appear
  the instant he says the first word of the phrase, and stay while he finishes the sentence. If the picture shows
  "the cell toilet", the phrase must be where he first says it, not the sentence before.
- Use a different phrase for every picture. Do not reuse the same words twice.

PICTURES
- One shared style for the whole reel (write it in "style"): cinematic photo-real editorial look, dramatic lighting,
  shallow depth of field, 35mm, rich contrast. The image must be understood in 1.5 seconds on a phone.
- Each prompt describes ONE clear scene with the subject large in frame, landscape composition.
- No text, captions, logos, watermarks or UI in the image.
- Real people are allowed: put their exact names in "people" and name them in the prompt, matching what the host says
  (never invent crimes, injuries or facts he does not state).
- safePrompt: the same scene WITHOUT any real person's name or face (from behind, silhouette, hands, the place itself).
  It is used if the main prompt is refused.
- No gore, no nudity, no weapons pointed at the viewer, no minors in danger.
- importance: "high" for the strongest pictures (kept first if there are too many), otherwise "medium".`;

export const BeatsSchema = z.object({
  style: z.string(),
  beats: z
    .array(
      z.object({
        phrase: z.string(),
        importance: z.enum(['high', 'medium']),
        purpose: z.string(),
        prompt: z.string(),
        safePrompt: z.string(),
        people: z.array(z.string()),
      }),
    )
    .max(10),
});
export type BeatsResult = z.infer<typeof BeatsSchema>;

/** Transcript as continuous sentences (no indexes), with the payoff marked, so the model can quote it. */
export function buildBeatsUser(input: {
  concept: string;
  headline: string;
  words: ReelWord[];
  protectedFrom: number;
  knownPeople: string[];
}): string {
  const total = input.words.length ? input.words[input.words.length - 1].e : 0;
  const out: string[] = [];
  input.words.forEach((w, i) => {
    if (i === input.protectedFrom) out.push('<<PAYOFF>>');
    out.push(w.w);
    if (w.eos) out.push('\n');
  });
  const wanted = Math.max(3, Math.round(total / 4.5));
  return [
    `REEL: ${input.concept}`,
    `ON-SCREEN HEADLINE: ${input.headline}`,
    `LENGTH: ${total.toFixed(0)} seconds (aim for about ${wanted} pictures)`,
    input.knownPeople.length ? `PEOPLE WE HAVE REAL PHOTOS OF (use these exact names in "people" when they appear): ${input.knownPeople.join(', ')}` : '',
    '',
    'TRANSCRIPT (exactly what he says; quote "phrase" from here):',
    out.join(' ').replace(/ \n /g, '\n').replace(/ \n/g, '\n'),
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export interface PlannedBeat {
  start: number;
  end: number;
  importance: 'high' | 'medium';
  purpose: string;
  prompt: string;
  safePrompt: string;
  people: string[];
  /** The words he says when the picture appears (for the editor and debugging). */
  phrase: string;
}

export const BEAT_RULES = {
  /** The picture appears this long BEFORE the first word of its phrase (a hair early reads as "in sync"). */
  lead: 0.05,
  /** Never before this, so the host's face opens the reel. */
  minStart: 0.8,
  minLen: 1.6,
  maxLen: 3.4,
  /** Gap between two pictures. */
  gap: 1.0,
  /** Share of the reel the pictures may cover (the host stays on screen the rest of the time). */
  maxCoverage: 0.4,
  /** Fraction of the phrase's words that must match for it to count as found. */
  minMatch: 0.8,
};

const norm = (w: string) => w.toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z0-9']/g, '');

/** Where the quoted phrase is spoken: first and last word index, or null if it isn't in the transcript. */
export function locatePhrase(words: ReelWord[], phrase: string): { first: number; last: number; score: number } | null {
  const tokens = phrase.split(/\s+/).map(norm).filter(Boolean);
  if (tokens.length < 2 || !words.length) return null;
  const spoken = words.map((w) => norm(w.w));
  let best: { first: number; last: number; score: number } | null = null;
  // The model may drop or add one word: try windows of the phrase length (+-1).
  for (const size of [tokens.length, tokens.length + 1, tokens.length - 1]) {
    if (size < 2) continue;
    for (let i = 0; i + size <= spoken.length; i++) {
      let hits = 0;
      for (let j = 0, k = 0; j < size && k < tokens.length; j++) {
        if (spoken[i + j] === tokens[k]) {
          hits++;
          k++;
        }
      }
      const score = hits / tokens.length;
      if (score >= BEAT_RULES.minMatch && spoken[i] === tokens[0] && (!best || score > best.score + 1e-9)) best = { first: i, last: i + size - 1, score };
    }
  }
  return best;
}

/**
 * Enforce the rules in code (the model only proposes):
 *  - the picture appears as he starts the phrase and stays until he finishes that sentence (1.6-3.4 s);
 *  - never before 0.8 s, never over the payoff, >=1 s apart, <=40% of the reel, <= `max` pictures;
 *  - phrases that can't be found in the transcript are dropped (no guessing).
 */
export function placeBeats(result: BeatsResult, words: ReelWord[], protectedFrom: number, max = 7): PlannedBeat[] {
  if (!words.length) return [];
  const total = words[words.length - 1].e;
  const limit = protectedFrom >= 0 && protectedFrom < words.length ? words[protectedFrom].s - 0.2 : total - 0.3;
  const R = BEAT_RULES;

  const candidates: PlannedBeat[] = [];
  const usedAt = new Set<number>();
  for (const b of result.beats) {
    if (!b.prompt.trim()) continue;
    const at = locatePhrase(words, b.phrase);
    if (!at || usedAt.has(at.first)) continue;
    usedAt.add(at.first);
    const start = Math.max(R.minStart, words[at.first].s - R.lead);
    // hold through the end of the sentence the phrase sits in, within the length limits
    let sentenceEnd = words[at.last].e;
    for (let j = at.last; j < words.length; j++) {
      sentenceEnd = words[j].e;
      if (words[j].eos) break;
      if (sentenceEnd - start > R.maxLen) break;
    }
    let end = Math.max(words[at.last].e + 0.2, sentenceEnd + 0.1, start + R.minLen);
    end = Math.min(end, start + R.maxLen, limit, total - 0.3);
    if (end - start < 1.2) continue;
    candidates.push({ start, end, importance: b.importance, purpose: b.purpose, prompt: b.prompt.trim(), safePrompt: b.safePrompt.trim() || b.prompt.trim(), people: b.people.filter(Boolean), phrase: b.phrase.trim() });
  }
  candidates.sort((a, b) => (a.importance === b.importance ? a.start - b.start : a.importance === 'high' ? -1 : 1));

  const kept: PlannedBeat[] = [];
  let covered = 0;
  for (const c of candidates) {
    if (kept.length >= max) break;
    if (covered + (c.end - c.start) > total * R.maxCoverage) continue;
    if (kept.some((k) => c.start < k.end + R.gap && k.start < c.end + R.gap)) continue;
    kept.push(c);
    covered += c.end - c.start;
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return kept.sort((a, b) => a.start - b.start).map((b) => ({ ...b, start: r2(b.start), end: r2(b.end) }));
}
