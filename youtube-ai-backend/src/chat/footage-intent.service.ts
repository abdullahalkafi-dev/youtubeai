import { Injectable, Logger } from '@nestjs/common';
import { OpenAIService } from '../openai/openai.service';

export type StoryType =
  | 'breaking_crime'
  | 'local_crime'
  | 'celebrity_hiphop'
  | 'national_legal'
  | 'general';

export interface FootageIntentResult {
  hasFootageIntent: boolean;
  requestTypes: Array<'news' | 'broll'>;
  primaryEntity: string;
  eventOrTopic: string;
  locationHint?: string;
  storyType: StoryType;
  newsQueries: string[];
  brollQueries: string[];
}

export const US_STATES = new Set([
  'al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id','il','in','ia',
  'ks','ky','la','me','md','ma','mi','mn','ms','mo','mt','ne','nv','nh','nj',
  'nm','ny','nc','nd','oh','ok','or','pa','ri','sc','sd','tn','tx','ut','vt',
  'va','wa','wv','wi','wy','dc',
  'alabama','alaska','arizona','arkansas','california','colorado','connecticut',
  'delaware','florida','georgia','hawaii','idaho','illinois','indiana','iowa',
  'kansas','kentucky','louisiana','maine','maryland','massachusetts','michigan',
  'minnesota','mississippi','missouri','montana','nebraska','nevada',
  'new hampshire','new jersey','new mexico','new york','north carolina',
  'north dakota','ohio','oklahoma','oregon','pennsylvania','rhode island',
  'south carolina','south dakota','tennessee','texas','utah','vermont',
  'virginia','washington','west virginia','wisconsin','wyoming','district of columbia',
]);

/**
 * Normalizes location hints to city only by safely stripping trailing US state names or codes.
 * Preserves hyphenated cities (e.g. Winston-Salem, Wilkes-Barre) and cities named New York.
 */
export function normalizeLocationHint(raw?: string): string | undefined {
  if (!raw) return undefined;
  let s = raw.trim().replace(/\s+/g, ' ');
  const comma = s.lastIndexOf(',');
  if (comma > 0 && US_STATES.has(s.slice(comma + 1).trim().toLowerCase().replace(/\./g, ''))) {
    s = s.slice(0, comma);
  } else {
    const m = s.match(/^(.+)\s+([A-Z]{2})$/);
    if (m && US_STATES.has(m[2].toLowerCase())) s = m[1];
  }
  return s.trim() || undefined;
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
3. "storyType": Classify story as one of:
   - "celebrity_hiphop": Rapper, celebrity lifestyle, pop-culture news, artist controversies.
   - "breaking_crime": Active shooting, manhunt, recent violent arrest, breaking incident.
   - "local_crime": Municipal crime, local drug bust, county sheriff case.
   - "national_legal": Federal indictment, RICO trial, supreme court case, high-profile televised lawsuit.
   - "general": General interest or uncategorized news topic.
4. "primaryEntity": The specific person or entity name (e.g., "Lil Durk", "Drake", "Donald Trump"). Clean up casing, typos, or voice artifacts. If anaphoric ("this", "him", "that topic") resolve from context.
5. "eventOrTopic": The specific event if any (e.g., "arrest", "court hearing", "shooting", "album release"), or "" if general.
6. "locationHint": City/state if mentioned or implied (e.g., "Miami", "Denver"), else "".
7. "newsQueries": 1-2 focused YouTube search queries for news/court/affiliate coverage (e.g., ["Lil Durk arrest news", "Lil Durk court hearing"]).
8. "brollQueries": 1-2 focused YouTube search queries for raw lifestyle moments/shorts (e.g., ["Lil Durk walking lifestyle", "Lil Durk moments raw clips"]). NEVER include words like "reaction", "breakdown", or "commentary".

Return ONLY valid JSON matching this schema:
{
  "hasFootageIntent": boolean,
  "requestTypes": ["news" | "broll"],
  "storyType": "celebrity_hiphop" | "breaking_crime" | "local_crime" | "national_legal" | "general",
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
        const rawLoc = (parsed.locationHint || '').trim();
        const validStoryTypes: StoryType[] = [
          'breaking_crime',
          'local_crime',
          'celebrity_hiphop',
          'national_legal',
          'general',
        ];
        const storyType: StoryType = validStoryTypes.includes(parsed.storyType)
          ? parsed.storyType
          : 'general';

        const result: FootageIntentResult = {
          hasFootageIntent: parsed.hasFootageIntent,
          requestTypes: Array.isArray(parsed.requestTypes) && parsed.requestTypes.length > 0
            ? parsed.requestTypes.filter((t: string) => t === 'news' || t === 'broll')
            : ['news'],
          storyType,
          primaryEntity: (parsed.primaryEntity || '').trim(),
          eventOrTopic: (parsed.eventOrTopic || '').trim(),
          locationHint: normalizeLocationHint(rawLoc) || undefined,
          newsQueries: Array.isArray(parsed.newsQueries)
            ? parsed.newsQueries.map((q: string) => String(q).trim()).filter(Boolean)
            : [],
          brollQueries: Array.isArray(parsed.brollQueries)
            ? parsed.brollQueries.map((q: string) => String(q).trim()).filter(Boolean)
            : [],
        };
        this.logger.log(
          `[FootageIntent] AI parsed: entity="${result.primaryEntity}" storyType="${result.storyType}" types=[${result.requestTypes.join(',')}] queries=[${[...result.newsQueries, ...result.brollQueries].join('; ')}]`,
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

    // Extract subject by removing noise prefixes and spoken filler
    let subject = message
      // 1. Strip trailing noise / platform / fillers
      .replace(/\s+(?:on|from)\s+youtube\b/gi, '')
      .replace(/\s+(?:so\s+i\s+can\s+use|for\s+the\s+script|for\s+this\s+video|to\s+show\s+(?:this\s+story\s+to\s+)?my\s+viewers)\b/gi, '')
      .replace(/\s+(?:and\s+)?(?:plus\s+)?(?:some\s+)?(?:b-?rolls?(?:\s*clips?)?|clips?|footage|videos?)+\s*$/gi, '')
      // 2. Strip leading conversational openings
      .replace(/^(?:please\s+)?(?:can|could|would)\s+you\s+(?:please\s+)?(?:give|find|get|show|send)?\s*(?:me\s+)?/i, '')
      .replace(/^(?:i\s+)?(?:need|want|would like)\s+(?:to\s+)?(?:get|find|see)?\s*/i, '')
      .replace(/^give\s+me\s+/i, '')
      .replace(/^(?:a\s+couple\s+of|a\s+few|some|the\s+best|the\s+links?\s+to\s+(?:the)?)\s+/i, '')
      .replace(/^(?:local\s+news\s+|news\s+)?(?:videos?|clips?|footage|b-?roll)\s*(?:on|about|for|dealing\s+with|of)?\s*/i, '')
      .replace(/^(?:local\s+news\s+|news\s+)\s*(?:on|about|for|dealing\s+with|of)?\s*/i, '')
      .replace(/^(?:this|that|these|those)\s+/i, '')
      // 3. Strip trailing topic qualifiers
      .replace(/\s+(?:story|case|incident)\s+from\s+local\s+news\b/gi, '')
      .replace(/\s+story\b/gi, '')
      .replace(/\b(?:this|that|these|those)\s*$/i, '')
      .replace(/^\s*(?:this|that|these|those)\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Catch common phonetic speech recognition quirks
    if (/little dart/i.test(subject)) {
      subject = subject.replace(/little dart/i, 'Lil Durk');
    }
    if (/crystal pike/i.test(subject)) {
      subject = subject.replace(/crystal pike/i, 'Christa Pike');
    }

    // Check if subject is purely an anaphoric placeholder (e.g. "video topic", "this topic", "the script")
    const isAnaphoric =
      /^(?:(?:this|that)\s+)?(?:video\s+)?(?:topic|script|video|case|story|post)\b/i.test(subject) ||
      /^(?:this|that|it|these|those)\s*$/i.test(subject) ||
      subject === '';

    if (isAnaphoric && context) {
      const lines = context.split('\n');
      for (const line of lines) {
        const headingMatch = line.match(/^#{1,4}\s+(.+)$/);
        if (headingMatch) {
          let candidate = headingMatch[1].trim();
          // Strip boilerplate heading prefixes like "Make This Today:", "Topic:", "Story:"
          candidate = candidate.replace(/^(?:Make This (?:Today|Video)|Topic|Story|Cover This|Recommended|Today's (?:Video|Topic))\s*[:\-–—]\s*/i, '');
          // Strip bold / formatting markers
          candidate = candidate.replace(/\*\*/g, '').trim();
          // Extract primary subject before secondary subtitles
          candidate = candidate.replace(/[:\-–—].*$/, '').trim();
          if (candidate && !/sources|references|footage/i.test(candidate)) {
            subject = candidate;
            break;
          }
        }
      }
      if (isAnaphoric && subject.match(/^(?:(?:this|that)\s+)?(?:video\s+)?(?:topic|script|video|case|story|post)\b/i)) {
        subject = '';
      }
    } else if (isAnaphoric) {
      subject = '';
    }

    const primaryEntity = subject.split(/\s+(?:getting|arrested|in|at|court|hearing)\b/i)[0].trim() || subject;

    // Detect storyType deterministically
    let storyType: StoryType = 'general';
    const textAll = `${message} ${context || ''}`.toLowerCase();
    if (/\b(rapper|rap|hip\s*hop|lil\s+|drake|rick\s+ross|album|concert|celebrity|artist)\b/i.test(textAll)) {
      storyType = 'celebrity_hiphop';
    } else if (/\b(shooting|shot|killed|hostage|breaking|manhunt|push baby|balcony)\b/i.test(textAll)) {
      storyType = 'breaking_crime';
    } else if (/\b(federal|indictment|rico|lawsuit|supreme\s+court|verdict|hearing|sentenced|kidnapping|tren de aragua)\b/i.test(textAll)) {
      storyType = 'national_legal';
    } else if (/\b(arrest|police|deputy|sheriff|drug\s+bust|battery)\b/i.test(textAll)) {
      storyType = 'local_crime';
    }

    // Extract location hint if mentioned after "in" or "at", or check context for known cities/boroughs
    let locationHint: string | undefined;
    const locMatch = message.match(/\b(?:in|at|near)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:,\s*[A-Z]{2}|,\s*[A-Za-z]+)?)\b/);
    if (locMatch) {
      locationHint = normalizeLocationHint(locMatch[1]);
    } else if (/\bbronx\b/i.test(message) || /\bbronx\b/i.test(context || '')) {
      locationHint = 'Bronx, NY';
    } else if (/\bdenver\b/i.test(message) || /\bdenver\b/i.test(context || '')) {
      locationHint = 'Denver, CO';
    } else if (/\bmiami\b/i.test(message) || /\bmiami\b/i.test(context || '')) {
      locationHint = 'Miami, FL';
    } else if (/\bchicago\b/i.test(message) || /\bchicago\b/i.test(context || '')) {
      locationHint = 'Chicago, IL';
    }

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
        if (storyType === 'celebrity_hiphop') {
          brollQueries.push(`${primaryEntity} lifestyle clips`);
          brollQueries.push(`${primaryEntity} moments shorts`);
        } else {
          brollQueries.push(`${primaryEntity} b-roll exterior`);
          brollQueries.push(`${primaryEntity} raw footage`);
        }
      }
    }

    return {
      hasFootageIntent: true,
      requestTypes,
      storyType,
      primaryEntity,
      eventOrTopic: subject,
      locationHint,
      newsQueries,
      brollQueries,
    };
  }

  private emptyResult(): FootageIntentResult {
    return {
      hasFootageIntent: false,
      requestTypes: [],
      storyType: 'general',
      primaryEntity: '',
      eventOrTopic: '',
      newsQueries: [],
      brollQueries: [],
    };
  }
}
