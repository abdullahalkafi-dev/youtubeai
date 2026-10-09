import { Injectable, Logger } from '@nestjs/common';
import { OpenAIService } from '../openai/openai.service';

export interface FootageIntentResult {
  hasFootageIntent: boolean;
  requestTypes: Array<'news' | 'broll'>;
  primaryEntity: string;
  eventOrTopic: string;
  locationHint?: string;
  newsQueries: string[];
  brollQueries: string[];
}

@Injectable()
export class FootageIntentService {
  private readonly logger = new Logger(FootageIntentService.name);

  constructor(private readonly openaiService: OpenAIService) {}

  /**
   * Intelligently parses user message and conversation context into structured footage intent.
   * Handles natural/messy conversational language, speech-to-text quirks (e.g. "Little Dart" -> "Lil Durk"),
   * and separates official news coverage from raw celebrity B-roll moments.
   */
  async extractIntent(params: {
    message: string;
    conversationText?: string;
    trendTitles?: string[];
  }): Promise<FootageIntentResult> {
    const rawMessage = (params.message || '').trim();
    if (!rawMessage) {
      return this.emptyResult();
    }

    // Quick regex pre-check: if completely unrelated, skip AI call to save latency and cost
    if (!this.quickMightHaveFootageIntent(rawMessage, params.conversationText)) {
      return this.emptyResult();
    }

    try {
      const systemPrompt = `You are an expert query and footage intent extractor for a YouTube video creation studio.
Users ask for video clips, news, or B-roll using natural, messy, or spoken language (e.g., "I need video for this Lil Durk", "I need local news for Lil Durk this", "i need youtube video about lil durk getting arrested", "give me 5 clips of him walking or eating", "show b-roll of MrBeast", "footage for the script").
Spoken voice transcription may slightly distort celebrity names (e.g., "Little Dart" -> "Lil Durk", "Tory Lanes" -> "Tory Lanez").

Analyze the user's message and recent context:
1. "hasFootageIntent": boolean. True if the user is asking for footage, news clips, B-roll, video scenes, or visual clips. False for pure questions or script writing requests without footage requests.
2. "requestTypes": Array of "news" and/or "broll".
   - "news": Broadcast news, TV station reporting, courthouse coverage, arrest reports, police press conferences.
   - "broll": Raw visual moments, lifestyle clips (walking, eating, arriving, public appearances, YouTube shorts) of the subject for cutaways.
   - If user asks for both or general footage covering the person and the event, include both: ["news", "broll"].
3. "primaryEntity": The specific person or entity name (e.g., "Lil Durk", "Drake", "Donald Trump"). Clean up casing, typos, or voice artifacts. If anaphoric ("this", "him", "that topic") resolve from context.
4. "eventOrTopic": The specific event if any (e.g., "arrest", "court hearing", "shooting", "album release"), or "" if general.
5. "locationHint": City/state if mentioned or implied (e.g., "Miami", "Chicago"), else "".
6. "newsQueries": 1-2 focused YouTube search queries for news/court/affiliate coverage (e.g., ["Lil Durk arrest news", "Lil Durk court hearing"]).
7. "brollQueries": 1-2 focused YouTube search queries for raw lifestyle moments/shorts (e.g., ["Lil Durk walking lifestyle", "Lil Durk moments raw clips"]). NEVER include words like "reaction", "breakdown", or "commentary".

Return ONLY valid JSON matching this schema:
{
  "hasFootageIntent": boolean,
  "requestTypes": ["news" | "broll"],
  "primaryEntity": string,
  "eventOrTopic": string,
  "locationHint": string,
  "newsQueries": string[],
  "brollQueries": string[]
}`;

      const userMessage = `User Message: "${rawMessage}"
Context:\n${(params.conversationText || '').slice(0, 1500)}
${params.trendTitles?.length ? `Trending Topics:\n${params.trendTitles.slice(0, 3).join('\n')}` : ''}`;

      const rawAi = await this.openaiService.chatFast({
        systemPrompt,
        userMessage,
        temperature: 0.1,
        maxCompletionTokens: 300,
      });

      const parsed = this.parseJsonSafe(rawAi);
      if (parsed && typeof parsed.hasFootageIntent === 'boolean') {
        const result: FootageIntentResult = {
          hasFootageIntent: parsed.hasFootageIntent,
          requestTypes: Array.isArray(parsed.requestTypes) && parsed.requestTypes.length > 0
            ? parsed.requestTypes.filter((t: string) => t === 'news' || t === 'broll')
            : ['news'],
          primaryEntity: (parsed.primaryEntity || '').trim(),
          eventOrTopic: (parsed.eventOrTopic || '').trim(),
          locationHint: (parsed.locationHint || '').trim() || undefined,
          newsQueries: Array.isArray(parsed.newsQueries)
            ? parsed.newsQueries.map((q: string) => String(q).trim()).filter(Boolean)
            : [],
          brollQueries: Array.isArray(parsed.brollQueries)
            ? parsed.brollQueries.map((q: string) => String(q).trim()).filter(Boolean)
            : [],
        };
        this.logger.log(
          `[FootageIntent] AI parsed: entity="${result.primaryEntity}" types=[${result.requestTypes.join(',')}] queries=[${[...result.newsQueries, ...result.brollQueries].join('; ')}]`,
        );
        return result;
      }
    } catch (err: any) {
      this.logger.warn(`[FootageIntent] AI extraction failed, falling back to regex: ${err?.message || err}`);
    }

    return this.fallbackRegexExtraction(rawMessage, params.conversationText);
  }

  private quickMightHaveFootageIntent(message: string, context?: string): boolean {
    const text = `${message} ${context || ''}`.toLowerCase();
    return /\b(footage|b-?roll|clip|clips|reels?|shorts?|video|videos|news|scene|scenes|camera|camera-ready|watch|court|arrest|hearing)\b/i.test(
      text,
    );
  }

  private parseJsonSafe(raw: string): any {
    try {
      const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
      return JSON.parse(cleaned);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
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

  /**
   * Deterministic fallback when OpenAI call is unavailable or fails.
   */
  fallbackRegexExtraction(message: string, context?: string): FootageIntentResult {
    const lower = message.toLowerCase();
    const hasFootage = /\b(local news|footage|b-?roll|scene pack|news clips?|video clips?|collect (clips|footage)|clips? for (the )?script|local (tv|affiliates?|stations?)|video (for|about|of)|clips? (for|about|of)|shorts? (for|about|of)|reels? (for|about|of))\b/i.test(
      lower,
    );

    if (!hasFootage) {
      return this.emptyResult();
    }

    const wantsBroll = /\b(b-?roll|clips?|reels?|shorts?|lifestyle|walking|eating|moments|appearance)\b/i.test(lower);
    const wantsNews = /\b(news|local|station|affiliate|arrest|court|hearing|trial|police|crime|report)\b/i.test(lower) || !wantsBroll;

    const requestTypes: Array<'news' | 'broll'> = [];
    if (wantsNews) requestTypes.push('news');
    if (wantsBroll) requestTypes.push('broll');
    if (requestTypes.length === 0) requestTypes.push('news');

    // Extract subject by removing noise prefixes
    let subject = message
      .replace(/^(?:please\s+)?(?:can|could|would)\s+you\s+(?:please\s+)?(?:give|find|get|show|send)?\s*(?:me\s+)?/i, '')
      .replace(/^(?:i\s+)?(?:need|want|would like)\s+(?:to\s+)?(?:get|find|see)?\s*/i, '')
      .replace(/^give\s+me\s+/i, '')
      .replace(/^(?:find|get|show|search\s+for)?\s*(?:some\s+)?(?:local\s+news\s+|news\s+)?(?:footage|clips?|b-?roll|video\s+clips?|youtube\s+video|videos?)\s*(?:for|about|on|of)?\s*(?:this|that|these|those)?\s*/i, '')
      .replace(/^(?:some\s+)?(?:latest\s+|recent\s+)?local\s+news\s*(?:for|about|on|of|in)?\s*(?:this|that|these|those)?\s*/i, '')
      .replace(/\b(?:this|that|these|those)\s*$/i, '') // strip trailing "this"
      .replace(/^\s*(?:this|that|these|those)\s+/i, '') // strip leading "this"
      .replace(/\s+/g, ' ')
      .trim();

    // Catch common phonetic speech recognition quirks
    if (/little dart/i.test(subject)) {
      subject = subject.replace(/little dart/i, 'Lil Durk');
    }

    const primaryEntity = subject.split(/\s+(?:getting|arrested|in|at|court|hearing)\b/i)[0].trim() || subject;

    const newsQueries: string[] = [];
    const brollQueries: string[] = [];

    if (primaryEntity) {
      if (wantsNews) {
        newsQueries.push(`${primaryEntity} news latest`);
        if (/arrest|court|trial/i.test(subject)) {
          newsQueries.push(`${primaryEntity} court hearing`);
        }
      }
      if (wantsBroll) {
        brollQueries.push(`${primaryEntity} lifestyle clips`);
        brollQueries.push(`${primaryEntity} moments shorts`);
      }
    }

    return {
      hasFootageIntent: true,
      requestTypes,
      primaryEntity,
      eventOrTopic: subject,
      newsQueries,
      brollQueries,
    };
  }

  private emptyResult(): FootageIntentResult {
    return {
      hasFootageIntent: false,
      requestTypes: [],
      primaryEntity: '',
      eventOrTopic: '',
      newsQueries: [],
      brollQueries: [],
    };
  }
}
