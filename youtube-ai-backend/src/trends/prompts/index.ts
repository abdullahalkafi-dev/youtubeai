/**
 * Trends Prompt Templates — v1
 *
 * Centralized prompt builders for the trends feature.
 * Follows the same pattern as src/openai/prompts/:
 *   - Static system prompt constant (cache-friendly)
 *   - Dynamic builder function (takes params, returns system + user)
 *   - Version constant for rollback and comparison
 *
 * Files:
 *   trends.prompts.ts — News discovery + entity extraction prompts
 */

export {
  TRENDS_SEARCH_SYSTEM_PROMPT,
  TRENDS_ENTITY_EXTRACTION_SYSTEM_PROMPT,
  buildTrendsSearchPrompt,
  buildEntityExtractionPrompt,
  TRENDS_PROMPT_VERSION,
} from './trends.prompts';
