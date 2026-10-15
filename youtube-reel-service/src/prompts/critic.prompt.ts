import { z } from 'zod';
import { renderChannelProfile } from './channel-profile';

export const CRITIC_VERSION = 'critic-v1';

export const CRITIC_SYSTEM = `You are a ruthless short-form retention analyst. You review reel cuts BEFORE they are rendered.
For each reel you read exactly what the viewer will hear, in order, with ‖CUT‖ where two clips are spliced and the reel timeline
in seconds. Judge it as a cold scroller who has never heard of the channel.

${renderChannelProfile()}

SCORE EACH 1-10 (be strict; 7 = good, 9+ = exceptional):
- hook: do seconds 0-3 stop the scroll? Is the first sentence complete, specific and intriguing on its own?
- clarity: fully understandable with zero context? Penalize dangling "he/they/that/it", "like I said", unexplained names or slang that loses a cold viewer.
- flow: do the cuts sound natural? Grammar continues across ‖CUT‖? No repeated words or broken thoughts at a seam? Does it feel like one take?
- payoff: does it deliver a reveal, verdict or lesson that rewards watching?
- ending: does it end on a line that lands — not mid-thought, not trailing into a new topic?
- retention: would people watch to the end / rewatch / share?
- safety: 10 = fully YouTube-safe and fair. Lower it for unproven accusations stated as fact about real people, glorified violence,
  how-to crime, or meaning changed by the splice.

VERDICT
- keep: strong as is.
- revise: a concrete clip change would make it strong. Give the exact fix in line terms, e.g.
  "start clip 2 at V1:L0412 to drop 'so anyway'", "end at V2:L0455 — L0456 starts a new topic", "use V1:L0398 as cold-open hook".
- drop: weak material, or a splice that misrepresents him. Do not try to rescue weak reels.
issues: the specific problems, short.`;

export const CriticSchema = z.object({
  reviews: z.array(
    z.object({
      ref: z.string().describe('Reel id, e.g. "R2".'),
      hook: z.number(),
      clarity: z.number(),
      flow: z.number(),
      payoff: z.number(),
      ending: z.number(),
      retention: z.number(),
      safety: z.number(),
      verdict: z.enum(['keep', 'revise', 'drop']),
      issues: z.array(z.string()),
      revision: z.string().nullable().describe('Concrete fix for verdict=revise, else null.'),
    }),
  ),
});
export type CriticReview = z.infer<typeof CriticSchema>['reviews'][number];

/** Weighted 0-100 score computed in code (not by the model) so ranking is stable and explainable. */
export function overallScore(r: Pick<CriticReview, 'hook' | 'clarity' | 'flow' | 'payoff' | 'ending' | 'retention' | 'safety'>): number {
  const c = (n: number) => Math.max(1, Math.min(10, n));
  let score =
    c(r.hook) * 2.5 + c(r.clarity) * 1.5 + c(r.flow) * 1.5 + c(r.payoff) * 2.0 + c(r.ending) * 1.0 + c(r.retention) * 1.5;
  // 10 * (2.5+1.5+1.5+2+1+1.5) = 100
  if (c(r.safety) <= 6) score -= (7 - c(r.safety)) * 8;
  return Math.max(0, Math.round(score));
}

/** A reel ships only if it is strong overall AND has no weak link. */
export function passesBar(r: CriticReview, minOverall = 70): boolean {
  const weakest = Math.min(r.hook, r.clarity, r.flow, r.payoff, r.ending, r.retention);
  return overallScore(r) >= minOverall && weakest >= 6 && r.safety >= 7;
}

export function buildCriticUser(brief: string, reels: string[]): string {
  return [`CAMPAIGN BRIEF: "${brief}"`, '', ...reels].join('\n');
}
