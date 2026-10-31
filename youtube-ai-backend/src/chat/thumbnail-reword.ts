/**
 * "Reword" a finished thumbnail: only the headline changes, the people, scene and layout stay.
 * The headline can be one line or several stacked lines (the client's 3-line thumbnails): lines are
 * joined with " / ", the separator the layout rules already read as "next line".
 */

export const REWORD_MAX_CHARS = 110;
export const REWORD_MAX_WORDS = 18;
export const REWORD_MAX_LINES = 4;

/**
 * The headline the client typed, cleaned for the picture; null when it cannot be used.
 * Accepts the lines as an array (one box per line) or one string with line breaks or " / ".
 */
export function cleanRewordText(raw: string | string[]): { text: string } | { error: string } {
  const pieces = Array.isArray(raw)
    ? raw.flatMap((p) => String(p || '').split('\n'))
    : String(raw || '').split(/\n|\s+\/\s+/);
  const lines = pieces
    .map((p) =>
      p
        .replace(/[<>*_`#]/g, '')
        .replace(/["“”]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase(),
    )
    .filter(Boolean);
  if (!lines.length) return { error: 'Type the new words for the thumbnail.' };
  if (lines.length > REWORD_MAX_LINES)
    return { error: `Use ${REWORD_MAX_LINES} lines or fewer so the words stay big and readable.` };
  const flat = lines.join(' ');
  if (Array.from(flat).length > REWORD_MAX_CHARS)
    return { error: `Keep the thumbnail words under ${REWORD_MAX_CHARS} characters so they stay big and readable.` };
  if (flat.split(' ').length > REWORD_MAX_WORDS)
    return { error: `Use ${REWORD_MAX_WORDS} words or fewer so the thumbnail stays readable on a phone.` };
  return { text: lines.join(' / ') };
}

/** What changes when the client also gives a new photo: that person replaces the main figure. */
const NEW_PHOTO_RULE =
  'Use the attached reference photo as the main person: give the main figure that person\'s face, hair and likeness, ' +
  'keeping the same pose, expression, position, scene and layout. ';

/** The edit instruction: new headline only (and, when asked, the new photo), everything else untouched. */
export function rewordPrompt(params: {
  oldText?: string;
  newText: string;
  zoneRules: string;
  hasNewPhoto?: boolean;
}): string {
  const lines = params.newText.split(/\s+\/\s+/).filter(Boolean);
  const headline =
    lines.length > 1
      ? `The new headline is exactly these ${lines.length} stacked lines, top to bottom, each on its own line: ${lines
          .map((l) => `"${l}"`)
          .join(' then ')}. Spell every word exactly, never shorten, paraphrase or add words, and never draw a slash.\n`
      : ` The new headline is exactly "${params.newText}": spell every word exactly, never shorten, paraphrase or add words.\n`;
  return (
    (params.hasNewPhoto
      ? 'Change the headline lettering on this thumbnail and the main person.'
      : 'Change ONLY the headline lettering on this thumbnail.') +
    (params.oldText ? ` The old headline reads "${params.oldText.replace(/\s+\/\s+/g, ' ')}".` : '') +
    (lines.length > 1 ? ' ' : '') +
    headline +
    (params.hasNewPhoto
      ? NEW_PHOTO_RULE + 'Keep everything else exactly as it is: the scene, background, colors, lighting and composition. '
      : 'Keep everything else exactly as it is: the same people with the same faces and expressions, the same scene, background, ' +
        'colors, lighting and composition. Do not redraw, restyle, move or replace any person or object. ') +
    'Keep the same lettering style (colors, outline, shadow) as the old headline, and remove the old headline completely.\n' +
    params.zoneRules
  );
}

/** The edit instruction for "remove the words": the same picture with no lettering at all. */
export function removeTextPrompt(params: { oldText?: string; zoneRules: string; hasNewPhoto?: boolean }): string {
  return (
    'Remove ALL lettering from this thumbnail: every headline, word, letter, number and caption' +
    (params.oldText ? ` (the old headline reads "${params.oldText.replace(/\s+\/\s+/g, ' ')}")` : '') +
    '. Fill the cleared area with the natural background so it looks as if the picture was made without any text. ' +
    (params.hasNewPhoto
      ? NEW_PHOTO_RULE + 'Keep everything else exactly as it is: the scene, background, colors, lighting and composition. '
      : 'Keep everything else exactly as it is: the same people with the same faces and expressions, the same scene, background, ' +
        'colors, lighting and composition. Do not redraw, restyle, move or replace any person or object. ') +
    'Do not add any new text, number, logo or symbol anywhere.\n' +
    params.zoneRules
  );
}
