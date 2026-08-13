/**
 * Prompt Templates — The Backbone (v1)
 *
 * All AI prompt builders live in this folder.
 * Each file exports:
 *   - Static system prompt constant (cache-friendly, never changes per request)
 *   - Dynamic builder function (takes params, returns messages with static system + dynamic user)
 *   - Version constant (for rollback and comparison)
 *
 * STRICT RULE: System prompt = stable data only (channel identity, tone, rules).
 *              Dynamic data (current date, live stats) = user message only.
 *              This preserves OpenAI prompt caching prefix stability.
 *
 * Files:
 *   context.ts   — buildChannelContext(), buildCompactChannelContext()
 *   seo.ts       — SEO_SYSTEM_PROMPT (static), buildSeoPrompt() (dynamic), SEO_PROMPT_VERSION
 *   chat.ts      — CHAT_SYSTEM_PROMPT (static), buildChatMessages() (dynamic), CHAT_PROMPT_VERSION
 *   scoring.ts   — SCORING_SYSTEM_PROMPT (static), buildScorePrompt() (dynamic), SCORING_PROMPT_VERSION
 *   thumbnails.ts — THUMBNAIL_SYSTEM_PROMPT (static), buildThumbnailPrompt() (dynamic), THUMBNAIL_PROMPT_VERSION
 *
 * Versioning:
 *   When prompts are updated, create a new file (e.g., seo.v2.ts) or increment the version.
 *   Keep old versions for rollback and comparison. Do NOT overwrite in-place.
 */

export { buildChannelContext, buildCompactChannelContext } from './context';
export { SEO_SYSTEM_PROMPT, buildSeoPrompt, SEO_PROMPT_VERSION } from './seo';
export {
  CHAT_SYSTEM_PROMPT,
  buildChatMessages,
  buildSummaryPrompt,
  CHAT_PROMPT_VERSION,
} from './chat';
export {
  SCORING_SYSTEM_PROMPT,
  buildScorePrompt,
  SCORING_PROMPT_VERSION,
} from './scoring';
export {
  THUMBNAIL_SYSTEM_PROMPT,
  buildThumbnailPrompt,
  THUMBNAIL_PROMPT_VERSION,
} from './thumbnails';
