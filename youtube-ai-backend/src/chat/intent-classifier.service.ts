import { Injectable, Logger } from '@nestjs/common';
import { OpenAIService } from '../openai/openai.service';
import { SkillRegistry } from './skills/skill-registry';

export type PackageMode = 'audit' | 'new';

export interface IntentClassification {
  /** Skill category (general | script | seo | thumbnail | package | image | competitor | trends | ideas | outline | analysis). */
  intent: string;
  /** Only set when intent === 'package': audit = re-packaging an existing video, new = fresh concept. */
  mode?: PackageMode;
  /** 0-1 routing confidence. Auto-thumbnail generation only fires at >= AUTO_IMAGE_MIN_CONFIDENCE. */
  confidence: number;
  source: 'llm' | 'fastpath' | 'fallback';
}

/** Auto image generation fires only when the router is this sure about the ask. */
export const AUTO_IMAGE_MIN_CONFIDENCE = 0.8;

const KNOWN_INTENTS = new Set([
  'general',
  'script',
  'seo',
  'thumbnail',
  'package',
  'image',
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
- "image": scene / b-roll / background image generation.
- "general": channel strategy, questions, chit-chat, AND topic recommendation ("what should I post next", "give me a topic suggestion") EVEN IF it mentions thumbnails or a title.

RULES:
- A topic-recommendation ask ("what should I post next", "what video should I do next") is ALWAYS "general", even when it mentions packaging.
- Asking for a title together with a thumbnail = "package", never "thumbnail" or "seo".
- A pasted script plus "make me a thumbnail/title/SEO for this" = "package" (the user wants the bundle for that specific video).

"mode" (only when intent is "package", otherwise null):
- "audit": the message refers to an EXISTING or already-uploaded video (a YouTube link, "this video", "my X video", "the one I posted", "repackage", "fix my packaging", "why isn't this working").
- "new": the message describes a video that does NOT exist yet (a new topic, a pasted new script, "the video I'm getting ready to put in").
- Otherwise use "new".

"confidence": 0.0 to 1.0 — how certain you are of the category.

Return ONLY this JSON shape:
{"intent":"package","mode":"new","confidence":0.92}`;

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
        const mode: PackageMode | undefined =
          intent === 'package' && parsed.mode === 'audit' ? 'audit' : 'new';
        const result: IntentClassification = {
          intent,
          confidence: Number.isFinite(confidence) ? confidence : 0.7,
          source: 'llm',
          ...(intent === 'package' ? { mode } : {}),
        };
        this.logger.log(
          `[Intent] "${message.slice(0, 80)}" -> ${result.intent}${
            result.mode ? `/${result.mode}` : ''
          } (conf ${result.confidence.toFixed(2)})`,
        );
        return result;
      }
      this.logger.warn(`[Intent] Unusable LLM routing result: ${raw?.slice(0, 200)}`);
    } catch (err: any) {
      this.logger.warn(
        `[Intent] LLM routing failed, regex fallback: ${err?.message || err}`,
      );
    }

    return {
      intent: this.skillRegistry.classifyIntent(message, prev),
      confidence: 0.5,
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
