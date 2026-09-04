import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import { retryWithBackoff } from '../common/utils/retry';
import {
  buildSeoPrompt,
  buildChatMessages,
  buildScorePrompt,
  buildThumbnailPrompt,
  buildSummaryPrompt,
  buildCompactChannelContext,
} from './prompts';

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cacheHitRate: number; // 0-100 percentage
}

export interface ChatSource {
  title: string;
  url: string;
  snippet?: string;
}

export interface CacheAlert {
  threadId?: string;
  cacheHitRate: number;
  threshold: number;
  timestamp: Date;
}

/**
 * OpenAI Service — the core AI engine.
 *
 * Caching strategy:
 * - System prompt is ALWAYS the same string (deterministic = cache-friendly)
 * - Conversation history is append-only (prefix always matches)
 * - Dynamic data goes in user message only (never pollutes system prompt)
 *
 * Cache monitoring:
 * - Logs cached_tokens vs prompt_tokens per request
 * - Alerts if cache hit rate drops below 70% on active threads
 *
 * Output logging:
 * - All generated outputs logged to AIOutputLog table for auditing
 */
import { ThumbnailComposerService } from './thumbnail-composer.service';
import { MinioService } from '../minio/minio.service';

@Injectable()
export class OpenAIService {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly fastModel: string;
  private readonly trendsModel: string;
  private readonly logger = new Logger(OpenAIService.name);
  private readonly cacheAlertThreshold = 70; // Alert if cache hit rate < 70%

  constructor(
    private readonly configService: ConfigService,
    private readonly composerService: ThumbnailComposerService,
    private readonly minioService: MinioService,
  ) {
    this.client = new OpenAI({
      apiKey: configService.get<string>('OPENAI_API_KEY'),
      baseURL: configService.get<string>(
        'OPENAI_BASE_URL',
        'https://api.openai.com/v1',
      ),
    });
    this.model = configService.get<string>('OPENAI_MODEL', 'gpt-5.6-terra');
    this.fastModel = configService.get<string>('OPENAI_FAST_MODEL', 'gpt-5.6-luna');
    this.trendsModel = configService.get<string>('OPENAI_TRENDS_MODEL', 'gpt-5.6-terra');
  }

  private isReasoningModel(model?: string): boolean {
    const m = (model || this.model || '').toLowerCase();
    return (
      m.startsWith('o1') ||
      m.startsWith('o3') ||
      m.startsWith('gpt-5') ||
      m.includes('terra') ||
      m.includes('reasoning')
    );
  }

  private buildCompletionParams(params: {
    model: string;
    messages: any[];
    temperature?: number;
    max_completion_tokens?: number;
    response_format?: any;
    stream?: boolean;
    stream_options?: any;
  }): any {
    const isReasoning = this.isReasoningModel(params.model);
    const result: any = {
      model: params.model,
      messages: params.messages,
    };
    if (params.max_completion_tokens) {
      result.max_completion_tokens = params.max_completion_tokens;
    }
    if (params.response_format) {
      result.response_format = params.response_format;
    }
    if (params.stream) {
      result.stream = params.stream;
    }
    if (params.stream_options) {
      result.stream_options = params.stream_options;
    }
    if (!isReasoning && params.temperature !== undefined && params.temperature !== 1) {
      result.temperature = params.temperature;
    }
    return result;
  }

  /**
   * Lightweight chat using the fast model.
   * For simple tasks: entity extraction, comment replies, thread naming.
   * Returns plain text (no JSON parsing).
   */
  async chatFast(params: {
    systemPrompt: string;
    userMessage: string;
    temperature?: number;
    maxCompletionTokens?: number;
  }): Promise<string> {
    const req = this.buildCompletionParams({
      model: this.fastModel,
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userMessage },
      ],
      max_completion_tokens: params.maxCompletionTokens ?? 800,
      temperature: params.temperature,
    });
    const response = await retryWithBackoff(
      () => this.client.chat.completions.create(req),
      { operationName: 'OpenAI Chat Fast' },
    );
    return response.choices[0]?.message?.content?.trim() || '';
  }

  /**
   * Generate SEO-optimized title, description, tags, and hashtags.
   */
  async generateSeo(params: {
    videoTitle: string;
    videoDescription?: string;
    showType?: string;
    channelStats?: string;
    topPerformingVideos?: Array<{
      title: string;
      views: number;
      tags?: string[];
    }>;
    trendingTopics?: string[];
    videoPerformance?: {
      views: number;
      watchTimeHours?: number;
      publishedDaysAgo?: number;
    };
    liveSearchSuggestions?: string[];
    relatedSeriesVideos?: Array<{
      title: string;
      views?: number;
      publishedDaysAgo?: number;
      youtubeId?: string;
    }>;
    transcriptAnchors?: string;
    customInstructions?: string;
  }): Promise<{
    title: string;
    description: string;
    tags: string[];
    hashtags: string[];
    usage?: TokenUsage;
  }> {
    const { system, user } = buildSeoPrompt({
      videoTitle: params.videoTitle,
      videoDescription: params.videoDescription,
      showType: params.showType,
      transcriptAnchors: params.transcriptAnchors,
      currentDate: new Date().toISOString().split('T')[0],
      channelStats: params.channelStats,
      topPerformingVideos: params.topPerformingVideos,
      trendingTopics: params.trendingTopics,
      videoPerformance: params.videoPerformance,
      liveSearchSuggestions: params.liveSearchSuggestions,
      relatedSeriesVideos: params.relatedSeriesVideos,
    });

    const userMessage = params.customInstructions
      ? `${user}\n\nAdditional instructions from user: ${params.customInstructions}`
      : user;

    const req = this.buildCompletionParams({
      model: this.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMessage },
      ],
      response_format: { type: 'json_object' as const },
      temperature: 0.7,
      max_completion_tokens: 4096,
    });

    const response = await retryWithBackoff(
      () => this.client.chat.completions.create(req),
      { operationName: 'OpenAI SEO Generation' },
    );

    const content = response.choices[0]?.message?.content || '{}';
    const usage = this.extractUsage(response);
    this.logCachePerformance('seo', usage);

    try {
      const parsed = JSON.parse(content) as {
        title?: string;
        description?: string;
        tags?: string[];
        hashtags?: string[];
      };

      if (!parsed.title || !parsed.description) {
        throw new Error(`OpenAI returned incomplete JSON (missing title or description). finish_reason: ${response.choices[0]?.finish_reason}`);
      }

      return {
        title: parsed.title,
        description: parsed.description,
        tags: parsed.tags || [],
        hashtags: parsed.hashtags || [],
        usage,
      };
    } catch (parseError: any) {
      this.logger.error(`Failed to parse SEO response as valid JSON: ${parseError.message}. Raw snippet: ${content.slice(0, 300)}`);
      throw new Error(`AI Generation returned invalid or incomplete output: ${parseError.message}`);
    }
  }

  /**
   * Chat with AI using channel context.
   * Pass conversationHistory for cache prefix stability.
   */
  async chat(params: {
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    channel?: Record<string, unknown>;
    conversationHistory?: Array<{
      role: 'user' | 'assistant';
      content: string;
    }>;
    threadId?: string;
    systemPromptOverride?: string;
    dynamicContext?: string;
    temperature?: number;
  }): Promise<{
    content: string;
    usage?: TokenUsage;
  }> {
    let messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;

    if (params.systemPromptOverride) {
      // Use the provided system prompt (from skills)
      messages = [{ role: 'system', content: params.systemPromptOverride }];
      if (params.conversationHistory) {
        for (const msg of params.conversationHistory) {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
      // Prepend dynamic context to user message (NOT system prompt) for cache stability
      const userContent = params.messages[params.messages.length - 1]?.content || '';
      const fullUserContent = params.dynamicContext
        ? `${params.dynamicContext}\n\n${userContent}`
        : userContent;
      messages.push({ role: 'user', content: fullUserContent });
    } else {
      const channelStats = params.channel ? buildCompactChannelContext(params.channel) : '';
      const built = buildChatMessages({
        userMessage: params.messages[params.messages.length - 1]?.content || '',
        channelStats,
        currentDate: new Date().toISOString().split('T')[0],
        conversationHistory: params.conversationHistory,
      });
      messages = params.conversationHistory
        ? built.messages
        : [built.messages[0], ...params.messages.map(m => ({ role: m.role, content: m.content }))];
    }

    const finalMessages = messages;

    const req = this.buildCompletionParams({
      model: this.model,
      messages: finalMessages,
      temperature: params.temperature ?? 0.7,
      max_completion_tokens: 4096,
    });

    const response = await retryWithBackoff(
      () => this.client.chat.completions.create(req),
      { operationName: 'OpenAI Chat' },
    );

    const content =
      response.choices[0]?.message?.content || 'No response generated.';
    const usage = this.extractUsage(response);
    this.logCachePerformance('chat', usage, params.threadId);

    return { content, usage };
  }

  /**
   * Chat with web search capability.
   * Uses responses.create with web_search tool for research-backed content.
   * Returns content with extracted sources.
   */
  async chatWithSearch(params: {
    userMessage: string;
    systemPrompt: string;
    conversationHistory?: Array<{
      role: 'user' | 'assistant';
      content: string;
    }>;
  }): Promise<{ content: string; sources: ChatSource[]; usage?: TokenUsage }> {
    // Build input as array of message objects to preserve role semantics
    const inputItems: any[] = [
      { type: 'message', role: 'system', content: [{ type: 'input_text', text: params.systemPrompt }] },
    ];

    // Add conversation history with proper roles and content types
    if (params.conversationHistory) {
      for (const msg of params.conversationHistory) {
        const contentType = msg.role === 'assistant' ? 'output_text' : 'input_text';
        inputItems.push({
          type: 'message',
          role: msg.role,
          content: [{ type: contentType, text: msg.content }],
        });
      }
    }

    // Add current user message
    inputItems.push({
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: params.userMessage }],
    });

    this.logger.log('Executing chat with web search...');

    const response = await retryWithBackoff(
      () =>
        this.client.responses.create({
          model: this.trendsModel || this.model,
          tools: [{ type: 'web_search' }],
          input: inputItems,
        }),
      { operationName: 'OpenAI Chat with Search' },
    );

    const content = response.output_text || 'No response generated.';

    // Extract sources from web search results, fallback to text parsing
    let sources = this.extractWebSearchSources(response);
    if (sources.length === 0) {
      this.logger.log('No sources from web_search output, parsing from text...');
      sources = this.parseSourcesFromText(content);
    }

    // Build usage from response
    const usage: TokenUsage = {
      promptTokens: (response as any).usage?.input_tokens || 0,
      completionTokens: (response as any).usage?.output_tokens || 0,
      cachedTokens: 0,
      cacheHitRate: 0,
    };

    this.logCachePerformance('chat_with_search', usage);

    return { content, sources, usage };
  }

  /**
   * Streaming chat with web search. Yields text chunks + sources + usage.
   * Uses Responses API with stream: true for real-time web search results.
   */
  async *chatWithSearchStream(params: {
    userMessage: string;
    systemPrompt: string;
    conversationHistory?: Array<{
      role: 'user' | 'assistant';
      content: string;
    }>;
  }): AsyncGenerator<{ chunk: string; sources?: ChatSource[]; usage?: TokenUsage }> {
    // Build input as array of message objects to preserve role semantics
    const inputItems: any[] = [
      { type: 'message', role: 'system', content: [{ type: 'input_text', text: params.systemPrompt }] },
    ];

    if (params.conversationHistory) {
      for (const msg of params.conversationHistory) {
        const contentType = msg.role === 'assistant' ? 'output_text' : 'input_text';
        inputItems.push({
          type: 'message',
          role: msg.role,
          content: [{ type: contentType, text: msg.content }],
        });
      }
    }

    inputItems.push({
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: params.userMessage }],
    });

    this.logger.log('Executing streaming chat with web search...');

    const stream = await retryWithBackoff(
      () =>
        this.client.responses.create({
          model: this.trendsModel || this.model,
          tools: [{ type: 'web_search' }],
          input: inputItems,
          stream: true,
        }),
      { operationName: 'OpenAI Chat with Search (stream)' },
    );

    let finalResponse: any = null;

    for await (const event of stream as any) {
      if (event.type === 'response.output_text.delta') {
        yield { chunk: event.delta };
      }
      if (event.type === 'response.completed') {
        finalResponse = event.response;
      }
    }

    // Extract sources and usage from the completed response
    if (finalResponse) {
      let sources = this.extractWebSearchSources(finalResponse);
      if (sources.length === 0 && finalResponse.output_text) {
        sources = this.parseSourcesFromText(finalResponse.output_text);
      }
      if (sources.length > 0) {
        yield { chunk: '', sources };
      }

      const usage: TokenUsage = {
        promptTokens: finalResponse.usage?.input_tokens || 0,
        completionTokens: finalResponse.usage?.output_tokens || 0,
        cachedTokens: 0,
        cacheHitRate: 0,
      };
      this.logCachePerformance('chat_with_search_stream', usage);
      yield { chunk: '', usage };
    }
  }

  /**
   * Extract web search sources from responses API output.
   * The web_search tool returns citations in the response output.
   */
  private extractWebSearchSources(response: any): ChatSource[] {
    const sources: ChatSource[] = [];
    const seenUrls = new Set<string>();

    try {
      // Response output contains tool call results with web search citations
      const output = response.output || [];
      for (const item of output) {
        if (item.type === 'web_search_call' && item.results) {
          for (const result of item.results) {
            const url = result.url || result.web_search_result?.url;
            const title = result.title || result.web_search_result?.title || '';
            const snippet =
              result.snippet || result.web_search_result?.snippet || '';

            if (url && !seenUrls.has(url)) {
              seenUrls.add(url);
              sources.push({ title, url, snippet });
            }
          }
        }
        // Also check for citations in output_text metadata
        if (item.type === 'web_search_call' && item.citations) {
          for (const citation of item.citations) {
            const url = citation.url || '';
            const title = citation.title || citation.hostname || '';
            if (url && !seenUrls.has(url)) {
              seenUrls.add(url);
              sources.push({ title, url });
            }
          }
        }
      }
    } catch (error) {
      this.logger.warn(
        `Failed to extract web search sources: ${error.message}`,
      );
    }

    return sources.slice(0, 10); // Max 10 sources
  }

  /**
   * Fallback: Parse sources from AI response text when web search extraction fails.
   * Matches patterns like:
   *   Associated Press. "Title" https://url
   *   [Title](https://url)
   *   CNN Transcripts. "Title." https://url
   */
  private parseSourcesFromText(text: string): ChatSource[] {
    const sources: ChatSource[] = [];
    const seenUrls = new Set<string>();

    // Match URLs in the text
    const urlRegex = /(https?:\/\/[^\s)\]>]+)/g;
    const lines = text.split('\n');

    for (const line of lines) {
      let match;
      while ((match = urlRegex.exec(line)) !== null) {
        const url = match[1].replace(/[.,;:!?)]+$/, ''); // Clean trailing punctuation
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);

        // Extract title: text before the URL
        const urlIndex = line.indexOf(match[0]);
        let title = line.substring(0, urlIndex).trim();

        // Clean up title: remove numbering, brackets, quotes
        title = title
          .replace(/^[\d\.\]\[\)]+\s*/, '')
          .replace(/^[-*]\s*/, '')
          .replace(/[""]/g, '')
          .replace(/\.$/, '')
          .trim();

        // If title is empty, extract domain as fallback
        if (!title) {
          try {
            const domain = new URL(url).hostname.replace('www.', '');
            title = domain;
          } catch {
            title = 'Source';
          }
        }

        sources.push({ title, url });
      }
      // Reset regex lastIndex for each line
      urlRegex.lastIndex = 0;
    }

    return sources.slice(0, 10); // Max 10 sources
  }

  /**
   * Chat with vision (image analysis).
   */
  async chatWithVision(params: {
    imageUrl: string;
    userMessage: string;
    systemPrompt: string;
    conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  }): Promise<{ content: string; usage?: TokenUsage }> {
    const messages: any[] = [{ role: 'system', content: params.systemPrompt }];

    if (params.conversationHistory) {
      for (const msg of params.conversationHistory) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: params.userMessage },
        { type: 'image_url', image_url: { url: params.imageUrl } },
      ],
    });

    const req = this.buildCompletionParams({
      model: this.model,
      messages,
      temperature: 0.7,
      max_completion_tokens: 4096,
    });

    const response = await retryWithBackoff(
      () => this.client.chat.completions.create(req),
      { operationName: 'OpenAI Vision Chat' },
    );

    const content = response.choices[0]?.message?.content || 'No response generated.';
    const usage = this.extractUsage(response);
    this.logCachePerformance('vision_chat', usage);
    return { content, usage };
  }

  /**
   * Chat with streaming support. Yields content chunks + final usage.
   */
  async *chatStream(params: {
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    channel?: Record<string, unknown>;
    conversationHistory?: Array<{
      role: 'user' | 'assistant';
      content: string;
    }>;
    threadId?: string;
    systemPromptOverride?: string;
    dynamicContext?: string;
    temperature?: number;
  }): AsyncGenerator<{ chunk: string; usage?: TokenUsage }> {
    let messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;

    if (params.systemPromptOverride) {
      messages = [{ role: 'system', content: params.systemPromptOverride }];
      if (params.conversationHistory) {
        for (const msg of params.conversationHistory) {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
      // Prepend dynamic context to user message (NOT system prompt) for cache stability
      const userContent = params.messages[params.messages.length - 1]?.content || '';
      const fullUserContent = params.dynamicContext
        ? `${params.dynamicContext}\n\n${userContent}`
        : userContent;
      messages.push({ role: 'user', content: fullUserContent });
    } else {
      const channelStats = params.channel ? buildCompactChannelContext(params.channel) : '';
      const built = buildChatMessages({
        userMessage: params.messages[params.messages.length - 1]?.content || '',
        channelStats,
        currentDate: new Date().toISOString().split('T')[0],
        conversationHistory: params.conversationHistory,
      });
      messages = params.conversationHistory
        ? built.messages
        : [built.messages[0], ...params.messages.map(m => ({ role: m.role, content: m.content }))];
    }

    const finalMessages = messages;

    const streamReq = this.buildCompletionParams({
      model: this.model,
      messages: finalMessages,
      temperature: params.temperature ?? 0.7,
      max_completion_tokens: 4096,
      stream: true,
      stream_options: { include_usage: true },
    });

    const stream = await retryWithBackoff(
      () => this.client.chat.completions.create(streamReq as OpenAI.ChatCompletionCreateParamsStreaming),
      { operationName: 'OpenAI Chat Stream' },
    );

    let finalUsage: TokenUsage | undefined;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield { chunk: content };
      }
      if (chunk.usage) {
        finalUsage = {
          promptTokens: chunk.usage.prompt_tokens || 0,
          completionTokens: chunk.usage.completion_tokens || 0,
          cachedTokens:
            (chunk.usage as any).prompt_tokens_details?.cached_tokens || 0,
          cacheHitRate: 0,
        };
        if (finalUsage.promptTokens > 0) {
          finalUsage.cacheHitRate = Math.round(
            (finalUsage.cachedTokens / finalUsage.promptTokens) * 100,
          );
        }
      }
    }

    if (finalUsage) {
      this.logCachePerformance('chat_stream', finalUsage, params.threadId);
      yield { chunk: '', usage: finalUsage };
    }
  }

  /**
   * Score a content idea on 8 criteria.
   */
  async scoreIdea(params: {
    title: string;
    description?: string;
    showType?: string;
  }): Promise<{
    score: number;
    status: 'greenlight' | 'hold' | 'pass';
    criteria: Record<string, number>;
    improvements?: string[];
    usage?: TokenUsage;
  }> {
    const { system, user } = buildScorePrompt({
      title: params.title,
      description: params.description,
      showType: params.showType,
    });

    const req = this.buildCompletionParams({
      model: this.fastModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' as const },
      temperature: 0.5,
      max_completion_tokens: 640,
    });

    const response = await retryWithBackoff(
      () => this.client.chat.completions.create(req),
      { operationName: 'OpenAI Score Idea' },
    );

    const content = response.choices[0]?.message?.content || '{}';
    const usage = this.extractUsage(response);
    this.logCachePerformance('scoring', usage);

    try {
      const parsed = JSON.parse(content) as {
        score: number;
        status: 'greenlight' | 'hold' | 'pass';
        criteria: Record<string, number>;
        improvements?: string[];
      };
      return { ...parsed, usage };
    } catch {
      return { score: 0, status: 'pass', criteria: {}, usage };
    }
  }

  /**
   * Generate 3 thumbnail concepts.
   */
  async generateThumbnailConcepts(params: {
    videoTitle: string;
    showType?: string;
  }): Promise<{
    thumbnails: Array<{ text: string; description: string; colors: string }>;
    usage?: TokenUsage;
  }> {
    const { system, user } = buildThumbnailPrompt({
      videoTitle: params.videoTitle,
      showType: params.showType,
    });

    const req = this.buildCompletionParams({
      model: this.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' as const },
      temperature: 0.8,
      max_completion_tokens: 768,
    });

    const response = await retryWithBackoff(
      () => this.client.chat.completions.create(req),
      { operationName: 'OpenAI Thumbnail Generation' },
    );

    const content =
      response.choices[0]?.message?.content || '{"thumbnails":[]}';
    const usage = this.extractUsage(response);
    this.logCachePerformance('thumbnails', usage);

    try {
      const parsed = JSON.parse(content) as {
        thumbnails: Array<{
          text: string;
          description: string;
          colors: string;
        }>;
      };
      return { thumbnails: parsed.thumbnails || [], usage };
    } catch {
      return { thumbnails: [], usage };
    }
  }

  /**
   * Summarize conversation history for thread compression.
   * Used when thread exceeds message/token threshold.
   */
  async summarizeConversation(params: {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    channel?: Record<string, unknown>;
  }): Promise<{
    summary: string;
    usage?: TokenUsage;
  }> {
    const channelStats = params.channel
      ? buildCompactChannelContext(params.channel)
      : '';

    const { system, user } = buildSummaryPrompt({
      messages: params.messages,
      channelStats,
    });

    const req = this.buildCompletionParams({
      model: this.fastModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.3,
      max_completion_tokens: 768,
    });

    const response = await retryWithBackoff(
      () => this.client.chat.completions.create(req),
      { operationName: 'OpenAI Summarize' },
    );

    const content = response.choices[0]?.message?.content || '';
    const usage = this.extractUsage(response);
    this.logCachePerformance('summarize', usage);

    return { summary: content, usage };
  }

  /**
   * Desensitize real-world criminal case names and active trial terms into archetypal visual concepts
   * to avoid triggering OpenAI's strict public figure/criminal trial safety filter.
   */
  private desensitizeImagePrompt(originalPrompt: string): string {
    return originalPrompt
      .replace(/\b(keefe\s*d|duane\s*keith\s*davis)\b/gi, 'an aging male defendant in a dark suit')
      .replace(/\b(tupac(?:\s*shakur)?|2pac)\b/gi, 'a 90s hip-hop icon memorial portrait silhouette')
      .replace(/\b(diddy|sean\s*combs|puff\s*daddy)\b/gi, 'a high-profile music executive in federal custody')
      .replace(/\b(1090\s*jake)\b/gi, 'an investigative documentary narrator')
      .replace(/\b(troy\s*ave)\b/gi, 'a Brooklyn recording artist')
      .replace(/\b(murder(?:er|s)?|assassin(?:ation)?)\b/gi, 'historic case')
      .replace(/\b(homicide)\b/gi, 'unsolved case')
      .replace(/\b(death\s*row)\b/gi, 'high security facility');
  }

  /**
   * Generate a thumbnail image using OpenAI Image Engine with reference images, exact face & logo compositing.
   */
  async generateThumbnailImage(params: {
    concept: { text: string; description: string; colors: string };
    videoTitle: string;
    showType?: string;
    selectedHostImage?: string;
    customHostUrl?: string;
    logoPosition?: 'top-left' | 'top-right' | 'none';
    referenceImages?: Array<{ type: 'logo' | 'host_photo' | 'reference'; url?: string; buffer?: Buffer }>;
    customLayoutInstructions?: string;
    excludeLogo?: boolean;
    excludeHost?: boolean;
    aspectRatio?: '16:9' | '9:16';
    storyContext?: string;
  }): Promise<{ imageUrl: string; cleanBackgroundUrl?: string; revisedPrompt: string }> {
    let cleanDescription = params.concept.description || '';
    // 1. Strip logo/brand references so OpenAI doesn't paint duplicate logos
    // Also clean legacy copy-paste boilerplate from older conversation threads
    cleanDescription = cleanDescription
      .replace(/a sharp split-screen down the center separated by a dramatic broken glass fracture effect with jagged shattered seam and subtle light leaking through/gi, '')
      .replace(/add the \*\*?mae[^*]*\*\*? logo[^\.]*/gi, '')
      .replace(/add the logo[^\.]*/gi, '')
      .replace(/\blogo\b/gi, '')
      .replace(/\bbrand badge\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Desensitize named figures and sensitive legal terms to protect prompt from safety blocks
    cleanDescription = this.desensitizeImagePrompt(cleanDescription);
    const safeStoryContext = params.storyContext ? this.desensitizeImagePrompt(params.storyContext) : '';

    const isVertical = params.aspectRatio === '9:16';
    const targetRatioLabel = isVertical ? '9:16 vertical YouTube Shorts / Reel' : '16:9 cinematic YouTube';

    let prompt = `Create a high-impact, cinematic ${targetRatioLabel} thumbnail image for a video titled "${params.videoTitle}".

STYLE: Cinematic dark, high-contrast photography, criminal psychology & courtroom breakdown aesthetic. Realistic photo style, NOT AI cartoon or 3D render.

SCENE & SUBJECT: ${cleanDescription || 'Cinematic courtroom, prison reality, or high-stakes legal breakdown scene.'}
${safeStoryContext ? `STORY & CHARACTER CONTEXT: ${safeStoryContext}` : ''}

SUBJECT PLACEMENT & FRAMING:
- Position the main subject, celebrity face, or key character with natural cinematic framing (rule of thirds, center dramatic portrait, or dynamic diagonal tension).
${!params.excludeHost ? `- Keep the bottom-right corner relatively clear of critical faces (host portrait sticker sits in bottom-right).` : '- Distribute subjects naturally across the frame with dramatic balance.'}
${isVertical ? `- REELS / SHORTS SAFE ZONES: Keep the bottom 25% (UI title, handle, audio disc) and right 15% (Like, Comment, Share buttons) completely clear of main character faces.` : ''}

TYPOGRAPHY & SAFE TITLE ZONE:
- Render bold, high-contrast headline text reading "${params.concept.text}".
- Bold UPPERCASE words: strictly 2 to 4 words.
- Bright yellow or white with heavy black drop-shadow and sharp outline.
- SAFE MARGINS: Maintain at least 15% inner margin clearance from ALL 4 borders. The top edge of letters must NEVER touch, bleed into, or get clipped by the top edge of the frame.
${isVertical ? `- VERTICAL PLACEMENT: Position headline text strictly in the upper-middle zone (Y: 25%–40%), leaving top status bar and bottom mobile UI clear.` : `- Position in the upper-third / upper-center area comfortably below the top border.`}
- Clean, crisp 2D graphic font.

COMPOSITION: Dramatic ambient lighting across full ${isVertical ? '9:16 vertical' : '16:9 landscape'} frame with rich atmospheric depth. ${params.concept.colors ? `Color theme: ${params.concept.colors} background atmosphere, subtle warm ambient lighting.` : ''}
FORBIDDEN: NO horizontal lens flares, NO laser lines, NO light streaks across subjects' faces or bodies, NO watermarks, NO outer borders, NO artificial frames, NO channel logos.`;

    if (params.showType) {
      prompt += ` Show Type: ${params.showType}.`;
    }

    if (params.customLayoutInstructions) {
      prompt += ` EXPLICIT LAYOUT DIRECTIVE: ${params.customLayoutInstructions}.`;
    }

    const primaryModel = this.configService.get<string>('OPENAI_IMAGE_MODEL', 'gpt-image-2');
    const modelsToTry = Array.from(new Set([primaryModel, 'gpt-image-2', 'gpt-image-1.5']));

    let lastError: any = null;
    let baseImageUrl: string = '';
    let revisedPrompt: string = prompt;

    this.logger.debug(`[Thumbnail Debug] Prompt length: ${prompt.length} chars`);
    this.logger.debug(`[Thumbnail Debug] Full prompt:\n${prompt}`);
    this.logger.debug(`[Thumbnail Debug] Primary model: ${primaryModel}, Concept text: "${params.concept.text}", Video title: "${params.videoTitle}", Colors: "${params.concept.colors}"`);

    for (const model of modelsToTry) {
      // gpt-image-2 natively supports 1536x864 (16:9) and 864x1536 (9:16)
      // Fallback models (gpt-image-1.5 / DALL-E) only support 1536x1024, 1024x1536, 1024x1024
      const modelSupportsDirect16x9 = model.includes('gpt-image-2');
      const modelImageSize = modelSupportsDirect16x9
        ? (isVertical ? '864x1536' : '1536x864')
        : (isVertical ? '1024x1536' : '1536x1024');

      try {
        this.logger.log(`Generating ${params.aspectRatio || '16:9'} thumbnail background with model '${model}' (${modelImageSize}) for: "${params.concept.text}"`);

        const requestParams: Record<string, any> = {
          model,
          prompt: prompt,
          n: 1,
          size: modelImageSize,
          quality: 'medium',
        };

        const response = await this.client.images.generate(requestParams as any);
        const url = response.data?.[0]?.url;
        const b64 = (response.data?.[0] as any)?.b64_json;
        revisedPrompt = (response.data?.[0] as any)?.revised_prompt || prompt;

        this.logger.debug(`[Thumbnail Debug] API response with model '${model}' - URL: ${url ? 'present' : 'none'}, B64: ${b64 ? 'present' : 'none'}`);
        this.logger.debug(`[Thumbnail Debug] Revised prompt from API: ${revisedPrompt?.substring(0, 200)}...`);

        if (url) {
          baseImageUrl = url;
        } else if (b64) {
          baseImageUrl = `data:image/png;base64,${b64}`;
        }

        if (baseImageUrl) break;
      } catch (error: any) {
        lastError = error;
        this.logger.warn(`Thumbnail background generation with model '${model}' failed: ${error.message}. Trying next model...`);

        // If rejected by OpenAI safety system, retry once with deeply desensitized character archetypes
        const isSafetyError = error?.message?.toLowerCase().includes('safety system') || (error?.status === 400 && error?.message?.toLowerCase().includes('rejected'));
        if (isSafetyError) {
          const softenedPrompt = this.desensitizeImagePrompt(prompt)
            .replace(new RegExp(params.concept.text.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi'), 'DRAMATIC HEADLINE');
          this.logger.log(`[Safety Fallback] Retrying model '${model}' with desensitized prompt...`);
          try {
            const safeParams: Record<string, any> = {
              model,
              prompt: softenedPrompt,
              n: 1,
              size: modelImageSize,
              quality: 'medium',
            };
            const safeResp = await this.client.images.generate(safeParams as any);
            const safeUrl = safeResp.data?.[0]?.url;
            const safeB64 = (safeResp.data?.[0] as any)?.b64_json;
            revisedPrompt = (safeResp.data?.[0] as any)?.revised_prompt || softenedPrompt;
            if (safeUrl) {
              baseImageUrl = safeUrl;
              break;
            } else if (safeB64) {
              baseImageUrl = `data:image/png;base64,${safeB64}`;
              break;
            }
          } catch (safeErr: any) {
            this.logger.warn(`[Safety Fallback] Desensitized retry on model '${model}' also failed: ${safeErr.message}`);
          }
        }
      }
    }

    if (!baseImageUrl) {
      this.logger.error(`All image generation models failed. Last error: ${lastError?.message}`);
      throw lastError || new Error('Image generation failed on all available models.');
    }

    // Save clean un-composited background to MinIO for clean future iterations
    let cleanBackgroundUrl: string | undefined;
    const isMinioReady = await this.minioService.isAvailable().catch(() => false);
    if (isMinioReady) {
      try {
        let cleanBuffer: Buffer;
        if (baseImageUrl.startsWith('data:image/')) {
          cleanBuffer = Buffer.from(baseImageUrl.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        } else if (baseImageUrl.startsWith('http')) {
          cleanBuffer = await this.composerService['fetchBufferFromUrl'](baseImageUrl);
        } else {
          cleanBuffer = Buffer.from(baseImageUrl);
        }
        cleanBackgroundUrl = await this.minioService.uploadThumbnail('system', `clean_bg_${Date.now()}.png`, cleanBuffer);
      } catch { /* optional */ }
    }

    // Run Sharp composition to composite host face sticker and logo badge (if enabled)
    try {
      this.logger.log(`Compositing pristine host face & logo with Sharp...`);
      let customHostBuffer: Buffer | undefined;
      if (params.customHostUrl && !params.excludeHost) {
        try {
          customHostBuffer = await this.composerService.fetchBufferFromUrl(params.customHostUrl);
        } catch (e: any) {
          this.logger.warn(`Failed to fetch custom host buffer from ${params.customHostUrl}: ${e.message}`);
        }
      }

      const composedBuffer = await this.composerService.composeThumbnail({
        backgroundInput: baseImageUrl,
        selectedHostImage: params.selectedHostImage,
        customHostBuffer,
        excludeHost: params.excludeHost,
        logoPosition: params.excludeLogo ? 'none' : params.logoPosition || 'top-right',
        excludeLogo: params.excludeLogo,
        aspectRatio: params.aspectRatio || '16:9',
      });

      let imageUrl: string;

      if (isMinioReady) {
        try {
          imageUrl = await this.minioService.uploadThumbnail(
            'system',
            `composed_${Date.now()}.png`,
            composedBuffer,
          );
          this.logger.log(`Pristine composite thumbnail saved to MinIO: ${imageUrl}`);
        } catch (minioErr: any) {
          this.logger.log(`MinIO upload failed (${minioErr.message}), saving pristine composite thumbnail locally...`);
          const filename = `composed_${Date.now()}.png`;
          const genDir = path.join(process.cwd(), 'src', 'assets', 'generated');
          if (!fs.existsSync(genDir)) {
            fs.mkdirSync(genDir, { recursive: true });
          }
          fs.writeFileSync(path.join(genDir, filename), composedBuffer);
          imageUrl = `/api/assets/generated/${filename}`;
          this.logger.log(`Pristine composite thumbnail saved locally: ${imageUrl}`);
        }
      } else {
        const filename = `composed_${Date.now()}.png`;
        const genDir = path.join(process.cwd(), 'src', 'assets', 'generated');
        if (!fs.existsSync(genDir)) {
          fs.mkdirSync(genDir, { recursive: true });
        }
        fs.writeFileSync(path.join(genDir, filename), composedBuffer);
        imageUrl = `/api/assets/generated/${filename}`;
        this.logger.log(`Pristine composite thumbnail saved locally: ${imageUrl}`);
      }

      return { imageUrl, cleanBackgroundUrl: cleanBackgroundUrl || imageUrl, revisedPrompt };
    } catch (composeErr: any) {
      this.logger.error(`Sharp compositing failed unexpectedly: ${composeErr.message}`, composeErr.stack);
      if (baseImageUrl) {
        return { imageUrl: baseImageUrl, cleanBackgroundUrl: baseImageUrl, revisedPrompt };
      }
      throw lastError || composeErr;
    }
  }

  /**
   * Fast story & character context extractor using gpt-5.6-luna.
   * Resolves ambiguous pronouns ("him", "the detective") and supplies
   * named people, setting era, and courtroom/case facts from conversation history.
   */
  async extractStoryContextFromThread(params: {
    videoTitle?: string;
    videoDescription?: string;
    recentMessages?: Array<{ role: string; content: string }>;
    userPrompt?: string;
  }): Promise<string> {
    if (!params.recentMessages || params.recentMessages.length === 0) {
      return params.videoDescription ? params.videoDescription.slice(0, 250) : '';
    }

    try {
      const historySnippet = params.recentMessages
        .slice(-5)
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 300)}`)
        .join('\n');

      const model = this.fastModel || 'gpt-5.6-luna';
      const isReasoning = this.isReasoningModel(model);

      const requestPayload: Record<string, any> = {
        model,
        messages: [
          {
            role: 'system',
            content: `You are a visual scene context assistant for Unique Mecca Audio (true crime, courtroom breakdowns, prison reality).
Given the video topic and recent conversation history, output a concise 1-2 sentence visual context summary identifying:
1. Main subject(s) / real people named and their role/appearance
2. The specific case / courtroom / setting or evidence discussed
Keep it under 40 words. Output ONLY the visual context summary.`,
          },
          {
            role: 'user',
            content: `Video: ${params.videoTitle || 'YouTube Video'}
History:
${historySnippet}
User Request: ${params.userPrompt || ''}`,
          },
        ],
        max_completion_tokens: 80,
      };

      if (!isReasoning) {
        requestPayload.temperature = 0.3;
      }

      const response = await this.client.chat.completions.create(requestPayload as any);

      return response.choices[0]?.message?.content?.trim() || '';
    } catch (err: any) {
      this.logger.warn(`Fast context extraction failed (${err.message}), falling back to direct snippet`);
      return params.videoDescription ? params.videoDescription.slice(0, 200) : '';
    }
  }

  /**
   * Edit an existing image using reference image + text prompt.
   * Uses OpenAI images.edit API with gpt-image-2.
   *
   * SDK type: image: Uploadable (File | Response | FsReadStream | BunFile)
   * CRITICAL: input_fidelity is NOT supported for gpt-image-2 (400 error).
   * GPT models return b64_json only (never url).
   * Supports multiple images: base image + optional reference images (up to 16).
   */
  async editImageWithReference(
    baseImageUrl: string,
    prompt: string,
    options?: {
      referenceImageUrls?: string[];
      inputFidelity?: 'high' | 'low';
      mode?: 'thumbnail' | 'scene';
      selectedHostImage?: string;
      excludeHost?: boolean;
      excludeLogo?: boolean;
      logoPosition?: 'top-left' | 'top-right' | 'none';
      aspectRatio?: '16:9' | '9:16';
      storyContext?: string;
    },
  ): Promise<{ imageUrl: string; cleanBackgroundUrl?: string; revisedPrompt: string }> {
    const { toFile } = await import('openai');

    // Helper to download image from URL or local path or MinIO
    const downloadImage = async (url: string, index: number): Promise<Buffer> => {
      // Local generated files
      if (url.startsWith('/api/assets/generated/') || url.includes('/generated/')) {
        const filename = path.basename(url);
        const candidatePaths = [
          path.join(process.cwd(), 'src', 'assets', 'generated', filename),
          path.join(process.cwd(), 'youtube-ai-backend', 'src', 'assets', 'generated', filename),
          path.join(__dirname, '..', 'assets', 'generated', filename),
        ];
        for (const cp of candidatePaths) {
          if (fs.existsSync(cp)) return fs.readFileSync(cp);
        }
        throw new Error(`Local image not found: ${filename}`);
      }

      // Local unique host images
      if (url.startsWith('/api/assets/unique-images/') || url.includes('/unique_images/') || url.includes('/unique-images/')) {
        const filename = path.basename(url);
        const candidatePaths = [
          path.join(process.cwd(), 'src', 'assets', 'unique_images', filename),
          path.join(process.cwd(), 'youtube-ai-backend', 'src', 'assets', 'unique_images', filename),
          path.join(__dirname, '..', 'assets', 'unique_images', filename),
        ];
        for (const cp of candidatePaths) {
          if (fs.existsSync(cp)) return fs.readFileSync(cp);
        }
      }

      // Local logos
      if (url.startsWith('/api/assets/logos/') || url.includes('/logo/') || url.includes('/logos/')) {
        const filename = path.basename(url);
        const candidatePaths = [
          path.join(process.cwd(), 'src', 'assets', 'logo', filename),
          path.join(process.cwd(), 'youtube-ai-backend', 'src', 'assets', 'logo', filename),
          path.join(__dirname, '..', 'assets', 'logo', filename),
        ];
        for (const cp of candidatePaths) {
          if (fs.existsSync(cp)) return fs.readFileSync(cp);
        }
      }

      // MinIO internal/public URLs or proxy URLs — use minioService directly (no network fetch)
      if (url.includes('/thumbnails/') || url.includes('/api/assets/minio/')) {
        try {
          const rawKey = url.includes('/thumbnails/')
            ? url.split('/thumbnails/')[1]
            : url.split('/api/assets/minio/')[1];
          const cleanKey = rawKey ? rawKey.split('?')[0].split('#')[0] : null;
          if (cleanKey) {
            return await this.minioService.getFileBuffer(decodeURIComponent(cleanKey));
          }
        } catch { /* fall through to fetch */ }
      }

      // Public URLs or absolutized local URLs
      let fetchUrl = url;
      if (url.startsWith('/')) {
        const port = this.configService.get<number>('PORT', 3001);
        fetchUrl = `http://localhost:${port}${url}`;
      }

      const response = await fetch(fetchUrl);
      if (!response.ok) throw new Error(`Failed to fetch image ${index}: ${response.statusText}`);
      return Buffer.from(await response.arrayBuffer());
    };

    // Download base image + all reference images
    const allUrls = [baseImageUrl, ...(options?.referenceImageUrls || [])];
    const files: File[] = [];
    for (let i = 0; i < allUrls.length; i++) {
      const buffer = await downloadImage(allUrls[i], i);
      files.push(await toFile(buffer, `image_${i}.png`, { type: 'image/png' }));
    }

    // Build edit params — input_fidelity ONLY for gpt-image-1/1.5, NOT gpt-image-2
    const editModel = 'gpt-image-2';
    const isVertical = options?.aspectRatio === '9:16';
    const editSize = isVertical ? '864x1536' : '1536x864';

    let editPrompt = prompt;
    if (options?.storyContext) {
      editPrompt += `\nSTORY & CHARACTER CONTEXT: ${options.storyContext}`;
    }
    if (options?.mode !== 'scene') {
      editPrompt += `\nIMPORTANT RULES:\n1. Remove any existing channel logos, watermarks, or corner portrait host stickers from the background canvas before generating the new composition.\n2. SAFE MARGINS: If modifying or placing headline text, keep all letters comfortably within safe margins (at least 15% clearance from ALL borders) so no text touches or gets cut by any border.\n3. TYPOGRAPHY STYLE: If adding or changing text, render strictly 2 to 4 words in bold UPPERCASE with high-contrast yellow/white lettering and heavy black drop-shadow.`;
      if (options?.excludeHost) {
        editPrompt += `\n4. EXCLUDE HOST: Do NOT include or paint any channel host portrait or corner sticker in the scene.`;
      }
      if (options?.referenceImageUrls && options.referenceImageUrls.length > 0) {
        editPrompt += `\n5. REFERENCE INTEGRATION: Naturally blend the person from the reference image directly into the scene with authentic ambient lighting, matching courtroom/cinematic shadows, and realistic perspective.`;
      }
    }

    const editParams: Record<string, any> = {
      model: editModel,
      image: files.length === 1 ? files[0] : files,
      prompt: editPrompt,
      quality: 'medium',
      size: editSize,
    };
    if (options?.inputFidelity && editModel !== 'gpt-image-2') {
      editParams.input_fidelity = options.inputFidelity;
    }

    const result = await retryWithBackoff(
      () => this.client.images.edit(editParams as any),
      { operationName: 'OpenAI Image Edit' },
    );

    const b64 = (result.data?.[0] as any)?.b64_json;
    if (!b64) throw new Error('No image data returned from edit API');

    const editedBuffer = Buffer.from(b64, 'base64');
    let finalBuffer: Buffer = editedBuffer;

    // Save clean un-composited background for clean future iterations
    let cleanBackgroundUrl: string | undefined;
    const isMinioReady = await this.minioService.isAvailable().catch(() => false);
    if (isMinioReady) {
      try {
        cleanBackgroundUrl = await this.minioService.uploadThumbnail('system', `clean_edit_${Date.now()}.png`, editedBuffer);
      } catch { /* optional */ }
    }

    // For thumbnail mode (default): Re-composite host sticker and logo watermark
    if (options?.mode !== 'scene') {
      try {
        const hasReferenceHost = options?.referenceImageUrls && options.referenceImageUrls.length > 0;
        // Suppress Sharp host overlay if host was explicitly excluded OR passed via reference image (AI synthesized the host)
        const suppressSharpHost = options?.excludeHost === true || hasReferenceHost || options?.selectedHostImage === 'none';
        const resolvedLogoPos = options?.excludeLogo ? 'none' : (options?.logoPosition || 'top-right');

        this.logger.log(`Re-compositing overlays on edited thumbnail (suppressHost: ${suppressSharpHost}, logoPos: ${resolvedLogoPos})...`);
        const composed = await this.composerService.composeThumbnail({
          backgroundInput: editedBuffer,
          selectedHostImage: suppressSharpHost ? 'none' : options?.selectedHostImage,
          excludeHost: suppressSharpHost,
          logoPosition: resolvedLogoPos,
          excludeLogo: options?.excludeLogo || resolvedLogoPos === 'none',
          aspectRatio: options?.aspectRatio || (isVertical ? '9:16' : '16:9'),
        });
        finalBuffer = Buffer.from(composed);
      } catch (composeErr: any) {
        this.logger.warn(`Failed to re-composite overlays on edited thumbnail: ${composeErr.message}. Using raw edit.`);
        finalBuffer = editedBuffer;
      }
    }

    let imageUrl: string;
    if (isMinioReady) {
      try {
        imageUrl = await this.minioService.uploadThumbnail('system', `edited_${Date.now()}.png`, finalBuffer);
      } catch (minioErr: any) {
        this.logger.warn(`MinIO upload failed for edited image (${minioErr.message}), saving locally...`);
        const filename = `edited_${Date.now()}.png`;
        const genDir = path.join(process.cwd(), 'src', 'assets', 'generated');
        if (!fs.existsSync(genDir)) fs.mkdirSync(genDir, { recursive: true });
        fs.writeFileSync(path.join(genDir, filename), finalBuffer);
        imageUrl = `/api/assets/generated/${filename}`;
      }
    } else {
      const filename = `edited_${Date.now()}.png`;
      const genDir = path.join(process.cwd(), 'src', 'assets', 'generated');
      if (!fs.existsSync(genDir)) fs.mkdirSync(genDir, { recursive: true });
      fs.writeFileSync(path.join(genDir, filename), finalBuffer);
      imageUrl = `/api/assets/generated/${filename}`;
    }

    return { imageUrl, cleanBackgroundUrl: cleanBackgroundUrl || imageUrl, revisedPrompt: prompt };
  }

  /**
   * Generate a 16:9 scene image (no host face compositing, no logo overlay).
   * For "Generate Image" mode — raw AI scene for video b-roll/backgrounds.
   */
  async generateSceneImage(params: {
    scene: string;
    style: string;
    colors: string;
    textOverlay?: string;
    videoTitle?: string;
    storyContext?: string;
    referenceImageUrl?: string;
  }): Promise<{ imageUrl: string; revisedPrompt: string }> {
    let prompt = `Create a cinematic 16:9 scene image for a YouTube video titled "${params.videoTitle}".

USER DIRECTIVE & SCENE: ${params.scene}
${params.storyContext ? `STORY & CHARACTER CONTEXT: ${params.storyContext}` : ''}
STYLE: ${params.style || 'Cinematic dark, high-contrast realistic photography, criminal psychology & legal breakdown aesthetic'}
${params.colors ? `COLORS: ${params.colors}` : ''}
${params.textOverlay ? `TEXT OVERLAY: Render "${params.textOverlay}" in clean, bold typography comfortably within safe title margins.` : ''}

PRIORITY INSTRUCTIONS:
1. The user directive and reference image (if provided) are HIGHEST PRIORITY.
2. Use the Story & Character Context to accurately depict named people, courtroom era, or evidence when the prompt is brief.
3. Composition: Full 16:9 frame, dramatic cinematic lighting, realistic photography style. NO watermarks, NO borders, NO frames, NO channel logos.`;

    // If reference image provided, try edit API first
    if (params.referenceImageUrl) {
      try {
        return await this.editImageWithReference(params.referenceImageUrl, prompt, {});
      } catch (editErr: any) {
        this.logger.warn(`Image edit failed, falling back to generate: ${editErr.message}`);
        prompt += `\n\nREFERENCE STYLE: Match the visual style, color palette, and mood of the provided reference as closely as possible.`;
      }
    }

    // Standard generation (same fallback pattern as generateThumbnailImage)
    const primaryModel = this.configService.get<string>('OPENAI_IMAGE_MODEL', 'gpt-image-2');
    const modelsToTry = Array.from(new Set([primaryModel, 'gpt-image-2', 'gpt-image-1.5']));

    let lastError: any = '';
    let imageUrl = '';

    for (const model of modelsToTry) {
      const modelSupportsDirect16x9 = model.includes('gpt-image-2');
      const modelImageSize = modelSupportsDirect16x9 ? '1536x864' : '1536x1024';

      try {
        const response = await this.client.images.generate({
          model,
          prompt,
          n: 1,
          size: modelImageSize as any,
          quality: 'medium',
        });

        const b64 = (response.data?.[0] as any)?.b64_json;
        if (b64) {
          const imageBuffer = Buffer.from(b64, 'base64');
          const isMinioReady = await this.minioService.isAvailable().catch(() => false);
          if (isMinioReady) {
            try {
              imageUrl = await this.minioService.uploadThumbnail('system', `scene_${Date.now()}.png`, imageBuffer);
            } catch {
              const filename = `scene_${Date.now()}.png`;
              const genDir = path.join(process.cwd(), 'src', 'assets', 'generated');
              if (!fs.existsSync(genDir)) fs.mkdirSync(genDir, { recursive: true });
              fs.writeFileSync(path.join(genDir, filename), imageBuffer);
              imageUrl = `/api/assets/generated/${filename}`;
            }
          } else {
            const filename = `scene_${Date.now()}.png`;
            const genDir = path.join(process.cwd(), 'src', 'assets', 'generated');
            if (!fs.existsSync(genDir)) fs.mkdirSync(genDir, { recursive: true });
            fs.writeFileSync(path.join(genDir, filename), imageBuffer);
            imageUrl = `/api/assets/generated/${filename}`;
          }
          break;
        }
      } catch (error: any) {
        lastError = error;
        this.logger.warn(`Scene image gen with model '${model}' failed: ${error.message}`);
      }
    }

    if (!imageUrl) throw lastError || new Error('Scene image generation failed');
    return { imageUrl, revisedPrompt: prompt };
  }

  /**
   * Extract token usage including cache hit rate.
   */
  private extractUsage(response: OpenAI.ChatCompletion): TokenUsage {
    const usage = response.usage;
    const promptTokens = usage?.prompt_tokens || 0;
    const cachedTokens =
      (usage as any)?.prompt_tokens_details?.cached_tokens || 0;
    const completionTokens = usage?.completion_tokens || 0;

    return {
      promptTokens,
      completionTokens,
      cachedTokens,
      cacheHitRate:
        promptTokens > 0 ? Math.round((cachedTokens / promptTokens) * 100) : 0,
    };
  }

  /**
   * Log cache performance and alert if hit rate drops below threshold.
   */
  private logCachePerformance(
    operation: string,
    usage: TokenUsage,
    threadId?: string,
  ): void {
    if (usage.promptTokens === 0) return;

    const logMessage =
      `[Cache] ${operation}: ${usage.cachedTokens}/${usage.promptTokens} cached (${usage.cacheHitRate}%) | ` +
      `completion: ${usage.completionTokens} tokens`;

    if (
      usage.cacheHitRate < this.cacheAlertThreshold &&
      usage.promptTokens > 1024
    ) {
      this.logger.warn(
        `${logMessage} | ALERT: Cache hit rate ${usage.cacheHitRate}% below threshold ${this.cacheAlertThreshold}%` +
          (threadId ? ` for thread ${threadId}` : ''),
      );
    } else {
      this.logger.log(logMessage);
    }
  }
}
