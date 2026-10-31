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
  /** False when nothing in the chat holds a full script: there is nothing to "edit", so a bullets ask is a new story. */
  earlierHasScript?: boolean;
}): boolean {
  const enabled = params.enabled ?? dualScriptEnabled();
  const content = (params.userContent || '').trim();
  if (!enabled || params.skill !== 'script' || content.length === 0) return false;
  if (typeof params.freshScript === 'boolean') {
    if (!params.freshScript && params.earlierHasScript === false && BULLET_WORD.test(content)) return true;
    return params.freshScript;
  }
  return !isPastedMaterial(content) && !REVISION_START.test(content);
}

const SCRIPT_START = '<!-- SCRIPT_START -->';
const ACTIVE_SCRIPT_PREFIX = /^\[ACTIVE SCRIPT CONTEXT:[\s\S]*?\[USER REQUEST\]\s*/i;

type ThreadMessage = { role: string; content?: string };

/**
 * The client rejected the script just written as a whole ("this is whack, it's not Unique Mecca
 * Audio") and the router flagged it (`redoScript`). It only counts when a script was written earlier
 * in this chat: there has to be something to redo.
 */
export function isScriptRedo(redoScript: boolean | undefined, earlier: ThreadMessage[] = []): boolean {
  return redoScript === true && earlier.some((m) => m.role === 'assistant' && (m.content || '').includes(SCRIPT_START));
}

/** The request that produced the latest script in this chat (the user message just before it), or ''. */
export function originalScriptRequest(messages: ThreadMessage[] = []): string {
  let script = -1;
  messages.forEach((m, i) => {
    if (m.role === 'assistant' && (m.content || '').includes(SCRIPT_START)) script = i;
  });
  for (let i = script - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return (messages[i].content || '').replace(ACTIVE_SCRIPT_PREFIX, '').trim();
  }
  return '';
}

/**
 * What the writer is told when the client rejects a script: write it again, now, on the same story,
 * with no new research and no speech about what went wrong. His own words come along so what he named
 * (an off-topic memory, a corny line) is what gets fixed.
 */
export function buildRedoNote(complaint: string): string {
  return [
    'REDO NOTE: the client just rejected the script written earlier in this chat. His words:',
    `"${(complaint || '').trim().slice(0, 700)}"`,
    '- Write a NEW full script now, from scratch, on the SAME story with the SAME verified facts already in this chat (the earlier script and its fact-check line). No new research, no questions back.',
    '- Fix exactly what he named: anything he says does not belong is OUT of the new script, and every point stays on the story he asked for. Write it in his own voice, in plain speech, not as a commentator.',
    '- No apology and no explanation of what went wrong. At most one short line before <!-- SCRIPT_START -->, then the script.',
  ].join('\n');
}

/** "in bullets", "bullet form", "Outlaw bullets": the client's name for his bullet script. */
const BULLET_WORD = /\b(?:outlaw\s+)?bullets?\b/i;

/** The newest assistant message in the chat that holds a real full script, or null. */
export function latestScriptReply(messages: ThreadMessage[] = []): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant' && isFullScript(m.content || '')) return m.content || '';
  }
  return null;
}

/**
 * "okay write this up in bullets now" on a chat that already has a script: he wants the bullet card of
 * THAT script. It is not a new story and not an edit, so the card is written straight from the script
 * above: no new full script, no web search, no book search (about 30 s instead of 2-3 minutes).
 * Only when the router said it is not a fresh script; a new story "in bullets" still gets both cards.
 */
export function wantsBulletsOnly(params: {
  skill: string | undefined;
  userContent: string;
  freshScript?: boolean;
  redoScript?: boolean;
  earlier?: ThreadMessage[];
  enabled?: boolean;
}): boolean {
  const enabled = params.enabled ?? dualScriptEnabled();
  const content = (params.userContent || '').trim();
  if (!enabled || params.skill !== 'script' || content.length === 0 || params.redoScript) return false;
  if (params.freshScript !== false) return false;
  if (!BULLET_WORD.test(content) || isPastedMaterial(content)) return false;
  return latestScriptReply(params.earlier) !== null;
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
