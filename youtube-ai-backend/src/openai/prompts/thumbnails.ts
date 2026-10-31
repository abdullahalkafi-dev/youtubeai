import { CREATIVE_CONTRACT } from '../../chat/studio/studio.prompts';
export const THUMBNAIL_PROMPT_VERSION = 'v6';
export const THUMBNAIL_SYSTEM_PROMPT = CREATIVE_CONTRACT + `
Return JSON only: {"thumbnails":[{"text":"Complete meaningful headline","description":"Accurate identity, physical emotion, meaningful action, topic-specific setting, composition, text space and lighting","colors":"Story-appropriate colors"}]}.
Return exactly TWO variants of the same video promise: variant 1 is the safe clean version with the complete meaningful headline; variant 2 is the BOLD high-CTR version where YOU direct an extreme readable expression and pose in words (the image tool recreates the person's face with it) and three-line curiosity text WHO / THE SETUP / THE OPEN QUESTION (never the outcome) with " / " between lines, about 9-14 words (never classroom or label wording), using an arrow, split screen or story object only when the story genuinely calls for it. Preserve exact client wording. Do not force courtrooms, evidence props, identical layouts or a red-text ban.`;
export function buildThumbnailPrompt(params: { videoTitle: string; showType?: string }): { system: string; user: string } {
  return { system: THUMBNAIL_SYSTEM_PROMPT, user: JSON.stringify(params) };
}
