import { z } from 'zod';
import { renderChannelProfile } from './channel-profile';

export const DAILY_TOPIC_SYSTEM = `You pick today's automatic reel campaign for this channel. Every night the system makes 4-7 Shorts
from the host's OWN past videos (podcast/talk episodes). Your job: choose the topic most likely to get views TODAY that the
host's archive can actually cover.

${renderChannelProfile()}

Propose 6 candidate topics:
- 3-4 "trend": tied to what is trending now (the TRENDING list and anything current you know is relevant) AND likely covered
  in his archive (people, cases, prison/legal themes he talks about).
- 1-2 "performance": more of what already earned views for his reels (see WHAT PERFORMED).
- 1 "archive": an evergreen topic from his strongest old material that has not been used recently (revisits old content).
Never repeat a topic from RECENT DAILY TOPICS unless there is genuinely new news.

For each: name (short, 3-7 words), brief (one sentence the campaign uses: who/what + the angle, like a creator would type it),
why (one plain sentence for the creator: why this today), keywords (4-10 lowercase search words/names that would appear in
his transcripts: names, nicknames, case words, themes), signal (trend | performance | archive).`;

export const DailyTopicSchema = z.object({
  candidates: z
    .array(
      z.object({
        name: z.string(),
        brief: z.string(),
        why: z.string(),
        keywords: z.array(z.string()),
        signal: z.enum(['trend', 'performance', 'archive']),
      }),
    )
    .min(1)
    .max(8),
});
export type DailyTopicResult = z.infer<typeof DailyTopicSchema>;

export function buildDailyTopicUser(input: {
  date: string;
  trending: Array<{ title: string; summary?: string; score?: number; fit?: number }>;
  performed: Array<{ key: string; views: number; posts: number }>;
  recent: string[];
  bankThemes: Array<{ key: string; n: number }>;
}): string {
  return [
    `TODAY (New York): ${input.date}`,
    '',
    'TRENDING (from the channel trend scan, best first):',
    ...(input.trending.length ? input.trending.map((t) => `- ${t.title}${t.summary ? ` — ${t.summary.slice(0, 160)}` : ''}${t.score ? ` (opportunity ${t.score}${t.fit ? `, fit ${t.fit}` : ''})` : ''}`) : ['- (none available today)']),
    '',
    'WHAT PERFORMED (reel views by topic/person, last 30 days):',
    ...(input.performed.length ? input.performed.map((p) => `- ${p.key}: ${p.views} views over ${p.posts} posts`) : ['- (not enough published data yet)']),
    '',
    'THEMES/PEOPLE MOST PRESENT IN HIS ANALYZED ARCHIVE:',
    ...(input.bankThemes.length ? input.bankThemes.map((b) => `- ${b.key} (${b.n} moments)`) : ['- (archive not analyzed yet)']),
    '',
    'RECENT DAILY TOPICS (avoid repeats):',
    ...(input.recent.length ? input.recent.map((r) => `- ${r}`) : ['- (none)']),
  ].join('\n');
}
