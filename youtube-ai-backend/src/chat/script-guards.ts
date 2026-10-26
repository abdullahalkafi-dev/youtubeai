/**
 * Small, pure routing guards for the script skills.
 *
 * A pasted script is raw material, not a question about channel performance. Words such as
 * "retention", "views" or "the video" appear inside scripts all the time, so the performance
 * detectors (autopsy / diagnosis) must never turn a script request into a video autopsy.
 */

/** Skills whose system prompt must never be replaced by an analysis prompt. */
const SCRIPT_SKILLS = new Set(['script', 'outline']);

/** Beyond this length a message is pasted material (a script, an article), not a short ask. */
export const PASTED_MATERIAL_MIN_CHARS = 1200;

export function isScriptSkill(skill: string | undefined): boolean {
  return !!skill && SCRIPT_SKILLS.has(skill);
}

export function isPastedMaterial(content: string | undefined): boolean {
  return (content || '').length >= PASTED_MATERIAL_MIN_CHARS;
}

/**
 * True when the performance lookup (which can pick an unrelated video from words inside the
 * pasted text) should be skipped entirely: a script skill carrying pasted material.
 */
export function shouldSkipPerformanceLookup(
  skill: string | undefined,
  content: string | undefined,
): boolean {
  return isScriptSkill(skill) && isPastedMaterial(content);
}

/** True when an analysis prompt (autopsy / diagnosis / public) may replace the skill prompt. */
export function mayReplaceSystemPrompt(skill: string | undefined): boolean {
  return skill !== 'package' && !isScriptSkill(skill);
}
