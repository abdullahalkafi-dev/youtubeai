import { Injectable, Logger } from '@nestjs/common';
import { ChromaService, ChromaQueryResult } from '../chroma/chroma.service';
import { BOOK_COLLECTION } from '../chroma/book-chunker';
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

const SITUATION_TIMEOUT_MS = 3500;
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

Given a YouTube script request about a crime or prison story, work out the HUMAN SITUATION underneath it and find scenes in his own life that mirror it. Do not search the news story itself; search for the moment in his life that rhymes with it.

Return ONLY JSON:
{"queries":[3 or 4 short plain-narration descriptions of scenes from a street life that mirror the dynamics of this story, each under 25 words],"themes":[0 to 3 of: ${KNOWN_THEMES.join(', ')}],"dynamics":"one sentence on the human dynamic (who turned on whom, what the stakes were, what the split-second choice was)"}`;

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
      (c.chunk.metadata?.hasDialogue ? 0.01 : 0) +
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

/** Pure: the prompt block for a set of recalled chunks. */
export function formatBookBlock(chunks: ChromaQueryResult[], dynamics?: string): string {
  if (!chunks.length) return '';
  const lines = [
    '## FROM UNIQUE\'S OWN LIFE — raw material from his book "A Roar in Harlem"',
    'In the book the young man called Mike McCormick IS Unique ("Unique" is the name he takes later). These are real moments of his life.',
    'HOW TO USE: pick the ONE moment that truly mirrors this story and use it as lived experience in his first-person voice, especially in the Unique twist point. Paraphrase in his voice; quote at most a short line; never invent anything beyond what is written here; if nothing fits, ignore all of it.',
  ];
  if (dynamics) lines.push(`Human dynamic of this story (for matching): ${dynamics}`);
  chunks.forEach((c, i) => {
    const m = c.metadata || {};
    const where = m.chapter === 0 ? 'Prologue' : `Ch. ${m.chapter}`;
    const title = String(m.chapterTitle || '').slice(0, 70);
    const who = m.characters ? ` (${m.characters})` : '';
    lines.push(`\n[${i + 1}] ${where}${title ? ` · ${title}` : ''}${who}\n${c.text.slice(0, 1400)}`);
  });
  return lines.join('\n');
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
        `Script request:\n${request.slice(0, 1500)}`,
      temperature: 0,
      maxCompletionTokens: 400,
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
      const chunks = pickBookChunks(perQuery, situation.themes, opts.avoidIds || [], opts.max ?? 5);
      if (!chunks.length) return { block: '', ids: [], fellBack };
      this.logger.log(
        `Book recall: ${chunks.length} chunks (${chunks.map((c) => c.id).join(', ')})${fellBack ? ' [raw-request fallback]' : ''}`,
      );
      return { block: formatBookBlock(chunks, situation.dynamics), ids: chunks.map((c) => c.id), fellBack };
    } catch (err: any) {
      this.logger.warn(`Book recall failed: ${err?.message || err}`);
      return { block: '', ids: [], fellBack };
    }
  }
}
