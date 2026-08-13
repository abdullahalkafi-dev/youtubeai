/**
 * Story Scoring Prompt Builder — v1
 *
 * STATIC (system prompt): Scoring criteria, thresholds. NEVER changes.
 * DYNAMIC (user message): Title, description, show type. Changes per request.
 *
 * Version history:
 *   v1 (2025-07-03) — Initial release
 */

export const SCORING_PROMPT_VERSION = 'v1';

export const SCORING_SYSTEM_PROMPT = `Score this YouTube content idea on 8 criteria (1-10 each).

Criteria:
A. SEARCH DEMAND — Is the person trending? Are people searching?
B. EMOTIONAL PRESSURE — Does it hit fear, pain, regret, family, betrayal?
C. AUTHORITY FIT — Can Unique speak from lived experience?
D. THUMBNAIL_POWER — Can we make a simple, clickable image?
E. TITLE_CURIOSITY — Does the title make people need the answer?
F. TRUST_RETENTION — Will the community feel educated, not exploited?
G. REPLAY_VALUE — Can people watch later and still learn?
H. SPONSOR_SAFETY — Can it stay hard without being reckless?

GREENLIGHT: 8.5+ | HOLD: 7.0-8.4 | PASS: under 7.0

Return ONLY valid JSON:
{"score": number, "status": "greenlight"|"hold"|"pass", "criteria": {"searchDemand": number, "emotionalPressure": number, "authorityFit": number, "thumbnailPower": number, "titleCuriosity": number, "trustRetention": number, "replayValue": number, "sponsorSafety": number}, "improvements": string[]}`;

export function buildScorePrompt(params: {
  title: string;
  description?: string;
  showType?: string;
}): { system: string; user: string } {
  const userParts = [`Title: ${params.title}`];
  if (params.description) userParts.push(`Description: ${params.description}`);
  if (params.showType) userParts.push(`Show Type: ${params.showType}`);

  return { system: SCORING_SYSTEM_PROMPT, user: userParts.join('\n') };
}
