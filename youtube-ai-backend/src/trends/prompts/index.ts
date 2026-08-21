/**
 * Trends Prompt Templates — v1
 *
 * Centralized prompt builders for the trends feature.
 * Static system prompts are internal to trends.prompts.ts (cache-friendly).
 * Only builder functions are exported for external use.
 */

export {
  buildTrendsSearchPrompt,
  buildEntityExtractionPrompt,
} from './trends.prompts';
