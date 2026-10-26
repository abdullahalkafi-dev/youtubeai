import { BULLET_SCRIPT_END, BULLET_SCRIPT_START } from '../openai/prompts/unique-persona';
import { analyzeSpokenScript, closeScriptMarkers } from '../openai/prompts/script-length';
import { isPastedMaterial } from './script-guards';

/**
 * The bullet script that rides along with the full script in ONE assistant message.
 * Everything here is pure (no model calls) so the rules can be tested on their own.
 */

const SCRIPT_END = '<!-- SCRIPT_END -->';

/** Single global switch (single channel: no per-channel setting). */
export function dualScriptEnabled(): boolean {
  return process.env.UMA_DUAL_SCRIPT !== 'false';
}

/** A request that edits something already written starts with an editing verb. */
const REVISION_START =
  /^\s*(?:please\s+|can you\s+|could you\s+)?(?:rewrite|revise|redo|edit|shorten|lengthen|trim|tighten|fix|change|adjust|reformat|format|beautify|polish|add|remove|cut|expand|update|make\s+(?:it|this|that|the|them))\b/i;

/**
 * Decided BEFORE writing: should this request produce two scripts?
 * Only a fresh script request: not an edit of an existing script, not a pasted script.
 */
export function wantsDualScript(params: {
  skill: string | undefined;
  userContent: string;
  enabled?: boolean;
}): boolean {
  const enabled = params.enabled ?? dualScriptEnabled();
  const content = (params.userContent || '').trim();
  return (
    enabled &&
    params.skill === 'script' &&
    content.length > 0 &&
    !isPastedMaterial(content) &&
    !REVISION_START.test(content)
  );
}

/** Decided AFTER writing: is the reply a real full script (not a question or a snippet)? */
export function isFullScript(reply: string, minSpokenWords: number = 250): boolean {
  const closed = closeScriptMarkers(reply || '');
  if (!closed.includes('<!-- SCRIPT_START -->')) return false;
  return analyzeSpokenScript(closed).spokenWords >= minSpokenWords;
}

const DROP_LINE =
  /^\s*(?:sources?\s*:|verification references|https?:\/\/\S+\s*$)|\]\(https?:\/\//i;

/**
 * Pulls the bullet script out of the model's output and checks it is usable.
 * Returns the wrapped block, or null when the output is not a real bullet script.
 */
export function extractBulletBlock(raw: string): string | null {
  if (!raw) return null;
  const s = raw.indexOf(BULLET_SCRIPT_START);
  let body = s === -1 ? raw : raw.slice(s + BULLET_SCRIPT_START.length);
  const e = body.indexOf(BULLET_SCRIPT_END);
  if (e !== -1) body = body.slice(0, e);

  body = body
    .replace(/<!--\s*(?:BULLET_)?SCRIPT_(?:START|END)\s*-->/gi, '')
    .replace(/```[a-z]*\n?/gi, '')
    .split('\n')
    .filter((line) => !DROP_LINE.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const bullets = (body.match(/^\**[A-H]\.\s+\S/gm) || []).length;
  const explanations = (body.match(/^>\s?\S/gm) || []).length;
  const points = (body.match(/^##\s+\S/gm) || []).length;
  if (bullets < 6 || explanations < 12 || points < 3) return null;

  return `${BULLET_SCRIPT_START}\n${body}\n${BULLET_SCRIPT_END}`;
}

/** Puts the bullet block right after the full script's end marker so the two cards sit together. */
export function insertBulletBlock(content: string, block: string): string {
  const closed = closeScriptMarkers(content);
  const end = closed.indexOf(SCRIPT_END);
  if (end === -1) return `${closed.trimEnd()}\n\n${block}\n`;
  const at = end + SCRIPT_END.length;
  return `${closed.slice(0, at)}\n\n${block}${closed.slice(at)}`;
}

/** The note added to the first request so the full script stays in the standard format. */
export const DUAL_FORMAT_NOTE =
  'FORMAT NOTE: this request produces TWO scripts. Write ONLY the full spoken script now, in the standard spoken format (rails and breath blocks), even if the request mentions bullets. The bullet version is generated separately right after this one.';
