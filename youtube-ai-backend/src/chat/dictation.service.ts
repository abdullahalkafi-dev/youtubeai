import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Thread, ThreadDocument } from '../mongo/schemas/thread.schema';
import { OpenAIService } from '../openai/openai.service';
import { SkillRegistry } from './skills/skill-registry';
import { BookMemoryService } from './book-memory.service';
import { buildTwistBrief, BULLET_SCRIPT_END, BULLET_SCRIPT_START } from '../openai/prompts/unique-persona';
import { closeScriptMarkers, sanitizeSpokenScript, splitLongRails } from '../openai/prompts/script-length';
import { isFullScript } from './dual-script';

/**
 * "Dictate my own bullets": he talks his own talking points into the mic, one bullet at a time, and gets
 * (1) his bullets laid out as a teleprompter card, his words only, with a clear gap and a number so he
 * sees where he left off, and (2) a full spoken script built on them in his voice.
 */

const MAX_BULLETS = 40;
const MAX_BULLET_CHARS = 4000;
const LINE_WORDS = 8;
const LINES_PER_BLOCK = 3;

export interface TidyItem {
  heading: string;
  text: string;
}

export interface TidyResult {
  title: string;
  items: TidyItem[];
}

/** Pure: the bullets as the server accepts them: trimmed, no empties, capped. */
export function cleanBullets(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((b) => String(b ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_BULLET_CHARS))
    .filter(Boolean)
    .slice(0, MAX_BULLETS);
}

const words = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];

/**
 * Pure: did the tidied text keep his words? Most of what he said (words of 4+ letters) must still be
 * there; spelling fixes of a few words are fine, a rewrite is not.
 */
export function keepsHisWords(original: string, tidied: string): boolean {
  const mine = words(original).filter((w) => w.length >= 4);
  if (mine.length === 0) return true;
  const kept = new Set(words(tidied));
  const hits = mine.filter((w) => kept.has(w)).length;
  return hits / mine.length >= 0.7;
}

/** Pure: a bullet with no model help: capital letter first, a full stop at the end. */
export function basicTidy(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return t;
  const cap = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.?!…]["”']?$/.test(cap) ? cap : `${cap}.`;
}

/** Pure: a short heading in caps taken from the bullet's own first words. */
export function fallbackHeading(text: string): string {
  return words(text).slice(0, 5).join(' ').toUpperCase() || 'BULLET';
}

/** Pure: reads the model's JSON, or null when it is unusable. */
export function parseTidy(raw: string, bullets: string[]): TidyResult | null {
  let parsed: any = null;
  try {
    parsed = JSON.parse(raw.replace(/```json/gi, '').replace(/```/g, '').trim());
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        parsed = null;
      }
    }
  }
  if (!parsed || !Array.isArray(parsed.items) || parsed.items.length !== bullets.length) return null;
  const items: TidyItem[] = bullets.map((original, i) => {
    const it = parsed.items[i] || {};
    const text = typeof it.text === 'string' ? it.text.trim() : '';
    const heading = typeof it.heading === 'string' ? it.heading.replace(/[#*_`<>]/g, '').trim().toUpperCase() : '';
    return {
      text: text && keepsHisWords(original, text) ? text : basicTidy(original),
      heading: heading && heading.split(/\s+/).length <= 9 ? heading : fallbackHeading(original),
    };
  });
  const title = typeof parsed.title === 'string' ? parsed.title.replace(/[#*_`<>]/g, '').trim().toUpperCase() : '';
  return { title: title.slice(0, 90), items };
}

/** Pure: no model: every bullet as he said it, tidied only by capital letter and full stop. */
export function plainTidy(bullets: string[]): TidyResult {
  return {
    title: '',
    items: bullets.map((b) => ({ text: basicTidy(b), heading: fallbackHeading(b) })),
  };
}

/** A line must not end on one of these: it would leave the reader hanging on "and" or "the". */
const DANGLING = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'so', 'because', 'that', 'to', 'of', 'in', 'on', 'at', 'for', 'with',
  'from', 'by', 'as', 'if', 'when', 'while', 'than', 'then', 'my', 'your', 'his', 'her', 'their', 'our', 'its',
  'this', 'these', 'those', 'i', 'you', 'he', 'she', 'we', 'they', 'it', 'is', 'are', 'was', 'were', 'be', 'been',
  'am', 'do', 'does', 'did', 'not', 'no', 'just', 'even', 'there', "there's", "it's", "you're", "i'm", "that's",
  "don't", "didn't", 'can', 'will', 'would', 'could', 'should', 'have', 'has', 'had',
  'every', 'each', 'other', 'another', 'any', 'some', 'all', 'both', 'either', 'such', 'what', 'which', 'who',
  'whose', 'how', 'why', 'where', 'also', 'still', 'really', 'very', 'too', 'more', 'most', 'makes', 'make',
]);

/** A line may break BEFORE one of these: the thought turns there. */
const TURNS = new Set(['and', 'but', 'because', 'so', 'then', 'when', 'while', 'if', 'that', 'which', 'until', 'before', 'after', 'where', 'who']);

const bare = (w: string) => w.toLowerCase().replace(/[^a-z']/g, '');

/**
 * Pure: one sentence as short lines of at most `max` words (a short tail may run to max + 2). A line
 * breaks after punctuation first, before a word where the thought turns second, and never ends on a
 * word like "and" or "the". Every line but the last ends in punctuation (a comma where the cut left
 * none) so he can tell the thought goes on. The words are exactly the sentence's words.
 */
export function wrapLines(sentence: string, max: number = LINE_WORDS): string[] {
  const w = sentence.split(/\s+/).filter(Boolean);
  if (w.length <= max) return [w.join(' ')];
  const lines: string[][] = [];
  let i = 0;
  while (i < w.length) {
    const left = w.length - i;
    if (left <= max) {
      lines.push(w.slice(i));
      break;
    }
    let best = -1;
    let bestScore = -1;
    for (let n = Math.min(max, left - 1); n >= 3; n--) {
      const last = w[i + n - 1];
      const next = w[i + n];
      const punctuated = /[,;:—–.?!…]$/.test(last);
      if (!punctuated && DANGLING.has(bare(last))) continue;
      const score = punctuated ? 3 : TURNS.has(bare(next)) ? 2 : 1;
      if (score > bestScore) {
        best = n;
        bestScore = score;
      }
    }
    if (best === -1) best = Math.min(max, left - 1);
    // Never leave a one or two word tail behind.
    if (left - best < 3 && left <= max + 2) best = left;
    lines.push(w.slice(i, i + best));
    i += best;
  }
  const last = lines[lines.length - 1];
  if (lines.length > 1 && last.length < 3 && lines[lines.length - 2].length + last.length <= max + 2) {
    lines[lines.length - 2].push(...lines.pop()!);
  }
  return lines.map((l, k) => {
    const text = l.join(' ');
    return k < lines.length - 1 && !/[,;:—–.?!…]$/.test(text) ? `${text},` : text;
  });
}

/**
 * Pure: one bullet as breath blocks. Each sentence is one block of at most three short lines (a longer
 * sentence is shared out evenly over several blocks); a comma ends a line when the thought goes on.
 * The words are exactly the tidied words.
 */
export function bulletBlocks(text: string): string[][] {
  const sentences = text.match(/[^.?!…]+[.?!…]+["”']?|[^.?!…]+$/g) || [text];
  const blocks: string[][] = [];
  for (const sentence of sentences.map((s) => s.trim()).filter(Boolean)) {
    const lines = wrapLines(sentence);
    const count = Math.ceil(lines.length / LINES_PER_BLOCK);
    const base = Math.floor(lines.length / count);
    const extra = lines.length % count;
    let at = 0;
    for (let b = 0; b < count; b++) {
      const size = base + (b < extra ? 1 : 0);
      blocks.push(lines.slice(at, at + size));
      at += size;
    }
  }
  return blocks;
}

/**
 * Pure: his bullets as a teleprompter card. Every bullet is a numbered section with a wide gap before
 * the next one, so he can see where he left off when he looks back at the screen.
 */
export function ownBulletsCard(title: string, items: TidyItem[]): string {
  const out: string[] = [BULLET_SCRIPT_START, `# SCRIPT TITLE: ${title || 'MY BULLETS'}`, '**MY OWN BULLETS | UMA OUTLAW STORY-FLOW BULLETS**', ''];
  items.forEach((item, i) => {
    out.push(`## ${i + 1}. ${item.heading}`, '');
    for (const block of bulletBlocks(item.text)) {
      out.push(...block.map((l) => `> ${l}`), '');
    }
    out.push('[PAUSE]', '');
  });
  out.push(BULLET_SCRIPT_END);
  return out.join('\n');
}

const TIDY_SYSTEM = `You tidy a speaker's own dictated talking points. He spoke them into a microphone, so they may have wrong or missing punctuation, spelling mistakes from speech-to-text and stumbles.

RULES
- Keep EVERY idea, name, fact and number he said, in HIS words and HIS order. Fix only spelling (including a name or place the speech-to-text clearly misspelled), grammar and punctuation, and drop filler ("um", "uh", "you know") and repeated false starts.
- Never add a fact, a feeling or a sentence he did not say. Never merge, split, reorder or drop bullets.
- "heading": 3 to 7 words in caps, taken from the bullet's own words, that tell him which bullet this is at a glance.
- "title": 3 to 8 words in caps that name what all the bullets are about, in his words.

Return ONLY JSON: {"title":"...","items":[{"heading":"...","text":"..."}]} with exactly as many items as bullets, in the same order.`;

/** Pure: the request for the full script built on his bullets. */
export function buildDictationScriptRequest(bullets: string[], title?: string): string {
  return [
    'MY BULLETS (the talking points I dictated, in my order):',
    ...bullets.map((b, i) => `${i + 1}. ${b}`),
    title ? `\nWORKING TITLE: ${title}` : '',
    '\nTASK: write the full spoken script built on my bullets. Every bullet becomes part of the story, in this order, with my facts and meaning kept exactly. Write it the way I talk: OG professor, laid back but fast-paced, emotional, with the psychological twist. You may fill out the story around my bullets, but never contradict one. Do not add outside facts, names, dates, charges or claims that are not in my bullets: no research, this is my story.',
    'FORMAT: write ONLY the full spoken script, in the standard spoken format (rails and breath blocks), starting with <!-- SCRIPT_START --> and ending with <!-- SCRIPT_END -->. Nothing before or after it.',
  ]
    .filter(Boolean)
    .join('\n');
}

@Injectable()
export class DictationService {
  private readonly logger = new Logger(DictationService.name);

  constructor(
    @InjectModel(Thread.name) private readonly threadModel: Model<ThreadDocument>,
    private readonly openai: OpenAIService,
    private readonly skills: SkillRegistry,
    private readonly bookMemory: BookMemoryService,
  ) {}

  /** Speech to text for one recorded bullet. */
  async transcribe(file: { buffer: Buffer; originalname?: string; mimetype: string }): Promise<{ text: string }> {
    if (!file?.buffer?.length) throw new BadRequestException('No recording received.');
    const ext = (file.mimetype.split('/')[1] || 'webm').split(';')[0];
    const text = await this.openai.transcribeAudio({
      buffer: file.buffer,
      filename: file.originalname || `bullet.${ext}`,
      mimeType: file.mimetype,
    });
    return { text };
  }

  /** His bullets tidied (spelling, grammar, punctuation) with a heading each; never loses his words. */
  async tidy(bullets: string[]): Promise<TidyResult> {
    try {
      const raw = await this.openai.chatFast({
        systemPrompt: TIDY_SYSTEM,
        userMessage: `BULLETS (${bullets.length}):\n${bullets.map((b, i) => `${i + 1}. ${b}`).join('\n')}`,
        temperature: 0,
        maxCompletionTokens: 6000,
      });
      const parsed = parseTidy(raw, bullets);
      if (parsed) return parsed;
      this.logger.warn('Dictation tidy: unusable model answer, using his bullets as spoken');
    } catch (err: any) {
      this.logger.warn(`Dictation tidy failed (${err?.message || err}), using his bullets as spoken`);
    }
    return plainTidy(bullets);
  }

  /** Bullets in, his bullet card out (the words stay his). */
  async bulletsCard(rawBullets: unknown, title?: string): Promise<{ title: string; bulletCard: string; bullets: string[] }> {
    const bullets = cleanBullets(rawBullets);
    if (!bullets.length) throw new BadRequestException('Dictate at least one bullet first.');
    const tidy = await this.tidy(bullets);
    const finalTitle = (title || '').trim().toUpperCase() || tidy.title || 'MY BULLETS';
    return { title: finalTitle, bulletCard: ownBulletsCard(finalTitle, tidy.items), bullets };
  }

  /** Bullets in, a full spoken script in his voice out (no web research; his story). */
  async fullScript(rawBullets: unknown, title?: string): Promise<{ title: string; fullScript: string }> {
    const bullets = cleanBullets(rawBullets);
    if (!bullets.length) throw new BadRequestException('Dictate at least one bullet first.');

    // The book memory runs on what he said; when nothing fits the persona builds the twist from his mind.
    let recall = '';
    try {
      const r = await this.bookMemory.recall(bullets.join(' ').slice(0, 2400), {});
      recall = r.block;
    } catch {
      /* optional */
    }
    const dynamicContext = [recall, buildTwistBrief([])].filter(Boolean).join('\n\n');
    const systemPrompt = this.skills.get('script').buildSystemPrompt({} as any, {} as any);
    const { content } = await this.openai.chat({
      messages: [{ role: 'user', content: buildDictationScriptRequest(bullets, title) }],
      systemPromptOverride: systemPrompt,
      dynamicContext,
      temperature: 0.7,
      maxCompletionTokens: 12000,
    });

    const cleaned = splitLongRails(sanitizeSpokenScript(closeScriptMarkers(content)).content);
    if (!isFullScript(cleaned)) {
      this.logger.warn('Dictation: the model did not return a full script');
      throw new BadRequestException('The script could not be written this time. Please press Generate again.');
    }
    const start = cleaned.indexOf('<!-- SCRIPT_START -->');
    const end = cleaned.indexOf('<!-- SCRIPT_END -->', start);
    const block = cleaned.slice(start, end === -1 ? undefined : end + '<!-- SCRIPT_END -->'.length);
    const titleLine = block.match(/^#\s*SCRIPT TITLE:\s*(.+)$/m);
    return { title: (title || '').trim().toUpperCase() || titleLine?.[1]?.trim() || 'MY SCRIPT', fullScript: block };
  }

  /**
   * Both, saved into a chat as one exchange so the chat can go on with what it does normally (videos to
   * show, SEO, thumbnail). His bullet card comes first, the full script after it.
   */
  async addToThread(threadId: string, rawBullets: unknown, title?: string) {
    const bullets = cleanBullets(rawBullets);
    if (!bullets.length) throw new BadRequestException('Dictate at least one bullet first.');
    const thread = await this.threadModel.findById(threadId);
    if (!thread) throw new NotFoundException(`Thread ${threadId} not found`);

    const [card, script] = await Promise.all([
      this.bulletsCard(bullets, title),
      this.fullScript(bullets, title).catch((err) => {
        this.logger.warn(`Dictation: full script failed for thread ${threadId} (${err?.message || err}); saving the bullet card only`);
        return null;
      }),
    ]);

    const now = new Date();
    const userMsg = {
      role: 'user' as const,
      content: `My dictated bullets:\n${bullets.map((b, i) => `${i + 1}. ${b}`).join('\n')}`,
      createdAt: now,
    };
    const content = script ? `${card.bulletCard}\n\n${script.fullScript}\n` : `${card.bulletCard}\n`;
    const assistantMsg = {
      role: 'assistant' as const,
      content,
      metadata: { category: 'script', dualScript: true, dictation: true },
      createdAt: new Date(now.getTime() + 1),
    };
    const update: any = { $push: { messages: { $each: [userMsg, assistantMsg] } }, $set: { updatedAt: new Date() } };
    // A chat that holds nothing else is named after the bullets.
    if (!thread.messages?.length) update.$set.title = (script?.title || card.title).slice(0, 100);
    await this.threadModel.findByIdAndUpdate(new Types.ObjectId(threadId), update);
    return { title: script?.title || card.title, bulletCard: card.bulletCard, fullScript: script?.fullScript || null, hasScript: !!script };
  }
}
