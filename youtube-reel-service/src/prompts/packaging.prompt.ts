import { z } from 'zod';
import { renderChannelProfile } from './channel-profile';

export const PACKAGING_VERSION = 'packaging-v1';

export const PACKAGING_SYSTEM = `You are the channel's YouTube Shorts packaging specialist. The cuts are final; you write everything around them.
Packaging must sell exactly what the reel delivers — curiosity yes, lies never.

${renderChannelProfile()}

FOR EACH REEL
- headline: the on-screen text that sits ABOVE the video for the whole reel. It frames the story so second one makes sense.
  3-7 words, max 34 characters, punchy, no emojis, no hashtags. Name the person/case when that's the draw. Don't just repeat the hook.
- title: YouTube Shorts title, max 70 characters. Front-load the searchable name or topic, then the curiosity/stakes.
  Specific > vague. Sentence case or Title Case (not ALL CAPS). No fake quotes. At most one emoji, usually none.
- altTitles: 2 alternative titles with a different hook style (question / bold claim / insider verdict).
- description: 3-5 short lines in plain text. Line 1 re-hooks the story. Line 2-3 add the lesson/context in the host's voice
  (first person is fine: "I did 26 years in the feds..." only if consistent with what he says). Last line invites the viewer to the full
  breakdown — the system appends the link. No hashtags inside the description.
- tags: 12-20 lowercase search tags: person/case names with common variations and misspellings, topic phrases people search,
  prison/legal terms, plus "unique mecca audio" and "unique mecca audio nyc".
- hashtags: 3-5, each starting with #, no spaces, include #shorts.
- pinnedComment: one provocative but respectful question that invites people to argue their side.
- summary: one neutral sentence describing the content (internal use).
- entities: canonical names of the real people/cases in the reel (most-searched form). themes: 1-3 short lowercase themes.

Make every reel's headline and title distinct from each other and from the PAST TITLES list.`;

export const PackagingSchema = z.object({
  reels: z.array(
    z.object({
      ref: z.string(),
      headline: z.string(),
      title: z.string(),
      altTitles: z.array(z.string()),
      description: z.string(),
      tags: z.array(z.string()),
      hashtags: z.array(z.string()),
      pinnedComment: z.string(),
      summary: z.string(),
      entities: z.array(z.string()),
      themes: z.array(z.string()),
    }),
  ),
});
export type PackagingResult = z.infer<typeof PackagingSchema>['reels'][number];

export function buildPackagingUser(input: {
  brief: string;
  hookPatterns: string[];
  keywords: string[];
  pastTitles: string[];
  reels: string[];
}): string {
  return [
    `CAMPAIGN BRIEF: "${input.brief}"`,
    input.hookPatterns.length ? `HOOK PATTERNS WORKING NOW:\n${input.hookPatterns.map((h) => `- ${h}`).join('\n')}` : '',
    input.keywords.length ? `SEARCH KEYWORDS: ${input.keywords.join(', ')}` : '',
    `PAST TITLES / HEADLINES (do not reuse): ${input.pastTitles.length ? '\n' + input.pastTitles.map((t) => `- ${t}`).join('\n') : '(none)'}`,
    '',
    '# FINAL REELS',
    ...input.reels,
  ]
    .filter(Boolean)
    .join('\n');
}
