/**
 * Splits the client's book ("A Roar in Harlem") into retrievable memory chunks.
 *
 * Pure and deterministic (no model calls): the same text always produces the same chunk ids and
 * metadata, so re-ingesting is idempotent. Each chunk keeps its chapter, the people in it and a few
 * theme tags so the recall step can match a situation ("a brother turns on him over money") to
 * the scene of his life that mirrors it.
 */

export const BOOK_SOURCE = 'a-roar-in-harlem';
export const BOOK_COLLECTION = 'client_book_full' as const;

/** Chunks aim for this many characters and never exceed MAX (embedding + prompt budget). */
export const CHUNK_TARGET = 1300;
export const CHUNK_MAX = 1800;
const CHUNK_MIN = 300;

export interface BookChunkMetadata {
  source: string;
  chapter: number;
  chapterTitle: string;
  part: number;
  characters: string;
  themes: string;
  hasDialogue: boolean;
  [key: string]: string | number | boolean;
}

export interface BookChunk {
  id: string;
  text: string;
  metadata: BookChunkMetadata;
}

/** Characters worth tagging: [display name, regex]. Mike and Unique are the same man at two ages. */
const CHARACTERS: Array<[string, RegExp]> = [
  ['Mike/Unique', /\b(?:Mike|Unique)\b/g],
  ['Bob', /\bBob\b/g],
  ['Kim', /\bKim\b/g],
  ['Ron', /\bRon\b/g],
  ['Trina', /\bTrina\b/g],
  ['Chauncey', /\bChauncey\b/g],
  ['Kenny', /\bKenny\b/g],
  ['Omar', /\bOmar\b/g],
  ['Stacey', /\bSta[cs]e?y\b/g],
  ['David', /\bDavid\b/g],
  ['Jade', /\bJade\b/g],
  ['Tony', /\bTony\b/g],
  ['Simone', /\bSimone\b/g],
  ['Renee', /\bRenee\b/g],
  ['Dee Dee', /\bDee Dee\b/g],
  ['Timmy', /\bTimmy\b/g],
  ['Stone', /\bStone\b/g],
  ['Havoc', /\bHavoc\b/g],
  ['Grandmother', /\b(?:grandmother|grandma)\b/gi],
];

const THEMES: Array<[string, RegExp]> = [
  ['betrayal', /\b(?:betray\w*|snake\w*|crossed|backstab\w*|stole|stolen|double-cross\w*)\b/gi],
  ['police-informant', /\b(?:police|cops?|feds?|federal|detectives?|snitch\w*|informant|rat(?:ted)?|testif\w*|cooperat\w*)\b/gi],
  ['violence', /\b(?:gun|pistol|shot|shoot\w*|kill\w*|blood\w*|stab\w*|smoked|murder\w*|38|9-millimeter)\b/gi],
  ['prison', /\b(?:prison|cell|jail|inmates?|guards?|correctional|sentenc\w*|yardville|parole)\b/gi],
  ['money-hustle', /\b(?:money|cash|bricks?|kilos?|keys|coke|crack|dope|hustl\w*|stash\w*|spot|paper)\b/gi],
  ['family', /\b(?:mother|mom|grandmother|grandma|brother|father|family|son|baby)\b/gi],
  ['love-trust', /\b(?:love[sd]?|trust\w*|heart|loyal\w*|girl|woman)\b/gi],
  ['fear-paranoia', /\b(?:paranoid|afraid|scared|fear\w*|nervous|sweat\w*|suspicio\w*|watch(?:ing)? his back)\b/gi],
  ['code-respect', /\b(?:respect\w*|code|word|promise\w*|partner|loyalty|disrespect\w*)\b/gi],
  ['power-takeover', /\b(?:power\w*|boss|take ?over|run(?:ning)? the|crown|empire|plan)\b/gi],
  ['death-grief', /\b(?:funeral|dead|died|death|buried|grave|mourn\w*|cried|crying)\b/gi],
  ['survival', /\b(?:surviv\w*|alone|hungry|nobody|streets?|hospital|wound\w*)\b/gi],
];

function countMatches(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? m.length : 0;
}

export function tagCharacters(text: string): string[] {
  return CHARACTERS.map(([name, re]) => [name, countMatches(text, re)] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name);
}

export function tagThemes(text: string): string[] {
  return THEMES.map(([name, re]) => [name, countMatches(text, re)] as const)
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);
}

/** Splits one over-long paragraph on sentence boundaries so no piece exceeds `max`. */
function splitParagraph(p: string, max: number): string[] {
  if (p.length <= max) return [p];
  const sentences = p.split(/(?<=[.!?”"])\s+/);
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && cur.length + s.length + 1 > max) {
      out.push(cur);
      cur = s;
    } else {
      cur = cur ? `${cur} ${s}` : s;
    }
    // A single sentence longer than max is hard-split; vanishingly rare in prose.
    while (cur.length > max) {
      out.push(cur.slice(0, max));
      cur = cur.slice(max);
    }
  }
  if (cur) out.push(cur);
  return out;
}

function isMostlyUpper(line: string): boolean {
  const letters = line.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return false;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  return upper / letters.length >= 0.7;
}

interface RawChapter {
  number: number;
  title: string;
  part: number;
  paragraphs: string[];
}

/** Reads the cleaned book text into chapters of paragraphs. Chapter 0 is the prologue. */
export function parseChapters(text: string): RawChapter[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const chapters: RawChapter[] = [];
  let part = 1;
  let current: RawChapter | null = null;
  let chapterCounter = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const partMatch = line.match(/^part\s+(one|two|1|2)\b/i);
    if (partMatch && line.length < 40) {
      part = /two|2/i.test(partMatch[1]) ? 2 : 1;
      continue;
    }

    if (/^prologue\b/i.test(line) && line.length < 20) {
      current = { number: 0, title: 'PROLOGUE', part, paragraphs: [] };
      chapters.push(current);
      continue;
    }

    if (/^chapter\s+[a-z0-9 -]{2,30}$/i.test(line)) {
      chapterCounter++;
      let title = '';
      // The title is the next non-empty, mostly-uppercase line.
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const candidate = (lines[j] || '').trim();
      if (candidate && candidate.length <= 220 && isMostlyUpper(candidate)) {
        title = candidate;
        i = j;
      }
      current = { number: chapterCounter, title, part, paragraphs: [] };
      chapters.push(current);
      continue;
    }

    if (current) current.paragraphs.push(line);
  }
  return chapters;
}

export function chunkBook(text: string): BookChunk[] {
  const chunks: BookChunk[] = [];
  for (const chapter of parseChapters(text)) {
    const pieces: string[] = [];
    let cur = '';
    const flush = () => {
      if (cur.trim()) pieces.push(cur.trim());
      cur = '';
    };
    for (const paragraph of chapter.paragraphs.flatMap((p) => splitParagraph(p, CHUNK_MAX))) {
      if (cur && cur.length + paragraph.length + 1 > CHUNK_TARGET) flush();
      cur = cur ? `${cur}\n${paragraph}` : paragraph;
    }
    flush();

    // Fold a tiny tail into the previous chunk when it still fits.
    if (pieces.length > 1) {
      const last = pieces[pieces.length - 1];
      const prev = pieces[pieces.length - 2];
      if (last.length < CHUNK_MIN && prev.length + last.length + 1 <= CHUNK_MAX) {
        pieces.splice(pieces.length - 2, 2, `${prev}\n${last}`);
      }
    }

    const key = chapter.number === 0 ? 'p0' : `c${chapter.number}`;
    pieces.forEach((piece, idx) => {
      chunks.push({
        id: `bk-${key}-${String(idx + 1).padStart(3, '0')}`,
        text: piece,
        metadata: {
          source: BOOK_SOURCE,
          chapter: chapter.number,
          chapterTitle: chapter.title,
          part: chapter.part,
          characters: tagCharacters(piece).join(', '),
          themes: tagThemes(piece).join(', '),
          hasDialogue: (piece.match(/["“”]/g) || []).length >= 4,
        },
      });
    });
  }
  return chunks;
}
