import { Inject, Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import * as fs from 'fs';
import { z } from 'zod';
import { AppConfig, CONFIG } from '../config/config';
import { toStrictJsonSchema } from './json-schema';
import { toOpenAiCreditsError } from '../common/errors';
import { parsePairs, taskKind } from './task-routing';

export interface UsageDelta {
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  sttSeconds?: number;
  embedTokens?: number;
  calls?: number;
  /** AI images generated (thumbnail scenes). */
  images?: number;
  /** The model that produced these tokens (for the per-model cost split). */
  model?: string;
}
export type UsageSink = (delta: UsageDelta) => Promise<void> | void;

export interface JsonCallOptions<T extends z.ZodType> {
  /** Short label for logs, e.g. "mining:abc123". */
  task: string;
  tier?: 'primary' | 'fast';
  system: string;
  user: string;
  schema: T;
  schemaName: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  maxCompletionTokens?: number;
  usage?: UsageSink;
}

export interface WhisperResult {
  text: string;
  language: string;
  duration: number;
  segments: Array<{ start: number; end: number; text: string; no_speech_prob?: number; avg_logprob?: number; compression_ratio?: number }>;
  words: Array<{ word: string; start: number; end: number }>;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: OpenAI;
  private readonly taskModels: Map<string, string>;
  private readonly taskEffort: Map<string, string>;

  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {
    this.taskModels = parsePairs(cfg.OPENAI_REEL_TASK_MODELS);
    this.taskEffort = parsePairs(cfg.OPENAI_REEL_TASK_EFFORT);
    this.client = new OpenAI({
      apiKey: cfg.OPENAI_API_KEY,
      baseURL: cfg.OPENAI_BASE_URL || undefined,
      timeout: 15 * 60_000,
      maxRetries: 3,
    });
  }

  get primaryModel() {
    return this.cfg.OPENAI_REEL_MODEL;
  }

  /** Runs an OpenAI call; an out-of-credits 429 becomes a fatal OpenAiCreditsError with a client-readable message. */
  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw toOpenAiCreditsError(err) ?? err;
    }
  }

  /**
   * Structured output with a strict JSON schema, validated again with zod.
   * One self-repair attempt is made if the model's JSON fails validation.
   */
  async generateJson<T extends z.ZodType>(opts: JsonCallOptions<T>): Promise<z.infer<T>> {
    const kind = taskKind(opts.task);
    const model = this.taskModels.get(kind) ?? (opts.tier === 'fast' ? this.cfg.OPENAI_REEL_FAST_MODEL : this.cfg.OPENAI_REEL_MODEL);
    const effort = this.taskEffort.get(kind) ?? opts.reasoningEffort ?? this.cfg.OPENAI_REEL_REASONING_EFFORT;
    const jsonSchema = toStrictJsonSchema(opts.schema);
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ];

    for (let attempt = 1; attempt <= 2; attempt++) {
      const started = Date.now();
      const res = await this.guard(() => this.client.chat.completions.create({
        model,
        messages,
        response_format: {
          type: 'json_schema',
          json_schema: { name: opts.schemaName, strict: true, schema: jsonSchema },
        },
        reasoning_effort: effort as any,
        ...(opts.maxCompletionTokens ? { max_completion_tokens: opts.maxCompletionTokens } : {}),
      } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming));

      const usage = res.usage;
      await opts.usage?.({
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
        reasoningTokens: (usage as any)?.completion_tokens_details?.reasoning_tokens ?? 0,
        calls: 1,
        model,
      });
      this.logger.log(
        `[${opts.task}] ${model} ${Date.now() - started}ms in=${usage?.prompt_tokens ?? '?'} out=${usage?.completion_tokens ?? '?'}`,
      );

      const choice = res.choices[0];
      if (choice?.message?.refusal) throw new Error(`Model refused (${opts.task}): ${choice.message.refusal}`);
      if (choice?.finish_reason === 'length') throw new Error(`Model output truncated (${opts.task})`);
      const content = choice?.message?.content ?? '';

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = undefined;
      }
      const check = opts.schema.safeParse(parsed);
      if (check.success) return check.data;

      const problem = check.error.issues
        .slice(0, 8)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      this.logger.warn(`[${opts.task}] validation failed (attempt ${attempt}): ${problem}`);
      if (attempt === 2) throw new Error(`Invalid AI output for ${opts.task}: ${problem}`);
      messages.push({ role: 'assistant', content });
      messages.push({
        role: 'user',
        content: `Your JSON failed validation: ${problem}. Return the complete corrected JSON that follows every rule.`,
      });
    }
    throw new Error('unreachable');
  }

  /** Plain conversational answer (markdown). Used by the campaign assistant. */
  async chat(opts: {
    task: string;
    system: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    reasoningEffort?: string;
    maxCompletionTokens?: number;
  }): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
    const started = Date.now();
    const res = await this.guard(() => this.client.chat.completions.create({
      model: this.cfg.OPENAI_REEL_MODEL,
      messages: [{ role: 'system', content: opts.system }, ...opts.messages],
      reasoning_effort: (opts.reasoningEffort ?? 'low') as any,
      max_completion_tokens: opts.maxCompletionTokens ?? 4000,
    } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming));
    const usage = res.usage;
    this.logger.log(`[${opts.task}] ${this.cfg.OPENAI_REEL_MODEL} ${Date.now() - started}ms in=${usage?.prompt_tokens ?? '?'} out=${usage?.completion_tokens ?? '?'}`);
    const choice = res.choices[0];
    if (choice?.message?.refusal) throw new Error(`Model refused (${opts.task})`);
    return { text: choice?.message?.content ?? '', promptTokens: usage?.prompt_tokens ?? 0, completionTokens: usage?.completion_tokens ?? 0 };
  }

  /** Live web research (OpenAI Responses API + web_search tool). */
  async webResearch(opts: { task: string; system: string; user: string; usage?: UsageSink }): Promise<{
    text: string;
    sources: Array<{ title: string; url: string }>;
  }> {
    const started = Date.now();
    const model = this.taskModels.get(taskKind(opts.task)) ?? this.cfg.OPENAI_REEL_MODEL;
    const res: any = await this.guard(() => this.client.responses.create({
      model,
      instructions: opts.system,
      input: opts.user,
      tools: [{ type: 'web_search' } as any],
      reasoning: { effort: 'medium' },
    } as any));
    await opts.usage?.({
      promptTokens: res.usage?.input_tokens ?? 0,
      completionTokens: res.usage?.output_tokens ?? 0,
      reasoningTokens: res.usage?.output_tokens_details?.reasoning_tokens ?? 0,
      calls: 1,
      model,
    });
    this.logger.log(`[${opts.task}] web research ${Date.now() - started}ms`);

    const sources = new Map<string, { title: string; url: string }>();
    for (const item of res.output ?? []) {
      if (item.type !== 'message') continue;
      for (const part of item.content ?? []) {
        for (const ann of part.annotations ?? []) {
          if (ann.type === 'url_citation' && ann.url) sources.set(ann.url, { title: ann.title || ann.url, url: ann.url });
        }
      }
    }
    return { text: res.output_text ?? '', sources: [...sources.values()].slice(0, 25) };
  }

  /** Speech-to-text with word + segment timestamps. */
  async transcribe(filePath: string, prompt: string, usage?: UsageSink): Promise<WhisperResult> {
    const res: any = await this.guard(() => this.client.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: this.cfg.OPENAI_STT_MODEL,
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
      // An empty hint is left out entirely: a hint that repeats the expected text makes Whisper drop words.
      ...(prompt ? { prompt: prompt.slice(0, 800) } : {}),
    } as any));
    await usage?.({ sttSeconds: Math.round(res.duration ?? 0), calls: 1 });
    return {
      text: res.text ?? '',
      language: res.language ?? 'english',
      duration: res.duration ?? 0,
      segments: res.segments ?? [],
      words: res.words ?? [],
    };
  }

  async embed(texts: string[], usage?: UsageSink): Promise<number[][]> {
    if (!texts.length) return [];
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 96) {
      const batch = texts.slice(i, i + 96).map((t) => t.slice(0, 6000) || ' ');
      const res = await this.guard(() => this.client.embeddings.create({ model: this.cfg.OPENAI_EMBED_MODEL, input: batch }));
      await usage?.({ embedTokens: res.usage?.total_tokens ?? 0 });
      out.push(...res.data.map((d) => d.embedding));
    }
    return out;
  }
}
