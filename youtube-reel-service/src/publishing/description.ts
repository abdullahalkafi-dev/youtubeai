/**
 * Shorts description and first-comment text. Pure functions (no database, no clock).
 *
 * Client decision (2026-10-28): the reel says "full video, check description", so the description opens with the full video's
 * title and link. YouTube does not make links in Shorts descriptions tappable, so the title is what lets a viewer find the video.
 */

const LEAD = /^🎥 (?:FULL VIDEO[^\n]*|Full video on the channel\.)\s*\n+/u;
/** The old layout put the link on the last line. */
const LEGACY_TAIL = /\n\n(?:Full video on the channel\.|Full breakdown: \S+)\s*$/;

/** First line of the description: the full video's title and link (the link is missing for an upload not yet linked to YouTube). */
export function fullVideoLine(title: string | null | undefined, link: string | null): string {
  const clean = String(title ?? '')
    .replace(/["“”<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!link) return '🎥 Full video on the channel.';
  return `🎥 FULL VIDEO${clean ? `: "${clean}"` : ''} → ${link}`;
}

/** Puts the full-video line first, replacing whichever version of it (or the old last-line link) the description already has. */
export function withFullVideoLine(description: string, line: string): string {
  const body = String(description ?? '')
    .replace(LEAD, '')
    .replace(LEGACY_TAIL, '')
    .trim();
  return body ? `${line}\n\n${body}` : line;
}

export const COMMENT_MAX_CHARS = 500;

/** The channel's first comment on a reel: the question that gets people arguing, plus where the full video is. Null when there is no question. */
export function buildEngagementComment(question: string | null | undefined): string | null {
  const q = String(question ?? '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, COMMENT_MAX_CHARS - 60);
  if (!q) return null;
  return `${q}\n\nFull video is in the description.`;
}
