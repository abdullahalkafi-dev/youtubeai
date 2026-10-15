import { z } from 'zod';
import { renderChannelProfile } from './channel-profile';

export const RESEARCH_VERSION = 'research-v1';

export const WEB_RESEARCH_SYSTEM = `You are a short-form video researcher for a YouTube channel. You use live web search.
Your job: find out what is happening right now around a topic and what short-form content about it is actually getting views,
so an editor can cut the host's own long-form videos into reels that ride that demand.

${renderChannelProfile()}

Research checklist (search the web; be concrete, cite what you find):
1. Current facts: latest developments, dates, court dates, sentences, statements. Mark anything unconfirmed as "alleged/reported".
2. What is getting views: the highest-viewed YouTube videos, Shorts, TikToks or Instagram reels on this topic in the last ~12 months —
   their titles, approximate view counts when visible, and WHY they worked (the hook, the question, the emotion).
3. Hook language that works for this topic: exact phrasings, questions and claims that recur in high-performing titles/captions.
4. What the audience argues about: the debates, questions and takes in comments and discussions.
5. Angles where THIS host has unfair authority (prison, federal system, street code, psychology) versus generic news angles.
6. Names and spellings: every important person's most-searched name and aliases.
7. Sensitivities: legal risks, victims, anything that must be framed carefully.

Write a dense, well-organized research memo (plain text, bullet points). No fluff.`;

export function buildWebResearchUser(brief: string): string {
  return `CAMPAIGN BRIEF FROM THE CLIENT:\n"${brief}"\n\nResearch this now and write the memo.`;
}

export const ResearchSchema = z.object({
  topicSummary: z.string().describe('3-5 sentences: the topic, what is happening now, why people care.'),
  primaryEntities: z
    .array(
      z.object({
        name: z.string().describe('Most-searched canonical name, e.g. "Diddy".'),
        aliases: z.array(z.string()).describe('Other names/spellings, e.g. ["Sean Combs", "Puff Daddy"].'),
      }),
    )
    .describe('People, cases or places central to the brief. Empty if the brief is a general theme.'),
  angles: z
    .array(z.object({ angle: z.string(), whyItWorks: z.string() }))
    .describe('4-8 reel angles where the host has authority, best first.'),
  hookPatterns: z.array(z.string()).describe('5-10 hook phrasings / title formulas proven on this topic.'),
  externalExamples: z
    .array(
      z.object({
        title: z.string(),
        platform: z.string(),
        views: z.string().nullable().describe('Approximate views if known, e.g. "2.1M".'),
        whatWorked: z.string(),
      }),
    )
    .describe('Up to 8 high-performing external examples. Research signal only.'),
  audienceQuestions: z.array(z.string()).describe('4-8 questions/debates the audience is having.'),
  catalogKeywords: z
    .array(z.string())
    .describe('10-25 lowercase words/short phrases likely to appear in the HOST\'S OWN video titles or speech about this topic (names, aliases, places, prison/legal terms). Used to search his catalog.'),
  avoid: z.array(z.string()).describe('Framings or claims to avoid (legal risk, stale news, overdone angles).'),
});
export type ResearchResult = z.infer<typeof ResearchSchema>;

export const RESEARCH_SYNTH_SYSTEM = `You turn a raw research memo into a structured brief for a reel editing team.
${renderChannelProfile()}

Rules:
- Keep only what helps pick and package reels from the host's OWN existing long-form videos.
- Angles must fit the host's authority (lived prison experience, street code, federal system, criminal psychology).
- catalogKeywords must be words he would actually say or put in titles — include names, aliases, nicknames, case terms, prison terms.
- Never invent view counts; use null when unknown.`;

export function buildResearchSynthUser(brief: string, memo: string, channelTopTitles: string[]): string {
  return [
    `CAMPAIGN BRIEF: "${brief}"`,
    '',
    'RESEARCH MEMO:',
    memo || '(web research unavailable — rely on the brief and channel titles)',
    '',
    "THE HOST'S MOST-VIEWED VIDEO TITLES (shows what his audience responds to):",
    ...channelTopTitles.map((t) => `- ${t}`),
  ].join('\n');
}
