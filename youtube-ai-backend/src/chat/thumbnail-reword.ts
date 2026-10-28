/**
 * "Reword" a finished thumbnail: only the headline changes, the people, scene and layout stay.
 */

export const REWORD_MAX_CHARS = 90;
export const REWORD_MAX_WORDS = 14;

/** The headline the client typed, cleaned for the picture; null when it cannot be used. */
export function cleanRewordText(raw: string): { text: string } | { error: string } {
  const text = String(raw || '')
    .replace(/[<>*_`#]/g, '')
    .replace(/["“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  if (!text) return { error: 'Type the new words for the thumbnail.' };
  if (Array.from(text).length > REWORD_MAX_CHARS)
    return { error: `Keep the thumbnail words under ${REWORD_MAX_CHARS} characters so they stay big and readable.` };
  if (text.split(' ').length > REWORD_MAX_WORDS)
    return { error: `Use ${REWORD_MAX_WORDS} words or fewer so the thumbnail stays readable on a phone.` };
  return { text };
}

/** The edit instruction: new headline only, everything else untouched. */
export function rewordPrompt(params: { oldText?: string; newText: string; zoneRules: string }): string {
  return (
    'Change ONLY the headline lettering on this thumbnail.' +
    (params.oldText ? ` The old headline reads "${params.oldText}".` : '') +
    ` The new headline is exactly "${params.newText}": spell every word exactly, never shorten, paraphrase or add words.\n` +
    'Keep everything else exactly as it is: the same people with the same faces and expressions, the same scene, background, ' +
    'colors, lighting and composition. Do not redraw, restyle, move or replace any person or object. ' +
    'Keep the same lettering style (colors, outline, shadow) as the old headline, and remove the old headline completely.\n' +
    params.zoneRules
  );
}
