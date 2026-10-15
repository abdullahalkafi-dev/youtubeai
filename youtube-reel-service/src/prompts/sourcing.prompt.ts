import { z } from 'zod';
import { renderChannelProfile } from './channel-profile';

export const SOURCING_VERSION = 'sourcing-v1';

/* ---------- Pass 1 (fast model): scan the whole catalog by title ---------- */

export const TITLE_SCAN_SYSTEM = `You scan a YouTube channel's full video catalog (one line per video) and pick the videos most likely
to contain strong spoken material for a reel campaign. Judge by title, but think about what the host would talk about in that video:
a video about a different person can still contain the right story if the brief is a theme (e.g. "prison intake").
Return the catalog index numbers only. Prefer recall: include anything plausibly relevant.`;

export const TitleScanSchema = z.object({
  picks: z
    .array(z.object({ index: z.number().int(), relevance: z.number().describe('1-10') }))
    .describe('Up to 30 most relevant catalog indexes.'),
});

export function buildTitleScanUser(brief: string, keywords: string[], catalogLines: string[]): string {
  return [
    `CAMPAIGN BRIEF: "${brief}"`,
    `KEY TERMS: ${keywords.join(', ') || '(none)'}`,
    '',
    'CATALOG (index | title | views | year | minutes):',
    ...catalogLines,
  ].join('\n');
}

/* ---------- Pass 2 (primary model): choose the source videos ---------- */

export const SOURCE_SELECT_SYSTEM = `You are the producer choosing which of the host's long-form videos to mine for a reel campaign.
${renderChannelProfile()}

You get candidate videos with evidence: title, views, date, length, how often the campaign's key terms are spoken, and short transcript excerpts.
Choose the videos that will give the editor the richest, most on-brief raw material.

Selection principles:
1. On-brief first: the host must actually TALK about the subject at length (look at excerpts and term hits, not just titles).
2. Story density: prefer videos where he tells first-person stories, states hard rules, or gives sharp verdicts — not ones where he mostly reads news.
3. Proven pull: higher views signal topics/episodes the audience loved; break ties with views.
4. Freshness balance: include recent episodes when the topic is trending now; classics when the brief is evergreen.
5. Variety: avoid near-duplicate episodes (e.g. three re-uploads of the same interview) unless the brief demands depth.
6. "already analyzed" videos are free to reuse — include them when they are on-brief.
Return between the requested minimum and maximum. Give each a one-line reason that names the material you expect to find.`;

export const SourceSelectSchema = z.object({
  selections: z.array(
    z.object({
      youtubeId: z.string(),
      reason: z.string().describe('One line: what reel material this video should provide.'),
      priority: z.number().describe('1 (must use) - 3 (nice to have)'),
    }),
  ),
  notes: z.string().describe('One or two sentences on coverage gaps, if any.'),
});

export function buildSourceSelectUser(input: {
  brief: string;
  angles: string[];
  minVideos: number;
  maxVideos: number;
  candidates: string[];
}): string {
  return [
    `CAMPAIGN BRIEF: "${input.brief}"`,
    input.angles.length ? `TARGET ANGLES:\n${input.angles.map((a) => `- ${a}`).join('\n')}` : '',
    `Choose ${input.minVideos}-${input.maxVideos} videos.`,
    '',
    'CANDIDATES:',
    ...input.candidates,
  ]
    .filter(Boolean)
    .join('\n');
}
