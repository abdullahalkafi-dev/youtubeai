import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IntentClassifierService } from '../intent-classifier.service';
import { StudioService } from './studio.service';
import { SendMessageDto } from '../dto/chat.dto';

export type Route = 'studio' | 'answer';

/** Intents that produce a deliverable and therefore need the studio. */
const STUDIO_INTENTS = new Set([
  'script',
  'package',
  'thumbnail',
  'seo',
  'image',
  'outline',
]);
const STUDIO_SKILLS = STUDIO_INTENTS;
const DELIVERABLE_WORDS =
  /\b(script|title|thumbnail|description|tags?|hashtags?|package|outline|write|make|create|generate|rewrite|format|edit|change|add|remove|fix|redo|repackage|draft|design)\b/i;
export const RECOMMENDATION =
  /\b(what|which)\b[^.?!]{0,40}\b(should i|do i|to)\b[^.?!]{0,30}\b(post|make|upload|film|record|do)\b|\bnext video\b|\bvideo idea|\btopic (suggestion|idea)/i;
const QUESTION_START =
  /^\s*(what|why|how|who|when|where|which|explain|define|does|do|is|are|can|could|should|tell me)\b/i;
/** Words that signal feedback on something the studio just produced. */
const FEEDBACK =
  /\b(make|add|remove|change|more|less|bigger|smaller|shorter|longer|rewrite|redo|fix|swap|replace|use|try|instead|tears?|emotion\w*|text|headline|title|image|thumbnail|script|bandage|expression|face|background|color|colour)\b/i;

/**
 * Deterministic part of routing. Returns undefined when the classifier is needed.
 * Pure so it can be tested without a database or model.
 */
export function preRoute(input: {
  message: string;
  skill?: string;
  hasTarget: boolean;
  lastAssistantWasStudio: boolean;
}): Route | undefined {
  const message = input.message.trim();
  if (input.hasTarget) return 'studio';
  if (input.skill && STUDIO_SKILLS.has(input.skill)) return 'studio';
  // A pasted script or attachment text is a deliverable request even when short on words.
  if (
    message.length > 1500 ||
    /<!--\s*SCRIPT_START|\[ACTIVE SCRIPT CONTEXT\]|\[ATTACHMENT CONTENT\]/i.test(
      message,
    )
  )
    return 'studio';
  if (RECOMMENDATION.test(message)) return 'studio';
  if (input.lastAssistantWasStudio && FEEDBACK.test(message)) return 'studio';
  if (
    message.length <= 160 &&
    QUESTION_START.test(message) &&
    !DELIVERABLE_WORDS.test(message)
  )
    return 'answer';
  return undefined;
}

export function routeFromIntent(intent: string, message: string): Route {
  if (STUDIO_INTENTS.has(intent)) return 'studio';
  if (intent === 'general' && RECOMMENDATION.test(message)) return 'studio';
  return 'answer';
}

@Injectable()
export class StudioRouter {
  private readonly logger = new Logger(StudioRouter.name);
  constructor(
    @InjectModel('Thread') private threads: Model<any>,
    private classifier: IntentClassifierService,
    private studio: StudioService,
  ) {}

  /** True when this message should run through the studio rather than the streaming chat path. */
  async useStudio(threadId: string, dto: SendMessageDto): Promise<boolean> {
    if (!(await this.studio.enabled(threadId))) return false;
    try {
      const thread: any = await this.threads
        .findById(threadId)
        .select({ messages: { $slice: -1 } })
        .lean();
      const last = thread?.messages?.[0];
      const lastAssistantWasStudio =
        last?.role === 'assistant' && !!last?.metadata?.runId;
      const quick = preRoute({
        message: dto.content,
        skill: dto.skill,
        hasTarget: !!(dto.targetArtifactId || dto.episodeId),
        lastAssistantWasStudio,
      });
      if (quick) return quick === 'studio';
      const result = await this.classifier.classify({
        message: dto.content,
        previousAssistantMessage: last?.role === 'assistant' ? last.content : undefined,
      });
      // A regex fallback means the model router failed: never risk dropping a deliverable.
      if (result.source === 'fallback') return true;
      return routeFromIntent(result.intent, dto.content) === 'studio';
    } catch (error: any) {
      this.logger.warn('Routing failed; using studio: ' + error.message);
      return true;
    }
  }
}
