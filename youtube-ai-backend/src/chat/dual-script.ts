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
 * Only a fresh script request: not an edit of an existing script.
 *
 * The intent router reads the message (`freshScript`): a new script from an idea, a topic or pasted
 * notes is true, an existing script being rewritten, converted or put in the teleprompter is false,
 * and that answer decides. Only when the router gave none (its call failed) do the plain rules apply:
 * not pasted material and not starting with an editing verb.
 */
export function wantsDualScript(params: {
  skill: string | undefined;
  userContent: string;
  enabled?: boolean;
  freshScript?: boolean;
}): boolean {
  const enabled = params.enabled ?? dualScriptEnabled();
  const content = (params.userContent || '').trim();
  if (!enabled || params.skill !== 'script' || content.length === 0) return false;
  if (typeof params.freshScript === 'boolean') return params.freshScript;
  return !isPastedMaterial(content) && !REVISION_START.test(content);
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

  body = fixSubjectVerbCommas(dropAfterFinalJewel(body));

  const shape = bulletShape(body);
  if (shape.bullets < 6 || shape.railLines < 12 || shape.sections < 3) return null;

  return `${BULLET_SCRIPT_START}\n${body}\n${BULLET_SCRIPT_END}`;
}

/**
 * The card ends with its last JEWEL. The writer sees the whole full script, so it sometimes copies what
 * follows the script (the 10 questions, notes) onto the end: cut everything after the final jewel lines.
 */
export function dropAfterFinalJewel(body: string): string {
  const lines = body.split('\n');
  let jewel = -1;
  lines.forEach((l, i) => {
    if (/^###\s*(?:💎\s*)?\**\s*JEWEL/i.test(l.trim())) jewel = i;
  });
  if (jewel === -1) return body;
  let end = jewel + 1;
  let sawLine = false;
  for (; end < lines.length; end++) {
    const t = lines[end].trim();
    if (/^>\s?\S/.test(t)) sawLine = true;
    else if (t === '' && !sawLine) continue;
    else break;
  }
  return lines.slice(0, end).join('\n').trimEnd();
}

const VERB_START =
  /^(?:doesn't|don't|isn't|aren't|wasn't|won't|can't|couldn't|wouldn't|shouldn't|makes|make|is|was|are|were|does|did|has|have|had|gives|keeps|means|leaves|lets|turns|puts|brings)\b/i;

/**
 * A comma that splits a subject from its verb ("Calling violence a bad argument, / makes the boundary
 * easier to dismiss.") tells him to pause where the thought has not turned yet. When a line that opens
 * with an -ing subject ends in a comma and the next line starts with the verb, the comma is dropped and
 * the line break stays.
 */
export function fixSubjectVerbCommas(body: string): string {
  const lines = body.split('\n');
  for (let i = 0; i + 1 < lines.length; i++) {
    const a = lines[i].match(/^(>\s*(?:\*\*\d*[A-H]\.\*\*\s*)?)(\p{Lu}[\p{L}']*ing\b.*),\s*$/u);
    const b = lines[i + 1].match(/^>\s*(.*)$/);
    if (a && b && VERB_START.test(b[1].trim())) lines[i] = `${a[1]}${a[2]}`;
  }
  return lines.join('\n');
}

/** A bullet label opens a rail line ("> **1A.** ...") or, in the older layout, stands alone ("**A. claim**"). */
const BULLET_LABEL = /^(?:>\s*)?\**\d*[A-H]\.\**\s+\S/;

export interface BulletShape {
  words: number;
  bullets: number;
  sections: number;
  railLines: number;
  /** Share of rail lines (0 to 1) that end with a comma, dash or colon: the thought goes on to the next line. */
  continuedShare: number;
}

/**
 * Counts what the client reads off a bullet card: words, bullets, sections and how many lines hand the
 * thought on to the next one. The caller logs it so a card that drifts back to stop-start lines shows up.
 */
export function bulletShape(body: string): BulletShape {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const rail = lines.filter((l) => /^>\s?\S/.test(l)).map((l) => l.replace(/^>\s*/, '').replace(/\*+/g, ''));
  const spoken = lines.filter((l) => !/^\[.*\]$/.test(l) && !/^#/.test(l) && !/^<!--/.test(l));
  const words = spoken
    .join(' ')
    .replace(/\*+/g, '')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return {
    words,
    bullets: lines.filter((l) => BULLET_LABEL.test(l)).length,
    sections: lines.filter((l) => /^##\s+\S/.test(l)).length,
    railLines: rail.length,
    continuedShare: rail.length ? rail.filter((l) => /[,—–:]$/.test(l.trim())).length / rail.length : 0,
  };
}

/** Puts the bullet block right after the full script's end marker so the two cards sit together. */
export function insertBulletBlock(content: string, block: string): string {
  const closed = closeScriptMarkers(content);
  const end = closed.indexOf(SCRIPT_END);
  if (end === -1) return `${closed.trimEnd()}\n\n${block}\n`;
  const at = end + SCRIPT_END.length;
  return `${closed.slice(0, at)}\n\n${block}${closed.slice(at)}`;
}

/**
 * The note added to the first request so the full script stays in the standard format. A bullet ask
 * once came back as a marker-less half-bullet answer, which also blocked the bullet card, so the
 * note names the markers and says what happens to "bullets".
 */
export const DUAL_FORMAT_NOTE = [
  'FORMAT NOTE: this request produces TWO scripts in one message: the full spoken script now, then the bullet script in the client\'s UMA OUTLAW STORY-FLOW BULLETS format, which the system writes automatically right after.',
  '- Write ONLY the full spoken script now, in the standard spoken format (rails and breath blocks), starting with <!-- SCRIPT_START --> and ending with <!-- SCRIPT_END -->. This holds EVEN IF the user asked for "bullets", "Outlaw bullets" or "bullet form": his bullets come as the second script, so never answer with bullets here and never explain this to him.',
  '- Nothing before <!-- SCRIPT_START --> except at most one short line. No "Research check", "Fact check" or legal-status paragraph on top: if a fact needs a note, put ONE short "Fact-check (not spoken):" line after <!-- SCRIPT_END -->.',
].join('\n');
