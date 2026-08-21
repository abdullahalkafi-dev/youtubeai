/**
 * Trends Prompt Builders — v1
 *
 * STATIC (system prompts): Channel identity, niche context, output rules.
 *              NEVER changes per request. Cache-friendly prefix.
 * DYNAMIC (user messages): Channel stats, dates, topic titles/summaries.
 *              Changes per request. Goes in user message only.
 *
 * Version history:
 *   v1 (2025-07-06) — Initial release: news discovery + entity extraction
 */

export const TRENDS_PROMPT_VERSION = 'v1';

// ─── Channel Identity (shared across both prompts) ───────────────────────────

const NICHE_IDENTITY = `You are a trend researcher for the YouTube channel "Unique Mecca Audio" (@uniquemeccaaudionyc).

The channel is run by Unique Mecca Audio — a 62-year-old former federal prisoner who spent 26 years inside (1993-2020). He is a criminal psychology professor who breaks down the mindset of criminals in trending stories using his firsthand lived experience.

His niche: criminal psychology, federal cases, prison stories, sentencing, street code, courtroom drama, indictment breakdowns, prisoner psychology.
His audience: Global YouTube viewers interested in true crime analysis and criminal psychology.
His mission: Prevention. Accountability. Growth. "The streets are real, but prison is realer."
His voice: Dark, direct, street-wise, professorial. Never glorifies prison or crime.`;

// ─── Step 1: News Discovery Prompt ───────────────────────────────────────────

/**
 * Static system prompt for the web_search step.
 * Contains channel identity + search scope + output format.
 * Never changes per request — stable prefix for caching.
 */
export const TRENDS_SEARCH_SYSTEM_PROMPT = `${NICHE_IDENTITY}

Focus your search on trending criminal cases, federal indictments, rapper legal cases, sentencing news, prison stories, and courtroom drama that would fit this channel's audience.

OUTPUT FORMAT:
Return a JSON array with EXACTLY this structure — nothing else:
[
  {
    "title": "Short headline (max 80 chars)",
    "summary": "2-3 sentence summary of the story and why it matters",
    "source": "Source URL if available, otherwise null",
    "publishedAt": "ISO 8601 date string (e.g. 2025-07-01T00:00:00Z) of when the article was published, or null if unknown"
  }
]

IMPORTANT RULES:
- SOURCE DIVERSITY: Do NOT return more than 2 articles from justice.gov or any single domain. Actively include diverse mainstream news outlets (e.g., CBS News, NBC News, AP News, Law & Crime, Billboard, Rolling Stone, HipHopDX, etc.).
- Do NOT write scripts, outlines, time stamps, or show segments.
- Do NOT score the ideas or suggest show types.
- Do NOT add thumbnail ideas, title suggestions, or video angles.
- Do NOT add any text before or after the JSON array.
- Return ONLY the raw JSON array. No markdown, no code blocks, no explanations.`;

/**
 * Build the full prompt for the news discovery step (Phase A).
 * System prompt is ALWAYS the same string (cache-friendly).
 * Dynamic data (channel stats, dates) goes in the user message.
 */
export function buildTrendsSearchPrompt(params: {
  channelContext: string;
  today: string;
  twentyOneDaysAgoStr: string;
}): { system: string; user: string } {
  const userParts: string[] = [];

  if (params.channelContext) {
    userParts.push(params.channelContext);
    userParts.push('');
  }

  userParts.push(`Today's date is ${params.today}.`);
  userParts.push('');
  userParts.push(
    `What are up to 10 trending topics in criminal psychology, federal cases, prison stories, and sentencing news from the last 21 days (since ${params.twentyOneDaysAgoStr})? Search the web for current, real-time news.`,
  );
  userParts.push('');
  userParts.push(
    `IMPORTANT: You MUST use web search to find real-time, breaking updates. Prioritize stories from the LAST 48 HOURS to 7 DAYS — these must appear FIRST. Strictly ignore stale or outdated historical events unless there is breaking news, a fresh indictment, recent sentencing, or significant new developments within the search window. Ensure accurate publishedAt ISO dates and order results by recency — newest first.`,
  );

  return { system: TRENDS_SEARCH_SYSTEM_PROMPT, user: userParts.join('\n') };
}

// ─── Step 2: Entity Extraction Prompt ────────────────────────────────────────

/**
 * Static system prompt for entity extraction.
 * Takes a trending story title + summary and extracts the specific search phrase
 * to find YouTube videos covering that exact story.
 */
export const TRENDS_ENTITY_EXTRACTION_SYSTEM_PROMPT = `You are an entity extraction agent. Given a news story's title and summary, extract the specific entity, case name, or person name that would be the best YouTube search query to find videos covering THIS exact story.

RULES:
- Extract the most specific, searchable phrase (person name + case type, or unique case identifier).
- Prefer proper nouns (names, case names, locations) over generic terms.
- If the story is about a specific person, return their name (and case type if relevant).
- If the story is about a legal case, return the case name or key identifier.
- Keep it concise — 3 to 8 words maximum.
- Do NOT include generic words like "case", "story", "news", "update", "latest" unless they are part of a proper case name.
- Do NOT include the word "YouTube" or "video" in the extracted entity.
- Return ONLY the extracted entity string. No quotes, no explanation, no JSON, no extra text.`;

/**
 * Build the prompt for entity extraction (Phase B, per-topic).
 * System prompt is ALWAYS the same string (cache-friendly).
 * Topic title and summary go in the user message.
 */
export function buildEntityExtractionPrompt(params: {
  title: string;
  summary: string;
}): { system: string; user: string } {
  const userParts: string[] = [];

  userParts.push(`Story Title: ${params.title}`);
  userParts.push('');
  userParts.push(`Story Summary: ${params.summary}`);
  userParts.push('');
  userParts.push(
    'Extract the specific entity or case name to search for on YouTube:',
  );

  return {
    system: TRENDS_ENTITY_EXTRACTION_SYSTEM_PROMPT,
    user: userParts.join('\n'),
  };
}
