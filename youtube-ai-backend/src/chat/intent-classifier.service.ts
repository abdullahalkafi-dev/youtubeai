import { Injectable, Logger } from '@nestjs/common';
import { OpenAIService } from '../openai/openai.service';
import { SkillRegistry } from './skills/skill-registry';
import { isPastedMaterial } from './script-guards';

export type PackageMode = 'audit' | 'new';

export interface IntentClassification {
  /** Skill category (general | script | seo | thumbnail | package | image | competitor | trends | ideas | outline | analysis). */
  intent: string;
  /** Only set when intent === 'package': audit = re-packaging an existing video, new = fresh concept. */
  mode?: PackageMode;
  /** 0-1 routing confidence. Auto-thumbnail generation only fires at >= AUTO_IMAGE_MIN_CONFIDENCE. */
  confidence: number;
  source: 'llm' | 'fastpath' | 'fallback';
  /** The client wants real video clips / footage; the reply stays a normal chat answer (skill general). */
  footage?: boolean;
}

/** Auto image generation fires only when the router is this sure about the ask. */
export const AUTO_IMAGE_MIN_CONFIDENCE = 0.8;

const THUMBNAIL_WORD = /\b(?:thumbnails?|thumbs?|cover\s*arts?)\b/i;
/** "make / generate / give me ... a thumbnail": an explicit ask, not a passing mention. */
const EXPLICIT_THUMBNAIL_ASK =
  /\b(?:make|generate|create|design|redesign|build|give\s+me|show\s+me|need|want)\b[^.?!\n]{0,40}\b(?:thumbnails?|thumbs?)\b/i;

/**
 * A thumbnail is never a scene picture. The router sometimes reads "generate thumbnail" as `image`
 * (a general chat answer with nothing rendered), so a message that names a thumbnail is moved to
 * the thumbnail skill. Every other category is left exactly as the router chose it.
 */
export function guardThumbnailIntent(message: string, intent: string): string {
  return intent === 'image' && THUMBNAIL_WORD.test(message || '') ? 'thumbnail' : intent;
}

/** "in bullets", "bullet form", "Outlaw bullets": the client's name for his bullet script. */
const BULLET_WORD = /\b(?:outlaw\s+)?bullets?\b/i;
/**
 * ...asked for as a story to tell (a story, a sample, a script, "write this"), not a passing mention:
 * "give me five comment questions in bullets" stays where the router put it.
 */
const WRITE_ASK = /\b(?:story|stories|sample|script|episode|video)\b|\bwrite\s+(?:this|it|that)\b/i;

/**
 * When the client asks for a story, sample or script "in bullets" he wants his bullet script, which
 * only the script skill writes (with its full twin). The router has sent such asks to `outline` or
 * `general`, which skip the persona's script rules and the second card. Only those two are moved.
 */
export function guardBulletIntent(message: string, intent: string): string {
  const text = message || '';
  if (intent !== 'outline' && intent !== 'general') return intent;
  return BULLET_WORD.test(text) && WRITE_ASK.test(text) && !isPastedMaterial(text) ? 'script' : intent;
}

/** Confidence for the regex fallback: an explicit thumbnail ask still earns the auto-image gate. */
export function fallbackConfidence(message: string, intent: string): number {
  return (intent === 'thumbnail' || intent === 'package') && EXPLICIT_THUMBNAIL_ASK.test(message || '')
    ? 0.85
    : 0.5;
}

const KNOWN_INTENTS = new Set([
  'general',
  'script',
  'seo',
  'thumbnail',
  'package',
  'image',
  'footage',
  'competitor',
  'trends',
  'ideas',
  'outline',
  'analysis',
]);

const CLASSIFIER_SYSTEM_PROMPT = `You are the intent router for a YouTube creation studio chat used by a prison-experience true-crime channel.

Classify the USER'S MESSAGE into exactly ONE category and return ONLY valid JSON.

CATEGORIES:
- "package": the user wants a COMPLETE ready-to-publish bundle for ONE specific video: title + description/tags + thumbnail concepts. Signals: "full package", "seo package", "package for X", "title AND thumbnail", "title, description and thumbnail", "give me everything to publish", "make the whole thing", "repackage this video", asking for a title plus a thumbnail in the same breath.
- "thumbnail": ONLY thumbnail/cover-art concepts, overlay text, colors, or expression tweaks (no full metadata ask).
- "seo": ONLY title/description/tags/hashtags (no thumbnail ask).
- "analysis": diagnose performance of existing content (CTR, why views dropped, autopsy) WITHOUT asking for replacement packaging.
- "script": write or edit a video script / teleprompter / cold open.
- "outline": structure, hooks, or outline for a script.
- "ideas": score, rate, or evaluate a video idea.
- "trends": trending topics or what is current.
- "competitor": what other channels are doing, content gaps.
- "footage": the user wants REAL video clips, news clips, b-roll or footage of a person, event or topic to use in their video ("give me clips of P Diddy for the background", "find footage of the arrest", "local news for this", "b-roll for the script"). Real videos, not generated pictures.
- "image": the user wants an AI-GENERATED picture or scene image made (not real video). A THUMBNAIL is never "image": "generate thumbnail", "make the thumbnail", "make me a thumbnail" are always "thumbnail" (or "package" with a title/SEO ask).
- "general": channel strategy, questions, chit-chat, AND topic recommendation ("what should I post next", "give me a topic suggestion") EVEN IF it mentions thumbnails or a title.

RULES:
- A topic-recommendation ask ("what should I post next", "what video should I do next") is ALWAYS "general", even when it mentions packaging.
- Asking for a title together with a thumbnail = "package", never "thumbnail" or "seo".
- A pasted script plus "make me a thumbnail/title/SEO for this" = "package" (the user wants the bundle for that specific video).
- Asking for a story, sample or script "in bullets", "in bullet form" or as "Outlaw bullets" = "script", never "outline".
- Asking to WRITE a script for a live stream, a live show, a long show or a video ("write up a 30 minute live", "script for my live today") = "script", even when the user also asks for clips or video to show.
- "footage" (boolean, any category): true whenever the user ALSO wants real video clips, news clips or b-roll ("and give me video for this", "plus clips I can show", "local news for it"). A script ask with clips is {"intent":"script","footage":true}. A clips-only ask is intent "footage".

"mode" (only when intent is "package", otherwise null):
- "audit": the message refers to an EXISTING or already-uploaded video (a YouTube link, "this video", "my X video", "the one I posted", "repackage", "fix my packaging", "why isn't this working").
- "new": the message describes a video that does NOT exist yet (a new topic, a pasted new script, "the video I'm getting ready to put in").
- Otherwise use "new".

"confidence": 0.0 to 1.0 — how certain you are of the category.

Return ONLY this JSON shape:
{"intent":"package","mode":"new","footage":false,"confidence":0.92}`;

@Injectable()
export class IntentClassifierService {
  private readonly logger = new Logger(IntentClassifierService.name);

  constructor(
    private readonly openaiService: OpenAIService,
    private readonly skillRegistry: SkillRegistry,
  ) {}

  /**
   * Always-LLM intent routing with two deterministic conversation-state
   * fast-paths (menu selection, thumbnail iteration) and a regex fallback
   * so chat NEVER breaks when the model call fails or times out.
   */
  async classify(params: {
    message: string;
    previousAssistantMessage?: string;
  }): Promise<IntentClassification> {
    const message = (params.message || '').trim();
    const prev = params.previousAssistantMessage;

    if (!message) {
      return { intent: 'general', confidence: 0.5, source: 'fallback' };
    }

    // Fast-path 1: single menu letter ("a", "option 2") resolved against the
    // previous assistant menu — state resolution, not intent, so no LLM call.
    const menuIntent = this.skillRegistry.resolveMenuSelection(message, prev);
    if (menuIntent) {
      return { intent: menuIntent, confidence: 0.6, source: 'fastpath' };
    }

    // Fast-path 2: follow-up iteration on existing thumbnail concepts.
    if (this.skillRegistry.isThumbnailIteration(message, prev)) {
      return { intent: 'thumbnail', confidence: 0.6, source: 'fastpath' };
    }

    // One retry when the model gives no usable answer (an empty reply or a timeout), before the regex fallback.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const llmPromise = this.openaiService.chatFast({
          systemPrompt: CLASSIFIER_SYSTEM_PROMPT,
          userMessage:
            `User message:\n"${message}"\n\n` +
            (prev
              ? `Previous assistant message (truncated):\n"${prev.slice(-1500)}"`
              : 'Previous assistant message: none'),
          temperature: 0,
          maxCompletionTokens: 250,
        });
        // Swallow late rejection if the timeout race below wins.
        llmPromise.catch(() => undefined);

        const raw = await this.withTimeout(llmPromise, 6000);
        const parsed = this.parseJsonSafe(raw);
        const intent = String(parsed?.intent || '').toLowerCase();
        if (parsed && KNOWN_INTENTS.has(intent)) {
          const confidence = this.clamp01(Number(parsed.confidence));
          const finalIntent = guardBulletIntent(
            message,
            guardThumbnailIntent(message, intent === 'footage' ? 'general' : intent),
          );
          const mode: PackageMode | undefined =
            finalIntent === 'package' && parsed.mode === 'audit' ? 'audit' : 'new';
          // Footage is a retrieval ask, not a skill: a clips-only ask answers as general, and a
          // script (or any other skill) with clips keeps its skill. Either way the footage pack is
          // loaded and no AI image is generated for it.
          const isFootage = intent === 'footage' || parsed.footage === true;
          const result: IntentClassification = {
            intent: finalIntent,
            confidence: Number.isFinite(confidence) ? confidence : 0.7,
            source: 'llm',
            ...(finalIntent === 'package' ? { mode } : {}),
            ...(isFootage ? { footage: true } : {}),
          };
          this.logger.log(
            `[Intent] "${message.slice(0, 80)}" -> ${result.intent}${
              result.mode ? `/${result.mode}` : ''
            } (conf ${result.confidence.toFixed(2)})`,
          );
          return result;
        }
        this.logger.warn(
          `[Intent] Unusable LLM routing result (attempt ${attempt}): ${raw?.slice(0, 200)}`,
        );
      } catch (err: any) {
        this.logger.warn(
          `[Intent] LLM routing failed (attempt ${attempt}): ${err?.message || err}`,
        );
      }
    }

    const fallbackIntent = guardBulletIntent(message, this.skillRegistry.classifyIntent(message, prev));
    return {
      intent: fallbackIntent,
      confidence: fallbackConfidence(message, fallbackIntent),
      source: 'fallback',
    };
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`intent classify timed out (${ms}ms)`)), ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  private parseJsonSafe(raw: string): any {
    try {
      return JSON.parse(raw.replace(/```json/gi, '').replace(/```/g, '').trim());
    } catch {
      const match = (raw || '').match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  private clamp01(n: number): number {
    if (!Number.isFinite(n)) return 0.7;
    return Math.min(1, Math.max(0, n));
  }
}
