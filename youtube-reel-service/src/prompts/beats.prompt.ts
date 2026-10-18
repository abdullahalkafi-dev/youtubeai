import { z } from 'zod';
import type { ReelWord } from '../db/schemas/reel.schema';

export const BEATS_VERSION = 'beats-v1';

export const BEATS_SYSTEM = `You are the visual editor for vertical YouTube Shorts cut from a long talk/podcast video.
The host is talking on camera. You decide WHERE a short AI-generated image should briefly replace the talking head
so the viewer SEES what he is describing (an event, a place, a moment, an object, a person he names). Images are
shown inside the video window for 1.5-3 seconds each; the host's voice keeps playing underneath.

WHEN TO USE AN IMAGE (0-4 per reel; fewer is better than weak ones)
- He describes a concrete scene, event or object the viewer can't see: a prison cell, a courtroom moment, a raid,
  money, a car, a phone call, a crowd, a specific person he names.
- Early in the reel an image can grab attention (the first one may start within the first 3 seconds).
- Do NOT use an image for abstract opinions, generic talk, or where his face/reaction IS the moment.
- NEVER cover the punchline/payoff: the payoff word range is given and is off limits.
- Leave at least 1.5 seconds between images. Total image time must stay under 30% of the reel.
- durationSec: 1.5 for a quick illustration, up to 3.0 for the most important moment.

PROMPTS
- One shared style for the whole reel (write it in "style"): cinematic photo-real editorial look, dramatic lighting,
  shallow depth of field, 35mm, rich contrast. The image must make sense in 2 seconds on a phone.
- Each prompt describes ONE clear scene with the subject large in frame. Landscape composition (wider than tall).
- No text, captions, logos, watermarks or UI in the image.
- Real people are allowed: put their exact names in "people" and describe them in the prompt by name and situation,
  matching what the host says (do not invent crimes, injuries or facts he does not state).
- safePrompt: the same scene WITHOUT any real person's name or face (e.g. seen from behind, silhouette, hands, the
  place itself). It is used if the main prompt is refused.
- No gore, no nudity, no weapons pointed at the viewer, no minors in danger.`;

export const BeatsSchema = z.object({
  style: z.string(),
  beats: z
    .array(
      z.object({
        startWord: z.number().int(),
        durationSec: z.number(),
        importance: z.enum(['high', 'medium']),
        purpose: z.string(),
        prompt: z.string(),
        safePrompt: z.string(),
        people: z.array(z.string()),
      }),
    )
    .max(6),
});
export type BeatsResult = z.infer<typeof BeatsSchema>;

export function buildBeatsUser(input: {
  concept: string;
  headline: string;
  words: ReelWord[];
  protectedFrom: number;
  knownPeople: string[];
}): string {
  const lines: string[] = [];
  let line: string[] = [];
  let lineStart = 0;
  input.words.forEach((w, i) => {
    if (!line.length) lineStart = i;
    line.push(w.w);
    if (w.eos || line.length >= 12 || i === input.words.length - 1) {
      lines.push(`[${lineStart}] ${input.words[lineStart].s.toFixed(1)}s: ${line.join(' ')}`);
      line = [];
    }
  });
  const total = input.words.length ? input.words[input.words.length - 1].e : 0;
  return [
    `REEL: ${input.concept}`,
    `ON-SCREEN HEADLINE: ${input.headline}`,
    `LENGTH: ${total.toFixed(1)}s`,
    `PAYOFF (off limits for images): from word ${input.protectedFrom} to the end`,
    input.knownPeople.length ? `PEOPLE WE HAVE REAL PHOTOS OF (use these exact names in "people" when they appear): ${input.knownPeople.join(', ')}` : '',
    '',
    'TRANSCRIPT ([first word index] start time: words):',
    ...lines,
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
}

/**
 * Enforce the rules in code (the model only proposes): valid word, 1.5-3 s, inside the reel, not over the payoff,
 * ≥1.5 s apart, ≤30% coverage, ≤4 images. Higher-importance beats win conflicts.
 */
export function placeBeats(result: BeatsResult, words: ReelWord[], protectedFrom: number, max = 4): PlannedBeat[] {
  if (!words.length) return [];
  const total = words[words.length - 1].e;
  const limit = protectedFrom >= 0 && protectedFrom < words.length ? words[protectedFrom].s : total;
  const candidates = result.beats
    .filter((b) => b.startWord >= 0 && b.startWord < words.length && b.prompt.trim())
    .map((b) => {
      const start = Math.max(0, words[b.startWord].s - 0.1);
      const end = Math.min(start + Math.min(3, Math.max(1.5, b.durationSec)), limit - 0.2, total - 0.3);
      return { start, end, importance: b.importance, purpose: b.purpose, prompt: b.prompt.trim(), safePrompt: b.safePrompt.trim() || b.prompt.trim(), people: b.people.filter(Boolean) };
    })
    .filter((b) => b.end - b.start >= 1.2)
    .sort((a, b) => (a.importance === b.importance ? a.start - b.start : a.importance === 'high' ? -1 : 1));

  const kept: PlannedBeat[] = [];
  let covered = 0;
  for (const b of candidates) {
    if (kept.length >= max) break;
    const d = b.end - b.start;
    if (covered + d > total * 0.3) continue;
    if (kept.some((k) => b.start < k.end + 1.5 && k.start < b.end + 1.5)) continue;
    kept.push(b);
    covered += d;
  }
  return kept.sort((a, b) => a.start - b.start).map((b) => ({ ...b, start: r2(b.start), end: r2(b.end) }));
}

const r2 = (n: number) => Math.round(n * 100) / 100;
