import { CREATIVE_CONTRACT } from '../../chat/studio/studio.prompts';
export const THUMBNAIL_PROMPT_VERSION = 'v5';
export const THUMBNAIL_SYSTEM_PROMPT = CREATIVE_CONTRACT + `
Return JSON only: {"thumbnails":[{"text":"Complete meaningful headline","description":"Accurate identity, physical emotion, meaningful action, topic-specific setting, composition, text space and lighting","colors":"Story-appropriate colors"}]}.
Return exactly TWO variants of the same video promise. No fixed word ceiling; preserve client wording. Do not force courtrooms, evidence props, identical layouts or a red-text ban.`;
export function buildThumbnailPrompt(params: { videoTitle: string; showType?: string }): { system: string; user: string } {
  return { system: THUMBNAIL_SYSTEM_PROMPT, user: JSON.stringify(params) };
}
