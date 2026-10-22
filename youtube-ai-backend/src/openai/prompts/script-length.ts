/**
 * Script length + shape contract for the legacy chat / Script Writer path.
 *
 * The client reads these scripts on camera. The format they like is 7-9 minutes: short
 * breathable lines, 4-6 line blocks, 5-6 clean sections, a 3-line jewel, and nothing
 * else in the spoken text. Any duration the user asks for wins; the word budget scales with it.
 */

export const SCRIPT_WORDS_PER_MINUTE = 130;
export const DEFAULT_SCRIPT_MINUTES = { min: 7, max: 9 } as const;
/** A line longer than this cannot be said in one breath. */
export const SCRIPT_MAX_LINE_WORDS = 8;

/** Spoken-word budget for a duration range (cues, headers and sources are not counted). */
export function scriptWordBudget(
  minMinutes: number = DEFAULT_SCRIPT_MINUTES.min,
  maxMinutes: number = minMinutes,
): { min: number; target: number; max: number } {
  const lo = Math.min(minMinutes, maxMinutes);
  const hi = Math.max(minMinutes, maxMinutes);
  return {
    min: Math.round(lo * SCRIPT_WORDS_PER_MINUTE * 0.9),
    target: Math.round(((lo + hi) / 2) * SCRIPT_WORDS_PER_MINUTE),
    max: Math.round(hi * SCRIPT_WORDS_PER_MINUTE),
  };
}

const DEFAULT_BUDGET = scriptWordBudget(DEFAULT_SCRIPT_MINUTES.min, DEFAULT_SCRIPT_MINUTES.max);

export const SCRIPT_LENGTH_CONTRACT = `SCRIPT LENGTH & CLEAN STRUCTURE (CRITICAL — THE CLIENT READS THIS ON CAMERA):
- DEFAULT LENGTH: ${DEFAULT_SCRIPT_MINUTES.min}-${DEFAULT_SCRIPT_MINUTES.max} minutes, about ${Math.round(DEFAULT_BUDGET.min / 50) * 50}-${Math.round(DEFAULT_BUDGET.max / 50) * 50} spoken words. If the user names a duration or range ("15 minutes", "5 to 6 min"), that wins: scale everything to it.
- WORD BUDGET: ${SCRIPT_WORDS_PER_MINUTE} spoken words per minute. Count only spoken lines (not cues, headers, sources). Examples: 5 min = 650, 8 min = 1,040, 12 min = 1,560, 15 min = 1,950. Never exceed the budget by more than 10%. A script that runs long is a failed script; land slightly under.
- SECTIONS: the default length uses 5-6 sections of about 150-200 spoken words each. A longer video adds sections (about one per 1.5-2 minutes); sections do not get longer.
- LINES: 3-7 words per line, never more than ${SCRIPT_MAX_LINE_WORDS}. One idea per line. End a long thought on a new line instead of chaining clauses with commas or "and".
- BLOCKS: 4-6 short lines per breath block, then a cue ([BEAT] or [PAUSE]) on its own line.
- JEWEL: 3 short lines (Principle, Consequence, Direct Question ending in '?'), then [PAUSE].
- CLEAN SPOKEN TEXT ONLY: numbered section header, breath blocks, cues, jewel. NOTHING else inside the script. No "ON-SCREEN LEGAL STATUS" header. No sub-labels such as "A. REPORTED FACTS" or "B. UNIQUE'S ANALYSIS". No "CURIOSITY RESET" or "APPROXIMATELY 1:30" markers. No "Verification references" or source/link lines. State the legal status in one spoken line instead, and keep facts vs. Unique's analysis clear through the wording itself.`;

// ---------------------------------------------------------------------------
// Analysis + sanitizing (deterministic, no model calls)
// ---------------------------------------------------------------------------

const CUE_LINE = /^\[(BEAT|PAUSE)\]$/i;
const STRUCTURAL_LINE = /^(<!--|#{1,6}\s|={2,}.*={2,}$)/;
const SUB_LABEL_LINE = /^\**[A-H]\.\s+[A-Z0-9'’&,.:—–\- ]{3,}\**:?$/;
const LEAKED_REFERENCE_LINE = /verification references|not spoken\.?\*?\s*(\(|$)/i;
const BANNED_MARKERS: Array<{ name: string; test: RegExp }> = [
  { name: 'ON-SCREEN LEGAL STATUS', test: /ON-SCREEN LEGAL STATUS/i },
  { name: 'CURIOSITY RESET', test: /CURIOSITY RESET/i },
  { name: 'sub-label', test: SUB_LABEL_LINE },
  { name: 'verification references', test: LEAKED_REFERENCE_LINE },
];

/** H1/H2 headings that start the NON-script part of a reply (footage, sources, notes, packaging). */
const NON_SCRIPT_HEADING = /^#{1,2}\s+(?!\**\s*\d+[.)])(?!.*SCRIPT TITLE).*(?:footage|sources?|verified|references?|production|notes?|how to use|thumbnails?|seo|description|tags|🎬|📺|🔗)/i;

/**
 * Where the spoken script ends: the SCRIPT_END marker, or, when the model forgot it, the first
 * heading that clearly starts another part of the reply. -1 means "to the end of the text".
 */
function scriptEndIndex(content: string, start: number): number {
  const end = content.indexOf('<!-- SCRIPT_END -->', start);
  if (end !== -1) return end;
  let offset = 0;
  for (const raw of content.slice(start).split('\n')) {
    if (offset > 0 && NON_SCRIPT_HEADING.test(raw.trim())) return start + offset;
    offset += raw.length + 1;
  }
  return -1;
}

/** The spoken script only: between SCRIPT_START and its end, otherwise the whole text. */
function scriptScope(content: string): string {
  const start = content.indexOf('<!-- SCRIPT_START -->');
  if (start === -1) return content;
  const end = scriptEndIndex(content, start);
  return content.slice(start, end === -1 ? undefined : end);
}

/** Adds the missing SCRIPT_END marker so footage, sources and notes never end up inside the script. */
export function closeScriptMarkers(content: string): string {
  const start = content.indexOf('<!-- SCRIPT_START -->');
  if (start === -1 || content.indexOf('<!-- SCRIPT_END -->', start) !== -1) return content;
  const end = scriptEndIndex(content, start);
  if (end === -1) return content.trimEnd() + '\n<!-- SCRIPT_END -->\n';
  return content.slice(0, end).trimEnd() + '\n<!-- SCRIPT_END -->\n\n' + content.slice(end);
}

const CONJUNCTION_BREAK = /\s+(?=(?:and|but|because|so|that|which|then|or|until|while|when|if|before|after)\s)/i;

/** Splits one over-long spoken line into breathable pieces of at most `max` words. */
function splitSpokenLine(text: string, max: number): string[] {
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
  if (words(text) <= max) return [text];
  let pieces = text.split(/(?<=[,;:—–.?!])\s+/).filter(Boolean);
  pieces = pieces.flatMap((piece) => (words(piece) > max ? piece.split(CONJUNCTION_BREAK) : [piece]));
  pieces = pieces.flatMap((piece) => {
    if (words(piece) <= max) return [piece];
    const w = piece.split(/\s+/);
    const out: string[] = [];
    const chunks = Math.ceil(w.length / max);
    const size = Math.ceil(w.length / chunks);
    for (let i = 0; i < w.length; i += size) out.push(w.slice(i, i + size).join(' '));
    return out;
  });
  // Join tiny neighbours back together when they still fit in one breath.
  const merged: string[] = [];
  for (const piece of pieces) {
    const last = merged[merged.length - 1];
    if (last !== undefined && (words(last) < 3 || words(piece) < 3) && words(last) + words(piece) <= max) {
      merged[merged.length - 1] = last + ' ' + piece;
    } else {
      merged.push(piece);
    }
  }
  return merged;
}

/**
 * Splits spoken rail lines ("> ...") longer than `max` words into several rails. Only touches the
 * script scope; cues, headings, links and text that is not a rail are left alone. Idempotent.
 */
export function splitLongRails(content: string, max: number = SCRIPT_MAX_LINE_WORDS): string {
  const start = content.indexOf('<!-- SCRIPT_START -->');
  const scopeStart = start === -1 ? 0 : start;
  const end = start === -1 ? -1 : scriptEndIndex(content, start);
  const scopeEnd = end === -1 ? content.length : end;

  const out = content
    .slice(scopeStart, scopeEnd)
    .split('\n')
    .flatMap((raw) => {
      const m = raw.match(/^(\s*>\s?)(.*)$/);
      if (!m) return [raw];
      const text = m[2].trim();
      if (!text || /https?:|\]\(/.test(text)) return [raw];
      return splitSpokenLine(text, max).map((piece) => `> ${piece}`);
    });
  return content.slice(0, scopeStart) + out.join('\n') + content.slice(scopeEnd);
}

function countWords(line: string): number {
  return line.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export interface ScriptShape {
  spokenWords: number;
  spokenLines: number;
  longestLineWords: number;
  linesOverLimit: number;
  sections: number;
  bannedMarkers: string[];
}

export function analyzeSpokenScript(content: string): ScriptShape {
  const scope = scriptScope(content);
  const banned = new Set<string>();
  let spokenWords = 0;
  let spokenLines = 0;
  let longest = 0;
  let over = 0;
  let sections = 0;

  for (const raw of scope.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const plain = line.replace(/^>\s?/, '').trim();

    for (const marker of BANNED_MARKERS) if (marker.test.test(plain)) banned.add(marker.name);

    if (/^(#{2,3}\s*\**\s*\d+\.|={2,}\s*\d+\.)/.test(plain)) sections++;
    if (CUE_LINE.test(plain) || STRUCTURAL_LINE.test(plain)) continue;
    if (SUB_LABEL_LINE.test(plain) || LEAKED_REFERENCE_LINE.test(plain)) continue;

    const words = countWords(plain.replace(/\*+/g, ''));
    if (!words) continue;
    spokenWords += words;
    spokenLines++;
    longest = Math.max(longest, words);
    if (words > SCRIPT_MAX_LINE_WORDS) over++;
  }

  return {
    spokenWords,
    spokenLines,
    longestLineWords: longest,
    linesOverLimit: over,
    sections,
    bannedMarkers: [...banned],
  };
}

/** Human-readable problems with a script measured against a duration range; empty when it is in shape. */
export function checkScriptShape(
  content: string,
  minutes: { min: number; max: number } = DEFAULT_SCRIPT_MINUTES,
): { shape: ScriptShape; issues: string[] } {
  const shape = analyzeSpokenScript(content);
  const budget = scriptWordBudget(minutes.min, minutes.max);
  const issues: string[] = [];

  const ceiling = Math.round(budget.max * 1.1);
  if (shape.spokenWords > ceiling) {
    issues.push(`too long: ${shape.spokenWords} spoken words (limit ${ceiling} for ${minutes.min}-${minutes.max} min)`);
  }
  if (shape.linesOverLimit > Math.max(3, Math.round(shape.spokenLines * 0.05))) {
    issues.push(`${shape.linesOverLimit} lines are longer than ${SCRIPT_MAX_LINE_WORDS} words`);
  }
  if (shape.bannedMarkers.length) issues.push(`contains ${shape.bannedMarkers.join(', ')}`);
  return { shape, issues };
}

/**
 * Safety net applied to a finished script: removes the on-screen legal header, sub-labels,
 * curiosity-reset markers and leaked "verification references" lines from the spoken script.
 * Only touches the text between SCRIPT_START / SCRIPT_END (or the whole text when there are none).
 */
export function sanitizeSpokenScript(content: string): { content: string; removed: string[] } {
  const start = content.indexOf('<!-- SCRIPT_START -->');
  const end = start === -1 ? -1 : scriptEndIndex(content, start);
  const scopeStart = start === -1 ? 0 : start;
  const scopeEnd = start === -1 ? content.length : end === -1 ? content.length : end;

  const removed: string[] = [];
  const out: string[] = [];
  let skippingLegalBlock = false;

  for (const raw of content.slice(scopeStart, scopeEnd).split('\n')) {
    const line = raw.replace(/\r$/, '');
    const plain = line.trim().replace(/^>\s?/, '').trim();

    if (/^#{1,6}\s*\**\s*ON-SCREEN LEGAL STATUS/i.test(plain)) {
      removed.push('ON-SCREEN LEGAL STATUS');
      skippingLegalBlock = true;
      continue;
    }
    if (skippingLegalBlock) {
      // The header is followed by blockquoted status lines; drop them up to the next blank/heading line.
      if (line.trim().startsWith('>')) continue;
      skippingLegalBlock = false;
      if (!line.trim()) continue;
    }
    if (/CURIOSITY RESET/i.test(plain) && !CUE_LINE.test(plain) && plain.length < 80) {
      removed.push('CURIOSITY RESET');
      continue;
    }
    if (SUB_LABEL_LINE.test(plain)) {
      removed.push(`sub-label ${plain.replace(/\*+/g, '')}`);
      continue;
    }
    if (LEAKED_REFERENCE_LINE.test(plain)) {
      removed.push('verification references');
      continue;
    }
    out.push(line);
  }

  if (!removed.length) return { content, removed };
  const cleaned = out.join('\n').replace(/\n{3,}/g, '\n\n');
  return { content: content.slice(0, scopeStart) + cleaned + content.slice(scopeEnd), removed };
}
