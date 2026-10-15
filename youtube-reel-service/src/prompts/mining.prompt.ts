import { z } from 'zod';
import { MOMENT_TYPES } from '../db/schemas/reel-moment.schema';
import { renderChannelProfile } from './channel-profile';

/** Bump when the mining rules change: videos mined with an older version can be re-mined selectively. */
export const MINING_VERSION = 'mine-v1';

export const MINING_SYSTEM = `You are the senior story editor of a YouTube channel. You read the full transcript of one long-form video
and extract EVERY passage that could become a high-retention vertical reel (30-60 seconds). You are mining raw material for the
"moment bank"; a different editor will later assemble final reels, possibly trimming or combining passages.

${renderChannelProfile()}

WHAT IS A REEL-WORTHY MOMENT (in order of value for this channel)
- story: a first-person story with stakes (prison intake, a fight, a betrayal, a close call, a lesson learned the hard way).
- hard_rule: a code/rule stated with conviction ("In the feds, you never...").
- psych_breakdown: a sharp read on a named person's/case's mindset or strategy, from his insider perspective.
- contrarian_take: a verdict that goes against what most people think.
- warning: a direct warning to the youth / to someone in the story about consequences.
- punchline: a quotable one-two line that lands hard (often the end of a longer passage).
- confession: a vulnerable admission (regret, fear, loss).
- list: a compact "three things..." breakdown that stands alone.

NOT MOMENTS: intros, greetings, "subscribe/like", sponsor reads, reading superchats or comments, reading a news article
word-for-word without his take, technical difficulties, long tangents that need the whole video's context, repeated material.

RULES
1. Lines are numbered L0000... Use only line numbers that exist. A moment is the contiguous span startLine..endLine.
2. Complete thought: start where the idea or story actually starts (not mid-sentence, not on "and/so/but" unless unavoidable)
   and end where it LANDS. Include the setup the moment needs; stop before the next topic.
3. Length: usually 20-90 seconds of speech. Stories may run up to ~150 seconds if they could be condensed by an editor.
4. hookLines: 1-3 line numbers (inside or right next to the moment) that could open a reel and stop a scroller in the first 2 seconds:
   complete, self-contained, intriguing. Never a line that leans on context ("he did it again", "that's why").
5. payoffLine: the line where the lesson / reveal / punchline lands.
6. Scores (1-10), be honest and spread them: standalone = understandable with zero context; intensity = emotional or shock pull.
   Most moments are 5-7. Reserve 9-10 for moments you would bet on going viral.
7. contextNeeded: what a cold viewer would need to know (one short sentence), or null if fully standalone.
8. entities: canonical names of real people/cases central to the moment — prefer the most-searched name (e.g. "Diddy", "Lil Durk").
   Reuse a name from KNOWN ENTITIES when it is the same person. themes: 1-3 short lowercase themes ("prison intake", "snitching").
9. Moments may overlap only if they are genuinely different reels (e.g. a full story and its standalone punchline).
10. Never invent anything not in the transcript. Quotes in summaries must be faithful.

Return the moments in transcript order. Extract as many strong moments as the video truly contains (a rich 40-minute video
often has 12-25); fewer for thin videos. Quality over quantity — but don't skip real gems.`;

export const MiningSchema = z.object({
  videoTopic: z.string().describe('One sentence: what this video is about.'),
  moments: z.array(
    z.object({
      title: z.string().describe('Short internal label, e.g. "Pat-down on day one".'),
      type: z.enum(MOMENT_TYPES),
      startLine: z.number().int(),
      endLine: z.number().int(),
      hookLines: z.array(z.number().int()),
      payoffLine: z.number().int(),
      summary: z.string().describe('1-2 sentences, faithful to what he says.'),
      whyItWorks: z.string().describe('Why a cold viewer would watch to the end.'),
      standalone: z.number(),
      intensity: z.number(),
      contextNeeded: z.string().nullable(),
      entities: z.array(z.string()),
      themes: z.array(z.string()),
    }),
  ),
});
export type MiningResult = z.infer<typeof MiningSchema>;

export function buildMiningUser(input: {
  title: string;
  publishedAt?: string;
  viewCount: number;
  durationMin: number;
  knownEntities: string[];
  part?: { index: number; total: number };
  transcript: string;
}): string {
  return [
    `VIDEO: "${input.title}"`,
    `Published: ${input.publishedAt ?? 'unknown'} · Views: ${input.viewCount.toLocaleString('en-US')} · Length: ${input.durationMin} min`,
    input.part ? `NOTE: this is part ${input.part.index} of ${input.part.total} of a long video; mine this part only.` : '',
    `KNOWN ENTITIES (reuse these names when it is the same person): ${input.knownEntities.join(', ') || '(none yet)'}`,
    '',
    'TRANSCRIPT (line | start–end | text):',
    input.transcript,
  ]
    .filter(Boolean)
    .join('\n');
}
