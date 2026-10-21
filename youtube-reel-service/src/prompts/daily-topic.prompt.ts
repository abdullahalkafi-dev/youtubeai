import { z } from 'zod';
import { renderChannelProfile } from './channel-profile';

export const DAILY_TOPIC_SYSTEM = `You propose today's automatic reel topics for this channel. Every night the system makes 5-7 Shorts from the host's OWN
past videos (podcast/talk episodes), and your candidates are then scored by code, so give honest, concrete options rather than one safe pick.

${renderChannelProfile()}

Propose 8 candidate topics:
- 4 "trend": tied to what is trending now (the TRENDING list: each line shows how old the scan is) AND likely covered in his archive.
  Use the person's name or case in the candidate so the match with the trend is clear.
- 1-2 "performance": more of what his own channel is getting watched for right now (see OWN CHANNEL TRAFFIC) or what his reels earned.
- 2 "explore": a pillar that has NOT been covered lately (see PILLARS: days since covered) with an angle his audience would plausibly care about,
  even if nothing is trending about it. These are how the system learns what else works, so pick different pillars and different people.
- 1 "archive": an evergreen topic from his strongest old material that has not been used recently.
Never repeat a topic from RECENT DAILY TOPICS unless there is genuinely new news. Do not propose the same person for more than 3 candidates.

For each: name (short, 3-7 words), brief (one sentence the campaign uses: who/what + the angle, like a creator would type it),
why (one plain sentence for the creator: why this today), keywords (4-10 lowercase search words/names that would appear in his transcripts:
names, nicknames, case words, themes), signal (trend | performance | explore | archive), pillar (exactly one pillar key from PILLARS),
entity (the main person or case this topic is about, lowercase, or null when it is a general lesson; never the channel or its host).`;

export const DailyTopicSchema = z.object({
  candidates: z
    .array(
      z.object({
        name: z.string(),
        brief: z.string(),
        why: z.string(),
        keywords: z.array(z.string()),
        signal: z.enum(['trend', 'performance', 'archive', 'explore']),
        pillar: z.string(),
        entity: z.string().nullable(),
      }),
    )
    .min(1)
    .max(10),
});
export type DailyTopicResult = z.infer<typeof DailyTopicSchema>;

export function buildDailyTopicUser(input: {
  date: string;
  trending: Array<{ title: string; summary?: string; score?: number | null; ageHours: number }>;
  trendNote: string | null;
  own: Array<{ key: string; share: number }>;
  performed: Array<{ key: string; views: number; posts: number }>;
  pillars: Array<{ key: string; name: string; description: string; daysSinceCovered: number | null; lift: number }>;
  /** Findings of the latest weekly review that have enough posts behind them. */
  learned?: string[];
  recent: string[];
  bankThemes: Array<{ key: string; n: number }>;
}): string {
  return [
    `TODAY (New York): ${input.date}`,
    '',
    'PILLARS (use these keys; days since one of our reels covered it, lift = how the pillar performs, 1 = average):',
    ...input.pillars.map((p) => `- ${p.key}: ${p.name}. ${p.description} [${p.daysSinceCovered === null ? 'never covered' : `${p.daysSinceCovered} days ago`}, lift ${p.lift.toFixed(2)}]`),
    '',
    `TRENDING (usable scans only, best first)${input.trendNote ? ` — NOTE: ${input.trendNote}` : ''}:`,
    ...(input.trending.length ? input.trending.map((t) => `- ${t.title}${t.summary ? ` — ${t.summary.slice(0, 160)}` : ''} (scan ${t.ageHours}h old${t.score ? `, opportunity ${t.score}` : ''})`) : ['- (nothing fresh available today)']),
    '',
    'OWN CHANNEL TRAFFIC (share of the channel\'s views over the last 3 days, by person/case):',
    ...(input.own.length ? input.own.map((o) => `- ${o.key}: ${Math.round(o.share * 100)}%`) : ['- (not available)']),
    '',
    ...(input.learned?.length ? ['WHAT THE WEEKLY REVIEW LEARNED (only claims with enough posts; weigh them, do not copy them blindly):', ...input.learned.map((l) => `- ${l}`), ''] : []),
    'WHAT OUR REELS EARNED (last 30 days):',
    ...(input.performed.length ? input.performed.map((p) => `- ${p.key}: ${p.views} views over ${p.posts} posts`) : ['- (not enough published data yet)']),
    '',
    'THEMES/PEOPLE MOST PRESENT IN HIS ANALYZED ARCHIVE:',
    ...(input.bankThemes.length ? input.bankThemes.map((b) => `- ${b.key} (${b.n} moments)`) : ['- (archive not analyzed yet)']),
    '',
    'RECENT DAILY TOPICS (avoid repeats):',
    ...(input.recent.length ? input.recent.map((r) => `- ${r}`) : ['- (none)']),
  ].join('\n');
}
