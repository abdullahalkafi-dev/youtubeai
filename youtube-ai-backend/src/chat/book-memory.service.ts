import { Injectable, Logger } from '@nestjs/common';
import { ChromaService, ChromaQueryResult } from '../chroma/chroma.service';
import { BOOK_COLLECTION, BookChunk, chunkBook } from '../chroma/book-chunker';
import { loadBookText } from '../chroma/book-source';
import { OpenAIService } from '../openai/openai.service';

/** The situation behind a script request, in terms the book can be searched with. */
export interface BookSituation {
  queries: string[];
  themes: string[];
  dynamics: string;
}

export interface BookRecall {
  /** Ready to drop into the dynamic context; empty string when nothing relevant was found. */
  block: string;
  /** Chunk ids used, remembered on the message so the next script can vary. */
  ids: string[];
  /** True when the situation step failed and the raw request was searched instead. */
  fellBack: boolean;
}

const SITUATION_TIMEOUT_MS = 20000;
const KNOWN_THEMES = [
  'betrayal',
  'police-informant',
  'violence',
  'prison',
  'money-hustle',
  'family',
  'love-trust',
  'fear-paranoia',
  'code-respect',
  'power-takeover',
  'death-grief',
  'survival',
];

const SITUATION_PROMPT = `You prepare search queries for the memoir of a street criminal who later served 26 years in federal prison. The memoir is a long book full of scenes: robberies, betrayals by partners and family, the code of the street, never working with police, his mother, his brothers, prison, money, love, fear, loss.

Given a YouTube script request about a crime or prison story, work out the HUMAN SITUATION underneath it and find scenes in his own life that mirror it. Do not search the news story itself; search for the moment in his life that rhymes with it. Prefer scenes that show his own MIND at work: what he was thinking, calculating, deciding or telling himself in the split second, not only what happened around him.

Return ONLY JSON:
{"queries":[3 or 4 short plain-narration descriptions of scenes from a street life that mirror the dynamics of this story, each under 25 words],"themes":[0 to 3 of: ${KNOWN_THEMES.join(', ')}],"dynamics":"one sentence on the human dynamic (who turned on whom, what the stakes were, what the split-second choice was)"}`;

/** One recalled life moment, boiled down to facts the writer must not drop or soften. */
export interface MemoryCard {
  title: string;
  beats: string[];
  innerLine: string;
  mirror: string;
}

const MEMORY_CARD_TIMEOUT_MS = 20000;

const MEMORY_CARD_PROMPT = `You prepare ONE lived memory from a street criminal's memoir for use in a YouTube script. You will get the story being scripted and numbered memoir passages.

Choose the ONE passage whose human dynamic best mirrors the story AND shows his own mind at work (what he thought, calculated or decided). Prefer a scene where he ACTED over a quiet one. If the passage continues, use the continuation too.

Then list the beats of that scene in order, using ONLY what the text says: what he was thinking, what he planned, exactly what he did (violence stated plainly, no gore for its own sake, no softening), and what it cost him right after. Do not add, moralize, or judge.

Return ONLY JSON:
{"pick":<passage number>,"title":"<up to six words naming the moment>","beats":[5 to 9 short plain past-tense sentences, third person, in order],"inner_line":"<one thing he thought to himself, close to the book's own words, or empty>","mirror":"<one sentence: how this moment rhymes with the story being scripted>"}`;

/** Pure: reads the model's JSON into a usable memory card, or null when it is unusable. */
export function parseMemoryCard(raw: string, passageCount: number): MemoryCard | null {
  const parsed = parseJson(raw);
  if (!parsed || !Array.isArray(parsed.beats)) return null;
  const pick = Number(parsed.pick);
  if (!Number.isInteger(pick) || pick < 1 || pick > passageCount) return null;
  const beats = parsed.beats
    .filter((b: unknown) => typeof b === 'string' && b.trim().length > 6)
    .map((b: string) => b.trim().slice(0, 300))
    .slice(0, 9);
  if (beats.length < 3) return null;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return {
    title: str(parsed.title, 80),
    beats,
    innerLine: str(parsed.inner_line, 240),
    mirror: str(parsed.mirror, 300),
  };
}

/** Pure: the prompt block that makes point 2 retell this memory, every beat, nothing softened. */
export function formatMemoryCard(card: MemoryCard): string {
  const lines = [
    '## THE MEMORY TO BUILD POINT 2 ON (fixed facts from his own life: his voice, first person, nothing added, nothing softened)',
    `Moment: ${card.title || 'untitled'}`,
    'What happened, in order:',
    ...card.beats.map((b, i) => `${i + 1}. ${b}`),
  ];
  if (card.innerLine) lines.push(`What he told himself: "${card.innerLine}"`);
  if (card.mirror) lines.push(`How it rhymes with this story: ${card.mirror}`);
  lines.push(
    'RULE: point 2 retells this memory in his flat first-person past tense with EVERY beat above, in order, including what he did and what it cost him, then breaks it against this story through the mindset. Do not stop early, skip the act, or replace it with a milder memory. The changed man judges it afterward; the old self is not cleaned up.',
  );
  return lines.join('\n');
}

function parseJson(raw: string): any {
  try {
    return JSON.parse(raw.replace(/```json/gi, '').replace(/```/g, '').trim());
  } catch {
    const m = (raw || '').match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

/** Pure: reads the model's JSON into a usable situation, or null when it is unusable. */
export function parseSituation(raw: string): BookSituation | null {
  const parsed = parseJson(raw);
  if (!parsed || !Array.isArray(parsed.queries)) return null;
  const queries = parsed.queries
    .filter((q: unknown) => typeof q === 'string' && q.trim().length > 8)
    .map((q: string) => q.trim().slice(0, 240))
    .slice(0, 4);
  if (!queries.length) return null;
  const themes = (Array.isArray(parsed.themes) ? parsed.themes : [])
    .filter((t: unknown) => typeof t === 'string' && KNOWN_THEMES.includes(t))
    .slice(0, 3);
  return {
    queries,
    themes,
    dynamics: typeof parsed.dynamics === 'string' ? parsed.dynamics.slice(0, 300) : '',
  };
}

/** A passage where his own mind is on the page: a thought, a calculation, something he told himself. */
const INNER_THOUGHT =
  /\b(?:thought to himself|to himself|told himself|he thought|he wondered|wondered|realized|he knew|thoughts?\b|flashbacks?|mind)\b/i;

interface Candidate {
  chunk: ChromaQueryResult;
  best: number;
  hits: number;
}

/**
 * Pure: merges per-query results into the best few chunks.
 * Lower score is better: closest distance, rewarded for being hit by several queries, for sharing the
 * situation's themes and for being a lived scene (dialogue); softly penalised when recently used.
 */
export function pickBookChunks(
  perQuery: ChromaQueryResult[][],
  themes: string[],
  avoidIds: string[],
  max: number,
): ChromaQueryResult[] {
  const byId = new Map<string, Candidate>();
  for (const results of perQuery) {
    for (const r of results) {
      const cur = byId.get(r.id);
      if (cur) {
        cur.hits++;
        cur.best = Math.min(cur.best, r.distance);
      } else {
        byId.set(r.id, { chunk: r, best: r.distance, hits: 1 });
      }
    }
  }
  const avoid = new Set(avoidIds);
  const scored = [...byId.values()].map((c) => {
    const chunkThemes = String(c.chunk.metadata?.themes || '').split(',').map((t) => t.trim());
    const overlap = themes.filter((t) => chunkThemes.includes(t)).length;
    const score =
      c.best -
      0.03 * (c.hits - 1) -
      0.04 * overlap -
      (c.chunk.metadata?.hasDialogue ? 0.01 : 0) -
      (INNER_THOUGHT.test(c.chunk.text || '') ? 0.03 : 0) +
      (avoid.has(c.chunk.id) ? 0.15 : 0);
    return { c, score };
  });
  scored.sort((a, b) => a.score - b.score);

  const perChapter = new Map<number, number>();
  const picked: ChromaQueryResult[] = [];
  for (const { c } of scored) {
    const chapter = Number(c.chunk.metadata?.chapter ?? -1);
    if ((perChapter.get(chapter) || 0) >= 2) continue;
    perChapter.set(chapter, (perChapter.get(chapter) || 0) + 1);
    picked.push(c.chunk);
    if (picked.length >= max) break;
  }
  return picked;
}

/**
 * Pure: for each picked chunk, the passage that follows it in the same chapter, so a scene arrives
 * whole instead of cut off before the part where his mind shows. `all` is the book in reading order.
 */
export function continuationsFor(
  picked: ChromaQueryResult[],
  all: Array<Pick<BookChunk, 'id' | 'text' | 'metadata'>>,
  limit: number = 2,
  span: number = 2,
): Record<string, string> {
  const out: Record<string, string> = {};
  const index = new Map(all.map((c, i) => [c.id, i] as const));
  for (const c of picked.slice(0, limit)) {
    const at = index.get(c.id);
    if (at === undefined) continue;
    const following: string[] = [];
    for (let k = 1; k <= span; k++) {
      const next = all[at + k];
      if (!next || next.metadata.chapter !== c.metadata?.chapter) break;
      following.push(next.text);
    }
    if (following.length) out[c.id] = following.join('\n');
  }
  return out;
}

/** The whole book in reading order, chunked once per process. Empty when the asset is not on disk. */
let bookInReadingOrder: BookChunk[] | null = null;
function wholeBook(): BookChunk[] {
  if (!bookInReadingOrder) {
    const text = loadBookText();
    bookInReadingOrder = text ? chunkBook(text) : [];
  }
  return bookInReadingOrder;
}

/** Pure: the prompt block for a set of recalled chunks. */
export function formatBookBlock(
  chunks: ChromaQueryResult[],
  dynamics?: string,
  continuations: Record<string, string> = {},
): string {
  if (!chunks.length) return '';
  const lines = [
    '## FROM UNIQUE\'S OWN LIFE — raw material from his book "A Roar in Harlem"',
    'In the book the young man called Mike McCormick IS Unique ("Unique" is the name he takes later). These are real moments of his life.',
    'HOW TO USE: pick the ONE moment that truly mirrors this story and use it as lived experience in his first-person voice, especially in the Unique twist point. Prefer the moment where his own MIND is on the page (what he was thinking, calculating, deciding, telling himself) over the quiet setup around it, and tell that thought in his words. Keep the people exactly as written (a drug spot is a drug spot; do not make the victim an innocent civilian, and do not soften what he planned or did: if he acted, say what he did plainly and then what it cost him; never stop the memory at the point where an officer or a bystander breaks it up). Paraphrase in his voice; quote at most a short line; never invent anything beyond what is written here; if nothing fits, ignore all of it.',
  ];
  if (dynamics) lines.push(`Human dynamic of this story (for matching): ${dynamics}`);
  chunks.forEach((c, i) => {
    const m = c.metadata || {};
    const where = m.chapter === 0 ? 'Prologue' : `Ch. ${m.chapter}`;
    const title = String(m.chapterTitle || '').slice(0, 70);
    const who = m.characters ? ` (${m.characters})` : '';
    const more = continuations[c.id] ? `\n(the scene continues:) ${continuations[c.id].slice(0, 2400)}` : '';
    lines.push(`\n[${i + 1}] ${where}${title ? ` · ${title}` : ''}${who}\n${c.text.slice(0, 1400)}${more}`);
  });
  return lines.join('\n');
}

/**
 * Pure: a short follow-up ("now give me script for this video") carries no topic, so the book search
 * would run blind. When the request is short, borrow the subject from the last assistant message
 * (the topic pick the follow-up refers to). Long requests already say what they are about.
 */
export function topicAwareRequest(
  request: string,
  messages: Array<{ role: string; content?: string }> = [],
  minChars: number = 320,
  maxContext: number = 1500,
): string {
  const text = (request || '').trim();
  if (text.length >= minChars) return text;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant' && typeof m.content === 'string' && m.content.trim().length > 80) {
      return `${text}\n\nWhat this refers to (the previous assistant message in this chat):\n${m.content.trim().slice(0, maxContext)}`;
    }
  }
  return text;
}

/** Memory ids used by earlier scripts in this thread, newest first (so the next script can vary). */
export function recentBookChunkIds(
  messages: Array<{ role: string; metadata?: any }>,
  lastN: number = 2,
): string[] {
  const ids: string[] = [];
  let seen = 0;
  for (let i = messages.length - 1; i >= 0 && seen < lastN; i--) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    const used = m.metadata?.bookChunkIds;
    if (Array.isArray(used)) {
      ids.push(...used);
      seen++;
    }
  }
  return ids;
}

@Injectable()
export class BookMemoryService {
  private readonly logger = new Logger(BookMemoryService.name);

  constructor(
    private readonly chroma: ChromaService,
    private readonly openai: OpenAIService,
  ) {}

  /** Single global switch (single channel: no per-channel setting). */
  static enabled(): boolean {
    return process.env.UMA_BOOK_RECALL !== 'false';
  }

  private async situationFor(request: string, topicHint?: string): Promise<BookSituation | null> {
    const llm = this.openai.chatFast({
      systemPrompt: SITUATION_PROMPT,
      userMessage:
        (topicHint ? `Conversation topic: ${topicHint}\n\n` : '') +
        `Script request:\n${request.slice(0, 2400)}`,
      temperature: 0,
      // Generous on purpose: the small model spends part of this budget on hidden reasoning and an
      // empty reply is what a tight limit produces.
      maxCompletionTokens: 3000,
    });
    llm.catch(() => undefined);
    const raw = await Promise.race<string>([
      llm,
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('situation step timed out')), SITUATION_TIMEOUT_MS),
      ),
    ]);
    return parseSituation(raw);
  }

  /** Boils the recalled passages down to the one memory point 2 must retell. Null on any failure. */
  private async memoryCardFor(request: string, passages: string, passageCount: number): Promise<MemoryCard | null> {
    const llm = this.openai.chatFast({
      systemPrompt: MEMORY_CARD_PROMPT,
      userMessage: `STORY BEING SCRIPTED:\n${request.slice(0, 1800)}\n\nMEMOIR PASSAGES:\n${passages}`,
      temperature: 0,
      // Same reasoning-budget lesson as the situation step: a small limit returns an empty reply.
      maxCompletionTokens: 4000,
    });
    llm.catch(() => undefined);
    const raw = await Promise.race<string>([
      llm,
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('memory card step timed out')), MEMORY_CARD_TIMEOUT_MS),
      ),
    ]);
    return parseMemoryCard(raw, passageCount);
  }

  /**
   * Finds the moments in his life that mirror the story in `request`.
   * Never throws: any failure returns an empty recall and the caller keeps its old behaviour.
   */
  async recall(
    request: string,
    opts: { topicHint?: string; avoidIds?: string[]; max?: number } = {},
  ): Promise<BookRecall> {
    const text = (request || '').trim();
    if (!text) return { block: '', ids: [], fellBack: false };
    let situation: BookSituation | null = null;
    let fellBack = false;
    try {
      situation = await this.situationFor(text, opts.topicHint);
    } catch (err: any) {
      this.logger.warn(`Book recall: situation step failed (${err?.message || err}); searching the raw request.`);
    }
    if (!situation) {
      fellBack = true;
      situation = { queries: [text.slice(0, 300)], themes: [], dynamics: '' };
    }
    try {
      const perQuery = await Promise.all(
        situation.queries.map((q) => this.chroma.query(BOOK_COLLECTION, q, 8)),
      );
      const chunks = pickBookChunks(perQuery, situation.themes, opts.avoidIds || [], opts.max ?? 4);
      if (!chunks.length) return { block: '', ids: [], fellBack };
      const continuations = continuationsFor(chunks, wholeBook());
      this.logger.log(
        `Book recall: ${chunks.length} chunks (${chunks.map((c) => c.id).join(', ')}), ${Object.keys(continuations).length} continued${fellBack ? ' [raw-request fallback]' : ''}`,
      );
      const passages = formatBookBlock(chunks, situation.dynamics, continuations);
      let block = passages;
      try {
        const card = await this.memoryCardFor(text, passages, chunks.length);
        if (card) {
          block = `${formatMemoryCard(card)}\n\n${passages}`;
          this.logger.log(`Book recall: memory card "${card.title}" (${card.beats.length} beats)`);
        }
      } catch (err: any) {
        this.logger.warn(`Book recall: memory card step failed (${err?.message || err}); using the passages alone.`);
      }
      return { block, ids: chunks.map((c) => c.id), fellBack };
    } catch (err: any) {
      this.logger.warn(`Book recall failed: ${err?.message || err}`);
      return { block: '', ids: [], fellBack };
    }
  }
}
