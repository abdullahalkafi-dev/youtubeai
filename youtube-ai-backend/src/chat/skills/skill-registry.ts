import { CREATIVE_CONTRACT, THUMBNAIL_MARKDOWN } from '../studio/studio.prompts';
import { TITLE_CLARITY_RULE } from '../../openai/prompts/title-rules';
import { Injectable, Logger } from '@nestjs/common';
import { ChatSkill, SkillContext } from './skill.interface';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Channel, ChannelDocument } from '../../mongo/schemas/channel.schema';
import { Video, VideoDocument } from '../../mongo/schemas/video.schema';
import {
  TrendingTopic,
  TrendingTopicDocument,
} from '../../mongo/schemas/trending-topic.schema';
import {
  SeoSuggestion,
  SeoSuggestionDocument,
} from '../../mongo/schemas/seo-suggestion.schema';
import {
  CompetitorChannel,
  CompetitorChannelDocument,
} from '../../mongo/schemas/competitor-channel.schema';
import { ChromaService } from '../../chroma/chroma.service';
import { YoutubeAnalyticsService } from '../../youtube/youtube-analytics.service';
import { PerformanceContextService } from '../../youtube/performance-context.service';
import { SeoDataService } from '../../youtube/seo-data.service';
import { CompetitorsService } from '../../competitors/competitors.service';
import { buildCompactChannelContext } from '../../openai/prompts/context';
import {
  SPOKEN_LINE_CONTRACT,
  GOLD_SPOKEN_EXAMPLES,
} from '../../openai/prompts/script-cadence';
import { SCRIPT_LENGTH_CONTRACT } from '../../openai/prompts/script-length';
import { withUniquePersona } from '../../openai/prompts/unique-persona';

@Injectable()
export class SkillRegistry {
  private readonly logger = new Logger(SkillRegistry.name);
  private skills = new Map<string, ChatSkill>();
  /** 60-min TTL caches — competitor brief + content gaps (YouTube quota savers). */
  private static readonly CTX_TTL_MS = 60 * 60 * 1000;
  private competitorBriefCache = new Map<
    string,
    { at: number; data: SkillContext['competitorSummary'] }
  >();
  private gapsCache = new Map<
    string,
    { at: number; data: NonNullable<SkillContext['contentGaps']> }
  >();

  constructor(
    @InjectModel(Channel.name)
    private readonly channelModel: Model<ChannelDocument>,
    @InjectModel(Video.name) private readonly videoModel: Model<VideoDocument>,
    @InjectModel(TrendingTopic.name)
    private readonly trendingTopicModel: Model<TrendingTopicDocument>,
    @InjectModel(SeoSuggestion.name)
    private readonly seoSuggestionModel: Model<SeoSuggestionDocument>,
    @InjectModel(CompetitorChannel.name)
    private readonly competitorModel: Model<CompetitorChannelDocument>,
    private readonly chromaService: ChromaService,
    private readonly analyticsService: YoutubeAnalyticsService,
    private readonly performanceContext: PerformanceContextService,
    private readonly competitorsService: CompetitorsService,
    private readonly seoDataService: SeoDataService,
  ) {
    this.registerDefaults();
  }

  private registerDefaults() {
    // General skill — with intent classification and clarification logic
    const generalFormat = `## RESPONSE RULES

1. FIRST, classify what the user is asking for:
   - SCRIPT — wants a full video script or script section
   - SEO — wants title, description, tags, hashtags
   - THUMBNAIL — wants thumbnail concepts or text ideas
   - IDEA — wants a video idea scored or evaluated
   - TREND — wants trending topics or trend analysis
   - STRATEGY — wants channel growth, content calendar, analytics advice
   - PERSONAL — asking about Unique's life, book, experience
   - COLLABORATE — user shared an image, brief topic, or open-ended thought

2. If intent is CLEAR → respond using the appropriate format below.

3. If intent is OPEN-ENDED or user uploaded an image/asset:
   Act as an intuitive creative partner. Acknowledge the user's topic or image specifically, highlight a sharp narrative angle or visual hook immediately, and smoothly invite next steps (e.g., offering to spin up two thumbnail concepts, draft an outline, or write an SEO package). NEVER present a rigid, robotic questionnaire or ask the user to "just type the letter".

4. NEVER output a full script unless the user explicitly asked for a script.
5. Keep responses crisp, punchy, and actionable unless the user asks for deep detail.
6. MULTI-DELIVERABLE REQUESTS: When the user asks for several deliverables at once (e.g., a topic suggestion + a title + a thumbnail package), deliver ALL of them — combine the IDEA score section with the THUMBNAIL intent block (exactly two concepts inside <!-- THUMBNAILS_START --> / <!-- THUMBNAILS_END -->). Never silently drop a requested part.

## OUTPUT FORMATS BY INTENT

### If SCRIPT intent:
Plan a topic-specific script for 7-9 minutes (about 900-1,150 spoken words) by default; explicit duration wins and scales the word budget. Follow the shared spoken-line contract and wrap only speech in SCRIPT_START/SCRIPT_END delimiters.

### If SEO intent:
${TITLE_CLARITY_RULE}
## Title
[title: the incident first, then the hook]
## Description
[10-part blueprint: hook + 3-5 paragraph breakdown + bullet takeaways + host bio + CTAs + social links + disclaimer + trailing #hashtags]
## Tags
[10-15 tags, comma-separated]
## Hashtags
[3-5 hashtags with #]

### If THUMBNAIL intent:
${THUMBNAIL_MARKDOWN}

### If IDEA intent:
## Score
[X.X/10] — GREENLIGHT / HOLD / PASS
## Criteria
[8 criteria with scores and brief reasons]
## Improvements
[3 actionable improvements]

### If TREND intent:
### [Topic Title]
**Summary:** [1-2 sentences]
**Opportunity Score:** [0-100]
**Recommendation:** GREENLIGHT / HOLD / PASS
**Content Angle:** [how to cover it]

### If STRATEGY or PERSONAL intent:
Use clear markdown with ## headers, bullet points, and **bold** for key points. Keep it actionable and specific to this channel.

### If COLLABORATE intent:
Respond conversationally, acknowledge the topic/photo, share 1-2 creative angles, and ask how the creator wants to build on it.`;
    this.register({
      name: 'General Assistant',
      category: 'general',
      buildSystemPrompt: (channel, ctx) =>
        this.buildBasePrompt(channel, ctx) +
        `\n\nYou are the Unique Mecca Audio Show Agent working in GENERAL MODE. You handle any question — scripts, SEO, thumbnails, ideas, trends, strategy, personal questions, or creative collaboration.

CRITICAL: Do NOT default to writing a full script. First understand what the user actually wants. If the request is broad, open-ended, or accompanied by an image upload, engage as an active creative director: acknowledge their hook or photo, give an immediate creative recommendation, and suggest natural next steps. Never force a robotic A/B/C/D multiple-choice menu.

Only write a full script when the user explicitly says "write the script" or "write me a script" or similar clear script language.

When the user gives a specific request, match it to the right output format.

When suggesting content ideas or answering "what should I post today":
- Prioritize stories from the TRENDING TOPICS section in your context
- Use the full details provided (Summary, Source, Published Date, YouTube Video, Channel, Badge) — do NOT rely on outdated training memory
- If trending topics are loaded, reference them with their opportunity scores and actual recent developments
- If NO trending topics are loaded or data is marked stale, say: "I'm refreshing trends data now. Based on current search, here's what's trending..."
- NEVER suggest a story or angle based on outdated assumptions (e.g., verify whether the person was convicted, sentenced, had a recent altercation, or had release dates pushed back vs early release)
- Today's date is at the start of every message — use it to assess recency
- **Research depth before a pitch** (when web search is available): (1) current legal stage for named people, (2) last 14 days news, (3) YouTube/competitor coverage of the same story, (4) local affiliates if location-based. Then score and package.

When discussing ANY real-world person, criminal case, or video topic:
- Always include a dedicated **Verified Legal & Custody Status** block with current facts:
  ### Verified Legal & Custody Status
  - **Current Status:** [e.g., Convicted / Sentenced / Appealing / On Trial / UNVERIFIED — confirm docket before publishing]
  - **Facility / Custody:** [e.g., FCI Fort Dix, NJ / MDC Brooklyn / On Bail]
  - **Sentence / Charges:** [e.g., 50 months + 5 yrs supervised release]
  - **Latest Breaking Update:** [e.g., Release date delayed following prison altercation]
- **Status must come from THIS turn's live research** (court / AP / Reuters / Court TV / Law & Crime / local affiliates) — not from training memory.
- If live research does not confirm the stage this turn, write **UNVERIFIED** and do **not** ship a GREENLIGHT package built on a guessed stage (no "before trial" / "awaiting trial" / "just arrested" framing unless search confirmed it).
- Never describe an indicted/awaiting-trial story after search shows a verdict or sentence — follow search and say what changed.
- Include rich media markdown when available:
  - Subject or news image: ![Subject Name](image_url)
  - YouTube video link/card: [YouTube Video: Video Title](https://www.youtube.com/watch?v=ID) — write each YouTube URL exactly once; never also add [youtube.com](url) or a bare duplicate of the same video
  - Direct citations to reputable news sources (Court TV, Law & Crime, AP News, local reporting)

When the user asks about channel performance, strategy, what to post, content planning, or "what my audience watches / likes":
- You ARE connected to YouTube Analytics for this channel when YOUTUBE ANALYTICS appears below.
- NEVER say you cannot see private YouTube Studio / "what viewers are watching" data as a refusal. Use CHANNEL ANALYTICS / YOUTUBE ANALYTICS / TOP PERFORMING VIDEOS / EXISTING VIDEOS.
- One short honesty line is OK only if needed: you do not have per-viewer history or Studio "other videos they watched" on other channels — then answer with the data you DO have.
- Reference top watched videos (watch time + retention), traffic sources, search terms, and audience demos when present.
- Reference the COMPETITOR data, VIDEOS GETTING SEARCH TRAFFIC, and TRENDING TOPICS when relevant.
- **AUDIENCE WATCHES** = Studio competitor channels. Use their **view counts as demand proof** for a topic. Do **not** copy their edit style or produce a generic recap of their video.
- Respect user constraints (e.g. avoid redundant Lil Durk unless asked) using EXISTING VIDEOS + performance ranking.
- Only use what's relevant to the question — don't dump all data unprompted

When the user asks about a specific topic, person, or case (like "tell me about [person]" or "write a script about [topic]"):
- FIRST check the EXISTING VIDEOS section in your context
- If a video about the same topic already exists, tell the client and suggest:
  a) Updating/re-optimizing the existing video (better SEO, new thumbnail)
  b) A different angle or angle twist that hasn't been covered
  c) A follow-up or sequel video
- Never suggest the exact same topic without acknowledging the existing video
- If no existing video matches, proceed normally

When the user asks a GENERAL question not about the channel:
- Answer normally without referencing channel data
- Keep it focused on what they asked

EVIDENCE-BASED OUTPUT RULES (MANDATORY):
- Every topic, title, and thumbnail recommendation MUST cite concrete evidence from the injected context: competitor videos WITH their view counts, YOUR recent winners/below-median list, content gaps, or trend scores.
- NEVER give generic advice ("use an emotional title", "make it eye-catching", "post consistently") — replace it with: which proven video in the context this resembles, and what makes your proposal DIFFERENT.
- When proposing a topic: name the gap or competitor result that proves demand, then state your unique angle.
- When proposing packaging: reference which of your recent videos won or lost, and why this proposal breaks that pattern.
- If context lacks evidence for a claim, say what data you would need instead of inventing it.

${generalFormat}`,
      loadContext: async (channelId, videoId) => {
        const [base, trending, competitorData, existingVideos] =
          await Promise.all([
            this.loadBaseContext(channelId, videoId),
            this.trendingTopicModel
              .find({ channelId: this.oid(channelId) })
              .sort({ opportunityScore: -1 })
              .limit(5)
              .lean()
              .catch(() => []),
            this.getCompetitorBriefCached(channelId).catch(() => []),
            this.videoModel
              .find({
                channelId: this.oid(channelId),
                deletedFromYoutube: { $ne: true },
              })
              .sort({ publishedAt: -1 })
              .limit(50)
              .select('title publishedAt viewCount youtubeId')
              .lean()
              .catch(() => []),
          ]);

        base.trendingTopics = trending;
        if (competitorData.length > 0) base.competitorSummary = competitorData;
        base.existingVideos = existingVideos.map((v) => ({
          title: v.title,
          publishedAt: v.publishedAt?.toString() || '',
          viewCount: v.viewCount || 0,
          youtubeId: v.youtubeId || '',
        }));

        // Load channel analytics once (C5) — single Analytics bundle, no duplicate fan-out
        try {
          const channel = await this.channelModel.findById(channelId).lean();
          if (channel?.youtubeChannelId && channel?.userId) {
            const bundle =
              await this.performanceContext.buildChannelPerformanceContext(
                channel.userId.toString(),
                channelId.toString(),
                30,
              );
            const s = bundle.summary;
            base.channelAnalytics = {
              views: s?.views || 0,
              watchTimeHours: s?.watchTimeHours || 0,
              revenue: s?.revenue || 0,
              retentionPercent: s?.retentionPercent || 0,
              trafficSources: bundle.trafficSources || [],
              rawBundle: bundle.text,
            };
            if (bundle.topVideos?.length) {
              base.topVideos = bundle.topVideos.map((v) => ({
                title: v.title,
                viewCount: v.viewCount,
                watchMinutes: v.watchMinutes,
                retentionPercent: v.retentionPercent,
                tags: [],
              }));
            }
          }
        } catch (error) {
          this.logger.warn(
            `Failed to load analytics for context: ${error.message}`,
          );
        }

        return base;
      },
      getFormatInstructions: () => generalFormat,
      getTemperature: () => 0.7,
    });

    // Script skill — complete video package
    const scriptFormat = `Deliver the requested script/package. Default duration 7-9 minutes (about 900-1,150 spoken words), explicit duration wins and scales the word budget. Plan topic-specific sections (5-6 for the default length); no fixed courtroom or family sections. Use a single emotional center.
Wrap spoken script in <!-- SCRIPT_START --> / <!-- SCRIPT_END --> with # SCRIPT TITLE: [Topic] then numbered section headings. Follow breathable gray-rail blocks; preserve complete thoughts across short lines. Add relevant jewels and one closing CTA. Keep metadata, sources and community questions outside spoken delimiters.
For formatting-only edits output only the revised script, preserving facts and story. If a VERIFIED TOPIC FOOTAGE PACK or LOCAL NEWS FOOTAGE PACK is supplied, do NOT re-list clip URLs; the backend appends the verified list automatically. Provide usage notes and cite only real retrieved sources.
If full packaging is requested include one clear title (it names the incident first, then the hook, at most 100 characters), description/tags and exactly two thumbnail variants:
${THUMBNAIL_MARKDOWN}`;
    this.register({
      name: 'Script Writer',
      category: 'script',
      buildSystemPrompt: (channel, ctx) =>
        this.buildBasePrompt(channel, ctx) +
        `\n\nYou are a script writer for this YouTube channel. Write only requested deliverables, using topic-specific sections.

IMPORTANT RULES:
- TIMING & DURATION: ${SCRIPT_LENGTH_CONTRACT}
- REVISIONS: If the user asks to rewrite, edit, or adjust a specific section or the script (e.g. "make it more breathable"), output ONLY the revised spoken script beats. DO NOT regenerate Sections 1–7 or metadata unless requested. Apply the spoken line contract: keep gray rails and breath blocks; split long essay rails into short speakable lines inside the same block; do not isolate every sentence; keep facts/legal points; style stays dynamic.
- PRIORITIZE VERIFIED YOUTUBE VIDEO SOURCES (Court TV, Law & Crime, AP, NBC, CBS, 1090 Jake, VladTV + local market affiliates when the story is location-based) formatted as direct YouTube links: [Channel: Title](https://www.youtube.com/watch?v=VIDEO_ID). Each URL exactly once — never repeat it in How to Use or as a second link. NEVER list this channel's own videos as sources. No competitor explainer padding. Real timestamps or "full clip" only — never "Review manually".
- Keep reported facts and Unique's analysis clearly separate through wording ("reportedly", "the court found", "that's my analysis") — never as printed labels or sub-headings in the script
- State the legal status of any case (Arrested, Charged, Indicted, Convicted, Sentenced, etc.) in one spoken line, never as an on-screen header
- Use "allegedly" and "reportedly" for unconfirmed claims
- Write for teleprompter like a reformed outlaw talking straight to the streets — NOT a documentary narrator. ${SPOKEN_LINE_CONTRACT} Use [BEAT] before reveals/pivots and [PAUSE] after punch lines/questions/jewels (between breath blocks). About 3-4 cues per section (one after each 4-6 line block). Never put CTAs inside ### **JEWEL**.
- Every section ends with ### **JEWEL** (Principle -> Consequence -> Direct Question ending in '?') followed by [PAUSE]
- Place engagement CTAs (comment prompts) as short spoken rails BEFORE ### **JEWEL**. Never after ### **JEWEL**.
- For global viewers, explain American legal terms in street language when they appear
- Never present psychological interpretation as confirmed fact

EVIDENCE-BASED OUTPUT RULES (MANDATORY):
- Every topic, title, and thumbnail recommendation MUST cite concrete evidence from the injected context: competitor videos WITH their view counts, YOUR recent winners/below-median list, content gaps, or trend scores.
- NEVER give generic advice ("use an emotional title", "make it eye-catching", "post consistently") — replace it with: which proven video in the context this resembles, and what makes your proposal DIFFERENT.
- When proposing a topic: name the gap or competitor result that proves demand, then state your unique angle.
- When proposing packaging: reference which of your recent videos won or lost, and why this proposal breaks that pattern.
- If context lacks evidence for a claim, say what data you would need instead of inventing it.

${scriptFormat}`,
      loadContext: async (channelId, videoId) => {
        const base = await this.loadBaseContext(channelId, videoId);
        const trending = await this.trendingTopicModel
          .find({ channelId: this.oid(channelId) })
          .sort({ opportunityScore: -1 })
          .limit(5)
          .lean();
        base.trendingTopics = trending;
        // C1+C3: competitor demand brief + content gaps (both 60-min cached)
        const [brief, gaps] = await Promise.all([
          this.getCompetitorBriefCached(channelId).catch(() => []),
          this.getContentGapsCached(channelId).catch(() => []),
        ]);
        base.competitorSummary = brief;
        base.contentGaps = gaps;
        return base;
      },
      getFormatInstructions: () => scriptFormat,
      getTemperature: () => 0.7,
    });

    // SEO skill
    const seoFormat = `Format your response in this exact structure:

## Title
[Your optimized title: the incident first, then the hook, following the TITLE CLARITY rules]

## Description
[10-part blueprint: Search preview hook + 3-5 paragraph deep breakdown + bullet takeaways + Host Bio + CTAs + official social links + legal disclaimer + trailing #hashtags]

## Tags
[List 10-15 tags separated by commas — under 30 chars each]

## Hashtags
[3-5 hashtags with # prefix, space-separated]`;
    this.register({
      name: 'SEO Optimizer',
      category: 'seo',
      buildSystemPrompt: (channel, ctx) =>
        this.buildBasePrompt(channel, ctx) +
        `\n\nYou are an SEO optimizer for this YouTube channel. Generate optimized titles, descriptions, tags, and hashtags.\n\nRules:\n- Titles: follow the TITLE CLARITY rules below (the incident first, then the hook)\n- Descriptions: 10-Part Blueprint (Hook + 3-5 paragraph breakdown + bullet takeaways + Host Bio + CTAs + social links + disclaimer + trailing #hashtags)\n- Tags: 10-15 max, under 30 chars each\n- Hashtags: 3-5 max\n\n${TITLE_CLARITY_RULE}\n\n${seoFormat}`,
      loadContext: async (channelId, videoId) => {
        const base = await this.loadBaseContext(channelId, videoId);
        if (videoId) {
          const video = await this.videoModel.findById(videoId).lean();
          base.videoMetadata = video;
          // Load approved patterns from RAG
          try {
            const approved = await this.chromaService.query(
              'seo_suggestions',
              video?.title || '',
              3,
              { status: 'approved' },
            );
            if (approved.length > 0)
              base.approvedSeoPatterns = approved
                .map((r) => r.text)
                .join('\n---\n');
          } catch {
            /* RAG optional */
          }
        }
        // Data-driven winners / misses / baseline / traffic mix — the SAME
        // helper the details-page SEO and daily batch use (7d CTR sync).
        let patternsLoaded = false;
        try {
          base.seoPatterns = await this.seoDataService.getSeoPatternContext(
            this.oid(channelId),
          );
          patternsLoaded = base.seoPatterns.highCtrWinners.length > 0;
        } catch {
          /* patterns optional — fall back below */
        }
        if (!patternsLoaded) {
          const topVideos = await this.videoModel
            .find({ channelId: this.oid(channelId) })
            .sort({ viewCount: -1 })
            .limit(8)
            .select('title viewCount tags')
            .lean();
          base.topVideos = topVideos;
        }
        return base;
      },
      getFormatInstructions:
        () => `Format your response in this exact structure:

## Title
[Your optimized title: the incident first, then the hook, following the TITLE CLARITY rules]

## Description
[10-part blueprint: Search preview hook + 3-5 paragraph deep breakdown + bullet takeaways + Host Bio + CTAs + official social links + legal disclaimer + trailing #hashtags]

## Tags
[List 10-15 tags separated by commas — under 30 chars each]

## Hashtags
[3-5 hashtags with # prefix, space-separated]`,
      getTemperature: () => 0.5,
    });

    // Thumbnail skill
    const thumbnailFormat = THUMBNAIL_MARKDOWN;
    this.register({
      name: 'Thumbnail Designer',
      category: 'thumbnail',
      buildSystemPrompt: (channel, ctx) =>
        this.buildBasePrompt(channel, ctx) + '\n' + CREATIVE_CONTRACT + '\n' + thumbnailFormat,
      loadContext: async (channelId, videoId) => {
        const base = await this.loadBaseContext(channelId, videoId);
        try {
          const topVideos = await this.videoModel
            .find({
              channelId: this.oid(channelId),
              deletedFromYoutube: { $ne: true },
            })
            .sort({ viewCount: -1 })
            .limit(4)
            .select('title viewCount tags youtubeId')
            .lean();
          base.topVideos = topVideos.map((v) => ({
            title: v.title,
            viewCount: v.viewCount,
            tags: v.tags || [],
          }));
        } catch {
          /* optional */
        }
        return base;
      },
      getFormatInstructions: () => thumbnailFormat,
      getTemperature: () => 0.8,
    });

    // Unified Package skill — ONE complete bundle (research + title + SEO +
    // 2 auto-generated thumbnails) instead of a menu of separate options.
    const packageFormat = `Format your response in this EXACT structure. Never offer A/B/C menus, never ask which direction the user prefers, never present alternative packages — this response IS the answer:

## RESEARCH
[4-8 lines of concrete market evidence: which of YOUR recent winners this package mirrors (cite title + views/CTR from context), which low-CTR pattern it avoids, and any competitor demand proof with view counts. If context lacks evidence for a claim, say what data you would need instead of inventing it.]

## Title
[ONE primary title that follows the TITLE CLARITY rules: the incident first, then the click. It names the same incident as both thumbnails. If the message is an audit of an existing video, this title must FIX the specific packaging problem you diagnosed in RESEARCH.]

## Description
[Write the FULL 10-part blueprint — every element below, in order, nothing skipped:
1. Search-preview hook — 1-2 strong opening lines that name the subject and the stakes.
2-5. Paragraphs (3-5 of them, each 3-5 sentences — substantial, story-driven, grounded in the supplied script/topic; separate REPORTED FACTS from analysis; never invent quotes, reactions, private thoughts, or case facts).
6. Bullet takeaways — 4 bullets with emoji labels matching the channel voice: 🔥 Street Reality & Survival Lessons · 🎙️ Prison & Legal Strategy Insights · 🧭 Street Code vs. Legal Reality · 🌟 Youth Warning & Redemption (adapt text to THIS topic, keep the emoji format).
7. Host bio paragraph — "Hosted by Unique — former federal inmate of 26 years (1993–2020) on a life-plus-20-year sentence, author of A Roaring Harlem..." — prevention, accountability, growth through lived experience.
8. Engagement block — a thought-provoking comment question, then "👍 Like this video, leave a comment, and subscribe..."
9. Social links block — copy EVERY link exactly as it appears in the channel context (Facebook, Instagram, Main Channel, Second Channel). Never drop any.
10. Legal disclaimer (educational/analytical purposes, presumed innocent, not confirmation of private thoughts or procedural developments) followed by trailing #hashtags (3-5).
Also include, between the takeaways and the host bio when a series exists: "⏱️ CHAPTERS:" with 0:00 Introduction & Cold Open as the first entry (timestamps can be refined after upload), and "📺 PREVIOUS EPISODES IN THIS SERIES:" when the context references a prior part. If the user pasted an existing description to improve, preserve its chapters, series links, and hashtags — improve structure and wording, never discard working metadata.]

## Tags
[15-20 tags, comma-separated, each under 30 chars. Mix these categories:
- Subject name + common misspellings/aliases (e.g. "Christa Pike", "Krista Pike")
- Case-specific long-tail (e.g. "Colleen Slemmer murder case", "Christa Pike lethal injection")
- Topic/genre tags (e.g. "death row family trauma", "victim impact in capital cases", "criminal psychology", "courtroom psychology")
- Channel brand (e.g. "unique mecca audio")
Match the search phrases people actually type; prefer the longer descriptive tags from the winners' pattern in context over generic single words.]

## Hashtags
[3-5 hashtags with # prefix]

${THUMBNAIL_MARKDOWN}`;
    this.register({
      name: 'Unified Package',
      category: 'package',
      buildSystemPrompt: (channel, ctx) =>
        this.buildBasePrompt(channel, ctx) + '\n' + CREATIVE_CONTRACT + '\n' + TITLE_CLARITY_RULE +
        '\nFor existing videos diagnose the actual supplied metrics and packaging before proposing replacements. For new episodes use relevant channel evidence and avoid already-covered angles. Deliver one coherent package, not a menu. The title and thumbnail express the same clear promise.\n' + packageFormat,
      loadContext: async (channelId, videoId) => {
        const base = await this.loadBaseContext(channelId, videoId);
        // Market analytics: own CTR winners/misses (7d sync) — the NEW-mode title-style signal.
        let patternsLoaded = false;
        try {
          base.seoPatterns = await this.seoDataService.getSeoPatternContext(
            this.oid(channelId),
          );
          patternsLoaded = base.seoPatterns.highCtrWinners.length > 0;
        } catch {
          /* patterns optional */
        }
        if (!patternsLoaded) {
          try {
            const topVideos = await this.videoModel
              .find({ channelId: this.oid(channelId) })
              .sort({ viewCount: -1 })
              .limit(8)
              .select('title viewCount tags')
              .lean();
            base.topVideos = topVideos;
          } catch {
            /* optional */
          }
        }
        // Competitor demand brief + content gaps (60-min cached, quota savers).
        const [brief, gaps] = await Promise.all([
          this.getCompetitorBriefCached(channelId).catch(() => []),
          this.getContentGapsCached(channelId).catch(() => []),
        ]);
        base.competitorSummary = brief;
        base.contentGaps = gaps;
        // Approved/rejected SEO patterns when auditing a specific video.
        if (videoId) {
          try {
            const video = await this.videoModel.findById(videoId).lean();
            base.videoMetadata = video;
            const approved = await this.chromaService.query(
              'seo_suggestions',
              video?.title || '',
              3,
              { status: 'approved' },
            );
            if (approved.length > 0) {
              base.approvedSeoPatterns = approved
                .map((r) => r.text)
                .join('\n---\n');
            }
          } catch {
            /* RAG optional */
          }
        }
        return base;
      },
      getFormatInstructions: () => packageFormat,
      getTemperature: () => 0.6,
    });

    // Competitor skill
    const competitorFormat = `Format your analysis in this structure:

## Gap Identified
[What content gap or opportunity you found]

## Opportunity Score
[X/10]

## Recommended Angle
[How Unique Mecca should approach this topic]

## Content Strategy
- **Title idea:** [Suggested title: the incident first, then the hook, up to 100 characters]
- **Show type:** [Which of the 7 show types fits best]
- **Hook:** [Opening line to grab attention]
- **Differentiation:** [What makes this take different from competitors]`;
    this.register({
      name: 'Competitor Analyst',
      category: 'competitor',
      buildSystemPrompt: (channel, ctx) =>
        this.buildBasePrompt(channel, ctx) +
        `\n\nYou are a competitor analyst. Analyze competing channels and identify gaps and opportunities.\n\n${competitorFormat}`,
      loadContext: async (channelId, videoId) => {
        const base = await this.loadBaseContext(channelId, videoId);

        // Load actual competitor data (with real upload views)
        const competitorData = await this.loadCompetitorData(channelId, {
          withUploads: true,
        });
        if (competitorData.length > 0) {
          base.competitorSummary = competitorData;
        }

        // Also load trending for gap analysis
        const trending = await this.trendingTopicModel
          .find({ channelId: this.oid(channelId) })
          .sort({ opportunityScore: -1 })
          .limit(10)
          .lean();
        base.trendingTopics = trending;
        return base;
      },
      getFormatInstructions: () => competitorFormat,
      getTemperature: () => 0.5,
    });

    // Trends skill
    const trendsFormat = `For each trending topic, format in this structure:

### [Topic Title]

**Summary:** [1-2 sentence summary of the story]

**Opportunity Score:** [0-100]

**Recommendation:** [GREENLIGHT / HOLD / PASS]

**Content Angle:** [How Unique Mecca should cover this — what perspective, what show type]

**Why Now:** [Why this is trending and time-sensitive]`;
    this.register({
      name: 'Trend Researcher',
      category: 'trends',
      buildSystemPrompt: (channel, ctx) =>
        this.buildBasePrompt(channel, ctx) +
        `\n\nYou are a trend researcher for this channel's niche. Find and evaluate trending topics.\n\nScoring criteria:\nA. SEARCH DEMAND\nB. EMOTIONAL PRESSURE\nC. AUTHORITY FIT\nD. THUMBNAIL POWER\nE. TITLE CURIOSITY\nF. TRUST RETENTION\nG. REPLAY VALUE\nH. SPONSOR SAFETY\n\nGREENLIGHT: 8.5+ | HOLD: 7.0-8.4 | PASS: under 7.0\n\n${trendsFormat}`,
      loadContext: async (channelId) => {
        const base = await this.loadBaseContext(channelId);
        const trending = await this.trendingTopicModel
          .find({ channelId: this.oid(channelId) })
          .sort({ opportunityScore: -1 })
          .limit(5)
          .lean();
        base.trendingTopics = trending;
        return base;
      },
      getFormatInstructions: () => trendsFormat,
      getTemperature: () => 0.5,
    });

    // Ideas skill
    const ideasFormat = `Format your evaluation in this exact structure:

## Score
[X.X/10] — [GREENLIGHT / HOLD / PASS]

## Criteria
- **Search Demand:** [X/10] — [brief reason]
- **Emotional Pressure:** [X/10] — [brief reason]
- **Authority Fit:** [X/10] — [brief reason]
- **Thumbnail Power:** [X/10] — [brief reason]
- **Title Curiosity:** [X/10] — [brief reason]
- **Trust Retention:** [X/10] — [brief reason]
- **Replay Value:** [X/10] — [brief reason]
- **Sponsor Safety:** [X/10] — [brief reason]

## Improvements
- [Specific actionable improvement 1]
- [Specific actionable improvement 2]
- [Specific actionable improvement 3]`;
    this.register({
      name: 'Idea Scorer',
      category: 'ideas',
      buildSystemPrompt: (channel, ctx) =>
        this.buildBasePrompt(channel, ctx) +
        `\n\nYou are a content idea evaluator. Score ideas on 8 criteria (1-10 each):\nA. SEARCH DEMAND\nB. EMOTIONAL PRESSURE\nC. AUTHORITY FIT\nD. THUMBNAIL POWER\nE. TITLE CURIOSITY\nF. TRUST RETENTION\nG. REPLAY VALUE\nH. SPONSOR SAFETY\n\nGREENLIGHT: 8.5+ | HOLD: 7.0-8.4 | PASS: under 7.0\n\nEVIDENCE-BASED OUTPUT RULES (MANDATORY):\n- Every score MUST cite concrete evidence from the injected context: competitor videos WITH their view counts, YOUR recent winners/below-median list, content gaps, or trend scores.\n- NEVER give generic justifications ("strong topic", "good potential") — ground each criterion in a specific data point from context.\n- When scoring Search Demand: reference the gap list or competitor view counts. When scoring Thumbnail Power/Title Curiosity: reference YOUR recent winners vs below-median pattern.\n- Improvements must be specific and actionable, tied to evidence in context — not generic best-practice advice.\n- If context lacks evidence for a claim, say what data you would need instead of inventing it.\n\n${ideasFormat}`,
      loadContext: async (channelId) => {
        const base = await this.loadBaseContext(channelId);
        // Load trending for context on what's popular
        const trending = await this.trendingTopicModel
          .find({ channelId: this.oid(channelId) })
          .sort({ opportunityScore: -1 })
          .limit(5)
          .lean();
        base.trendingTopics = trending;

        // Load top videos for scoring context
        const topVideos = await this.videoModel
          .find({ channelId: this.oid(channelId) })
          .sort({ viewCount: -1 })
          .limit(5)
          .select('title viewCount tags')
          .lean();
        base.topVideos = topVideos;

        // C1+C3: competitor demand brief + content gaps (both 60-min cached)
        const [brief, gaps] = await Promise.all([
          this.getCompetitorBriefCached(channelId).catch(() => []),
          this.getContentGapsCached(channelId).catch(() => []),
        ]);
        base.competitorSummary = brief;
        base.contentGaps = gaps;

        return base;
      },
      getFormatInstructions: () => ideasFormat,
      getTemperature: () => 0.3,
    });

    // Outline skill
    const outlineFormat = `Research and plan THIS video's promise. Provide a recommended hook and topic-specific sections with purpose and estimated time. Default 7-9 minutes (5-6 sections), explicit duration wins. Prison episodes prioritize lived experience and psychology. Courtroom episodes may use deeper legal explanation. Keep community questions outside spoken duration. Do not force a fixed structure.`;
    this.register({
      name: 'Outline Builder',
      category: 'outline',
      buildSystemPrompt: (channel, ctx) =>
        this.buildBasePrompt(channel, ctx) +
        `\n\nYou are an outline builder for this YouTube channel. Before writing any script, you research the topic, develop the angle, and create a structured outline.\n\nYour job:\n1. Research the topic using web search if needed\n2. Identify the unique angle — what only this creator can say\n3. Generate 3 distinct hook options for the first 15 seconds\n4. Recommend which of the 7 show types fits best\n5. Build a topic-specific outline\n6. Score the outline using the 8-criteria system\n\nEvery outline must pass this test: could any other creator make this same video? If yes, the angle is not unique enough.\n\n${outlineFormat}`,
      loadContext: async (channelId, videoId) => {
        const base = await this.loadBaseContext(channelId, videoId);
        const trending = await this.trendingTopicModel
          .find({ channelId: this.oid(channelId) })
          .sort({ opportunityScore: -1 })
          .limit(5)
          .lean();
        base.trendingTopics = trending;
        return base;
      },
      getFormatInstructions: () => outlineFormat,
      getTemperature: () => 0.7,
    });

    // Analysis skill — Video Autopsy + Repackage Kit / Channel Diagnosis
    const analysisFormat = `## OUTPUT CONTRACT

Follow the system prompt exactly. Two modes:

**A. Video Autopsy + Repackage Kit** (when a specific video is failing):
1. ## VIDEO AUTOPSY — with verdict, metrics table, siblings, what died
2. ## REPACKAGE KIT — Title / Description / Tags / Hashtags / Thumbnails / Apply order (no COPY BUNDLE; SeoCard is the package)
Paste-ready. Target CTR = channel baseline from context.

**B. Channel Diagnosis** (why less views / what will work):
1. Verdict (primary cause A–F)
2. Numbers tables from CHANNEL HEALTH BUNDLE
3. What broke (ranked)
4. What will work (data + 14d metric)
5. 7-day plan + next actions

Never ask for Studio screenshots. Never invent metrics.`;

    this.register({
      name: 'Performance Analyst',
      category: 'analysis',
      buildSystemPrompt: (channel, ctx) =>
        this.buildBasePrompt(channel, ctx) +
        `\n\nYou are the Unique Mecca Audio Performance Analyst. Diagnose with real numbers and ship paste-ready fixes.\n\n${analysisFormat}`,
      loadContext: async (channelId, videoId) => {
        const base = await this.loadBaseContext(channelId, videoId);
        try {
          const channel = await this.channelModel.findById(channelId).lean();
          if (channel?.youtubeChannelId && channel?.userId) {
            const uid = channel.userId.toString();
            const bundle =
              await this.performanceContext.buildChannelPerformanceContext(
                uid,
                channelId.toString(),
                30,
              );
            const s = bundle.summary;
            base.channelAnalytics = {
              views: s?.views || 0,
              watchTimeHours: s?.watchTimeHours || 0,
              revenue: s?.revenue || 0,
              retentionPercent: s?.retentionPercent || 0,
              trafficSources: bundle.trafficSources || [],
              rawBundle: bundle.text,
            };
          }
        } catch (error: any) {
          this.logger.warn(
            `Analysis loadContext analytics failed: ${error.message}`,
          );
        }
        return base;
      },
      getFormatInstructions: () => analysisFormat,
      getTemperature: () => 0.4,
    });

    // Scene image skill — 16:9 cinematic b-roll/background generation
    const imageFormat = `Format 3 scene concepts in this exact structure:

### Scene Concept 1
**Scene:** [Detailed description of the 16:9 scene]
**Style:** [Cinematic style — lighting, mood, camera angle]
**Colors:** [Primary colors and atmosphere]
**Text overlay (optional):** [If applicable, complete readable wording]

### Scene Concept 2
...

### Scene Concept 3
...

🎯 Context Anchor: [What subject/topic this image is for, what video it belongs to]`;
    this.register({
      name: 'Scene Image Generator',
      category: 'image',
      buildSystemPrompt: (channel, ctx) =>
        this.buildBasePrompt(channel, ctx) +
        `\n\nYou are a scene image concept generator for YouTube video production.

When the user asks for an image, generate 3 DISTINCT scene concepts as structured text.
Each concept describes a 16:9 cinematic scene for video b-roll, background visuals, or standalone images.

CRITICAL RULES:
- DO NOT generate images directly. Present concepts as text FIRST.
- Each concept MUST include: Scene description, Style/mood, Color palette, Optional text overlay.
- Concepts should be cinematic and dramatic, matching the channel's true-crime aesthetic with BRIGHT HDR lighting (rich midtones, luminous highlights — NO murky crushed blacks, NO dark voids).
- If the user provides a reference image, describe how the concept relates to it.
- If user says "regenerate" or "change X", iterate on the previous concept with modifications.
- Keep scene descriptions concise but vivid — 1-2 sentences per field.

${imageFormat}`,
      loadContext: async (channelId, videoId) => {
        return this.loadBaseContext(channelId, videoId);
      },
      getFormatInstructions: () => imageFormat,
      getTemperature: () => 0.8,
    });
  }

  /** Skills that write in Unique's own voice; they get the persona appended LAST so it wins. */
  private static readonly PERSONA_SKILLS = new Set(['general', 'script', 'outline']);

  register(skill: ChatSkill) {
    if (SkillRegistry.PERSONA_SKILLS.has(skill.category)) {
      const build = skill.buildSystemPrompt;
      skill = {
        ...skill,
        buildSystemPrompt: (channel, ctx) => withUniquePersona(build(channel, ctx)),
      };
    }
    this.skills.set(skill.category, skill);
    this.logger.log(`Registered skill: ${skill.name} (${skill.category})`);
  }

  get(category: string): ChatSkill {
    return this.skills.get(category) || this.skills.get('general')!;
  }

  getAll(): ChatSkill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Classify user intent from message text.
   * Returns skill category name for per-message skill routing.
   * Used when no manual skill is selected — defaults to 'general'.
   */
  classifyIntent(message: string, previousAssistantMessage?: string): string {
    const trimmed = message.trim().toLowerCase();

    const menuIntent = this.resolveMenuSelection(
      trimmed,
      previousAssistantMessage,
    );
    if (menuIntent) return menuIntent;

    if (this.isThumbnailIteration(trimmed, previousAssistantMessage)) {
      return 'thumbnail';
    }

    return this.classifyTextIntent(trimmed);
  }

  /**
   * Fast-path 1 — user replied with an A/B/C/D or 1/2/3/4 menu choice
   * (e.g. "a", "b", "option a", "choice 2"). Resolves the chosen menu line to
   * its skill category. Returns null when the message is not a menu reply.
   */
  resolveMenuSelection(
    message: string,
    previousAssistantMessage?: string,
  ): string | null {
    const trimmed = message.trim().toLowerCase();
    const optionMatch = trimmed.match(
      /^(?:option\s+|choice\s+)?([a-d1-4])[\.\)]?$/i,
    );
    if (!optionMatch || !previousAssistantMessage) return null;

    const selectedKey = optionMatch[1].toUpperCase();

    // Split lines and search for option matching the key (e.g. "A. SCRIPT", "B) SEO", "1. THUMBNAIL")
    const lines = previousAssistantMessage.split('\n');
    for (const line of lines) {
      const lineTrim = line.trim();
      const optionHeaderMatch = lineTrim.match(
        /^(?:([A-D1-4])[\.\)]\s*)(.+)/i,
      );
      if (
        optionHeaderMatch &&
        optionHeaderMatch[1].toUpperCase() === selectedKey
      ) {
        const targetOptionText = optionHeaderMatch[2];
        const intentFromMenu = this.classifyTextIntent(targetOptionText);
        if (intentFromMenu !== 'general') {
          return intentFromMenu;
        }
      }
    }
    return null;
  }

  /**
   * Fast-path 2 — conversational iteration on previous thumbnail concepts
   * (e.g. "make them darker", "change concept 2", "try lighter").
   */
  isThumbnailIteration(
    message: string,
    previousAssistantMessage?: string,
  ): boolean {
    const trimmed = message.trim().toLowerCase();
    if (
      !previousAssistantMessage ||
      (!previousAssistantMessage.includes('THUMBNAILS_START') &&
        !/Concept\s*[1-3]/i.test(previousAssistantMessage))
    ) {
      return false;
    }
    return /\b(darker|lighter|change\s+concept|concept\s*[1-3]|make\s+(?:it|them)\s+(?:more|less)?\s*(?:dark|light|cinematic|dramatic|intense)|different\s+(?:angle|color|face)|add\s+(?:prosecutor|lawyer|judge|microphone|gavel)|try\s+another|give\s+me\s+\d+\s+more)\b/i.test(
      trimmed,
    );
  }

  private classifyTextIntent(lower: string): string {
    // Rule 0 — topic-recommendation signal (NARROW list; explicit scoring
    // asks stay with 'ideas'). Computed first but applied AFTER the two
    // packaging/thumbnail rules below it via `topicRec`, so that
    // "make a thumbnail for my next video" (imperative main-task) still wins,
    // while a topic ask that merely mentions "…thumbnail package" stays general.
    const topicRec =
      /\b(?:what should i (?:post|make|cover|upload)|next (?:post|video|upload)|topic (?:suggestion|idea|recommendation)|video idea|content plan)\b/i.test(
        lower,
      ) && !/\b(?:score|rate|evaluate|greenlight|rank|grade)\b/i.test(lower);

    // 1. Unified package — a metadata ask (SEO/description/tags) combined with
    //    a thumbnail ask is ONE bundle, not two skills. Runs before the
    //    thumbnail main-task rule so "give me a title, description and a
    //    thumbnail" lands on the package skill instead of splitting.
    //    Skipped for topic-recommendation asks (they stay Rule 0 / general).
    if (
      !topicRec &&
      /\b(thumbnails?|thumbs?|cover\s*arts?)\b/i.test(lower) &&
      /\b(seo|descriptions?|tags?|hashtags?|keywords?)\b/i.test(lower)
    ) {
      return 'package';
    }

    // 2. Thumbnail as MAIN TASK — imperative (≤30 char window, sentence-bounded)
    //    or object-first ("thumbnail for X").
    if (
      /\b(?:make|design|generate|create|redesign|improve|fix|give me|show me|want|need|2|two|3|three)\b[^.?!]{0,30}\b(?:thumbnail|thumbs|cover art)\b/i.test(
        lower,
      ) ||
      /\b(?:thumbnail|cover art)\s+(?:for|of|concept)/i.test(lower)
    ) {
      return 'thumbnail';
    }

    // 3. Topic-recommendation → general (no imperative thumbnail ask above).
    if (topicRec) return 'general';

    // 4. Broad thumbnail fallback (message mentions thumbnails with no topic-rec signal)
    if (/\b(thumbnails?|cover\s*arts?|thumbs?)\b/i.test(lower))
      return 'thumbnail';

    // 5. Scene image / b-roll generation
    if (
      /\b(generate.*image|create.*image|scene.*image|background.*(?:image|picture)|b.?roll|cinematic.*(?:image|scene)|picture.*(?:for|to|of)|make.*(?:image|picture)|photos?|wallpapers?)\b/i.test(
        lower,
      )
    )
      return 'image';

    // 6. Metadata / SEO (standalone — no thumbnail mention, or rule 1 already fired)
    if (
      /\b(seo|title.*description|tags?|keywords?|optimize|hashtags?|meta\s*description)\b/i.test(
        lower,
      )
    )
      return 'seo';

    // 6. Script intent (explicit script requests only)
    if (
      /\b(write.*scripts?|draft.*scripts?|full.*scripts?|teleprompter|cold\s+open|6.?part|video\s+scripts?|\bscripts?\b)\b/i.test(
        lower,
      )
    )
      return 'script';

    // 7. Analysis, Strategy & Trends
    if (
      /\b(trending|trends|what.*popular|hot topics?|current events|whats.*news)\b/i.test(
        lower,
      )
    )
      return 'trends';

    if (
      /\b(competitor|competing|other channels?|content gaps?|rivals?|what.*they.*doing)\b/i.test(
        lower,
      )
    )
      return 'competitor';

    if (
      /\b(ideas?|score.*ideas?|rate.*ideas?|evaluate|greenlight|pass)\b/i.test(
        lower,
      )
    )
      return 'ideas';

    if (
      /\b(outlines?|structure|organize|plan.*video|hooks?|angles?)\b/i.test(
        lower,
      )
    )
      return 'outline';

    // Performance analysis — video autopsy / channel diagnosis / repackage
    if (
      /\b(autopsy|repackage|re-package|why (this|that|my).{0,20}(video|upload).{0,30}(bad|fail|low)|not doing (good|well)|isn'?t doing (good|well)|click[-\s]?through|ctr|impressions|audit (my |the )?channel|channel (diagnosis|health|audit)|views? (are |is )?(down|dropped|flat|falling)|less views|fewer views|what (is |will )?work(ing)?)\b/i.test(
        lower,
      )
    ) {
      return 'analysis';
    }

    return 'general';
  }

  /**
   * STATIC system prompt — byte-identical across requests for OpenAI caching.
   * Contains: CHAT_SYSTEM_PROMPT + static skill instructions + format instructions.
   * NEVER includes dynamic data (channel stats, trending topics, etc.).
   */
  private buildBasePrompt(channel: any, context: SkillContext): string {
    const { CHAT_SYSTEM_PROMPT } = require('../../openai/prompts/chat');
    return CHAT_SYSTEM_PROMPT + '\n' + CREATIVE_CONTRACT;
  }

  /**
   * YouTube channel IDs of Studio competitors — footage pack denylist.
   * Used by ChatService.loadFootagePack so competitor/commentary uploads can
   * never enter the verified clip list.
   */
  async getCompetitorYoutubeIds(channelId: string): Promise<string[]> {
    try {
      const comps = await this.competitorModel
        .find({ channelId: this.oid(channelId) })
        .select('youtubeChannelId')
        .lean();
      return comps
        .map((c) => c.youtubeChannelId)
        .filter((id): id is string => Boolean(id));
    } catch {
      return [];
    }
  }

  /**
   * Request-driven context — additive, skill-agnostic (Phase 1d).
   * Loads data the MESSAGE asks for regardless of which skill ran, so a
   * thumbnail/ideas/etc. request that mentions competitors or duplicates still
   * gets the brief. Mutates `context` in place BEFORE buildDynamicContext.
   * No signal → no change (zero quota/latency).
   * Analytics/performance is NOT handled here — ChatService's performanceLookup
   * path owns it (isPerformanceQuery).
   */
  async applyRequestDrivenContext(
    channelId: string,
    message: string,
    context: SkillContext,
  ): Promise<void> {
    const lower = (message || '').toLowerCase();

    // Competitor brief — when the message asks about competing channels.
    if (
      !context.competitorSummary?.length &&
      /\b(competitor|rivals?|audience watches|other channels?|competing channels?|what they(?:'re| are| post| upload)|their (uploads|videos|thumbnails))\b/i.test(
        lower,
      )
    ) {
      try {
        const brief = await this.getCompetitorBriefCached(channelId);
        if (brief.length) context.competitorSummary = brief;
      } catch {
        /* optional context */
      }
    }

    // Duplicate-topic guard — when the message asks what was already covered.
    if (
      !context.existingVideos?.length &&
      /\b(already (?:made|covered|posted|did)|existing videos?|avoid duplicate|what i(?:'ve| have) (?:done|covered|posted)|before i (?:make|post|cover))\b/i.test(
        lower,
      )
    ) {
      try {
        const existing = await this.videoModel
          .find({
            channelId: this.oid(channelId),
            deletedFromYoutube: { $ne: true },
          })
          .sort({ publishedAt: -1 })
          .limit(50)
          .select('title publishedAt viewCount youtubeId')
          .lean();
        context.existingVideos = existing.map((v) => ({
          title: v.title,
          publishedAt: v.publishedAt?.toString() || '',
          viewCount: v.viewCount || 0,
          youtubeId: v.youtubeId || '',
        }));
      } catch {
        /* optional context */
      }
    }
  }

  /**
   * Build the full dynamic context string for a skill.
   * This goes in the USER MESSAGE prefix, NOT the system prompt.
   * Changes per request — breaks cache if put in system prompt.
   */
  buildDynamicContext(channel: any, context: SkillContext): string {
    const parts: string[] = [];

    if (context.channelStats) {
      parts.push(`CHANNEL STATS:\n${context.channelStats}`);
    }
    if (context.videoMetadata) {
      parts.push(
        `CURRENT VIDEO:\nTitle: ${context.videoMetadata.title}\nViews: ${context.videoMetadata.viewCount}\nTags: ${(context.videoMetadata.tags || []).join(', ')}`,
      );
    }
    if (context.trendingTopics && context.trendingTopics.length > 0) {
      let freshnessLabel = '';
      const fetchedDates = context.trendingTopics
        .filter((t: any) => t.fetchedAt)
        .map((t: any) => new Date(t.fetchedAt).getTime());
      if (fetchedDates.length > 0) {
        const newestFetchAt = Math.max(...fetchedDates);
        const daysSinceFetch = Math.round(
          (Date.now() - newestFetchAt) / (1000 * 60 * 60 * 24),
        );
        freshnessLabel =
          daysSinceFetch <= 3
            ? daysSinceFetch === 0
              ? ' ✅ Fresh (today)'
              : ` ✅ Fresh (${daysSinceFetch}d old)`
            : ` ❌ Stale (${daysSinceFetch} days old)`;
      }
      parts.push(
        `TRENDING TOPICS (Data:${freshnessLabel}):\n` +
          context.trendingTopics
            .map(
              (t: any) =>
                `- ${t.title} (Score: ${t.opportunityScore || 0}, Badge: ${t.badge || 'none'})\n` +
                `  Summary: ${t.summary || 'No summary available'}\n` +
                `  Source: ${t.source || 'Unknown'} | ${t.sourceUrl || 'No URL'}\n` +
                `  Published: ${t.publishedAt ? new Date(t.publishedAt).toLocaleDateString() : 'Unknown'}\n` +
                `  YouTube: ${t.youtubeVideoUrl || 'None matched'}\n` +
                `  Channel: ${t.youtubeChannelTitle || 'N/A'}`,
            )
            .join('\n\n'),
      );
    }
    if (context.channelAnalytics) {
      const a = context.channelAnalytics;
      if (a.rawBundle) {
        parts.push(a.rawBundle);
      } else {
        const trafficStr =
          a.trafficSources.length > 0
            ? a.trafficSources
                .map((t) => `${t.source}: ${t.views.toLocaleString()}`)
                .join(', ')
            : 'No data yet';
        parts.push(
          `CHANNEL ANALYTICS (Last 30 days):\nViews: ${a.views.toLocaleString()} | Watch Time: ${a.watchTimeHours} hrs | Revenue: $${a.revenue}\nTraffic Sources: ${trafficStr}`,
        );
      }
    }
    if (context.competitorSummary && context.competitorSummary.length > 0) {
      parts.push(
        `AUDIENCE WATCHES (Studio competitors — use for demand/topic proof only; do NOT copy their edit structure):\n` +
          context.competitorSummary
            .map((c) => {
              const subs = `${c.subscriberCount.toLocaleString()} subs`;
              const life = c.lifetimeViews
                ? ` | ${c.lifetimeViews.toLocaleString()} lifetime views`
                : '';
              const latest =
                c.recentUploads.length > 0
                  ? ` | recent: "${c.recentUploads[0].title}" — ${(c.recentUploads[0].viewCount || 0).toLocaleString()} views`
                  : '';
              return `- ${c.title} (${subs}${life})${latest}`;
            })
            .join('\n'),
      );
    }
    if (
      context.revivalOpportunities &&
      context.revivalOpportunities.length > 0
    ) {
      parts.push(
        `VIDEOS GETTING SEARCH TRAFFIC (consider re-optimizing):\n${context.revivalOpportunities.map((v) => `- "${v.title}" — ${v.viewCount.toLocaleString()} total views`).join('\n')}`,
      );
    }
    if (context.seoPatterns?.viewExamples?.length) {
      parts.push('VIEW-ONLY EXAMPLES (not measured CTR winners; compare upload age and exposure):\n' + context.seoPatterns.viewExamples.map(v => '- "' + v.title + '" ? ' + v.views + ' views').join('\n'));
    }
    if (context.seoPatterns && context.seoPatterns.highCtrWinners.length > 0) {
      const p = context.seoPatterns;
      const baselineLabel = p.channelBaselineCtr
        ? ` · channel baseline ${p.channelBaselineCtr.toFixed(1)}%`
        : '';
      parts.push(
        `PROVEN HIGH-CTR WINNING VIDEOS (${p.windowLabel}${baselineLabel} — study their title syntax, entity placement, and stakes):\n${p.highCtrWinners
          .map(
            (v, i) =>
              `${i + 1}. "${v.title}" — ${v.views.toLocaleString()} views${
                typeof v.ctr === 'number' ? ` | CTR ${v.ctr.toFixed(1)}%` : ''
              }${v.impressions ? ` | ${Math.round(v.impressions).toLocaleString()} imp` : ''}`,
          )
          .join('\n')}`,
      );
      if (p.lowCtrMisses.length > 0) {
        parts.push(
          `LOW-CTR TITLES TO AVOID (below baseline — this audience ignores these structures):\n${p.lowCtrMisses
            .map(
              (v) =>
                `- "${v.title}" — CTR ${v.ctr?.toFixed(1)}% on ${Math.round(v.impressions || 0).toLocaleString()} imp`,
            )
            .join('\n')}\nINSTRUCTION: Mirror the winners' syntax (active verbs, concrete high-stakes consequences, curiosity gap) and strictly avoid the phrasing in the misses.`,
        );
      }
      if (p.trafficMix && p.trafficMix.length > 0) {
        parts.push(
          `CHANNEL TRAFFIC MIX (7d): ${p.trafficMix.map((t) => `${t.source} ${t.sharePct}%`).join(' · ')} — Browse-heavy means the title+thumbnail must win the home feed; Search-heavy means front-load the searchable entity name.`,
        );
      }
    }
    if (context.topVideos && context.topVideos.length > 0) {
      parts.push(
        `TOP PERFORMING VIDEOS (what the audience watches most):\n${context.topVideos
          .map((v: any, i: number) => {
            const mins =
              v.watchMinutes != null
                ? ` | ${Math.round(v.watchMinutes).toLocaleString()} watch min`
                : '';
            const ret =
              v.retentionPercent != null
                ? ` | ${Math.round(v.retentionPercent)}% avg viewed`
                : '';
            return `${i + 1}. "${v.title}" — ${v.viewCount.toLocaleString()} views${mins}${ret}`;
          })
          .join('\n')}`,
      );
    }
    if (context.recentPattern) {
      parts.push(
        `${context.recentPattern}\n\nGround ALL topic/title/thumbnail advice in this pattern: winners show what this audience clicks; below-median titles show what they skip.`,
      );
    }
    if (context.contentGaps && context.contentGaps.length > 0) {
      parts.push(
        `CONTENT GAPS (competitor videos you have NOT covered — proven demand, ranked):\n` +
          context.contentGaps
            .slice(0, 15)
            .map(
              (g, i) =>
                `${i + 1}. "${g.topic}" — ${g.competitorChannel} — ${g.competitorViews.toLocaleString()} views (search demand ${g.searchDemand})`,
            )
            .join('\n'),
      );
    }
    if (context.approvedSeoPatterns) {
      parts.push(`APPROVED SEO PATTERNS:\n${context.approvedSeoPatterns}`);
    }
    if (context.existingVideos && context.existingVideos.length > 0) {
      parts.push(
        `EXISTING VIDEOS (last 50 — check before suggesting topics to avoid duplicates):\n${context.existingVideos.map((v) => `- "${v.title}" (${v.publishedAt ? new Date(v.publishedAt).toLocaleDateString() : 'unknown date'}, ${v.viewCount?.toLocaleString() || 0} views)`).join('\n')}`,
      );
    }
    if (context.localScenePack?.formatted) {
      parts.push(context.localScenePack.formatted);
    }

    return parts.join('\n\n');
  }

  /**
   * Competitor brief for AI context.
   * withUploads=false → cheap DB-only (general chat).
   * withUploads=true  → real recent upload views (ideas/competitor/script).
   */
  private async loadCompetitorData(
    channelId: string,
    opts?: { withUploads?: boolean },
  ): Promise<
    Array<{
      title: string;
      subscriberCount: number;
      lifetimeViews?: number;
      recentUploads: Array<{
        title: string;
        publishedAt: string;
        viewCount?: number;
      }>;
    }>
  > {
    try {
      // Seed only when we actually need upload depth (competitor skill).
      // Fire-and-forget — NEVER await seed inside a chat request (15 search.list
      // calls = 10-30s stall + quota burn mid-message). Startup + daily-cron are
      // the primary triggers; this only nudges backfill. Empty brief backfills
      // on the next message once the seed lands.
      if (opts?.withUploads) {
        const count = await this.competitorModel.countDocuments({
          channelId: this.oid(channelId),
        });
        if (count === 0) {
          void this.competitorsService
            .autoSeedIfIncomplete(channelId, 'chat-lazy')
            .catch((seedErr: any) =>
              this.logger.warn(
                `Audience watches lazy seed failed: ${seedErr?.message || seedErr}`,
              ),
            );
        }
        const brief = await this.competitorsService.getAudienceWatchBrief(
          channelId,
          8,
        );
        return brief.map((c) => ({
          title: c.title,
          subscriberCount: c.subscriberCount,
          lifetimeViews: c.lifetimeViews,
          recentUploads: c.recentUploads.map((u) => ({
            title: u.title,
            publishedAt: u.publishedAt,
            viewCount: u.viewCount,
          })),
        }));
      }

      // Cheap path: DB stats only (no YouTube upload scan, no seed)
      const competitors = await this.competitorModel
        .find({ channelId: this.oid(channelId) })
        .sort({ subscriberCount: -1 })
        .limit(8)
        .lean();
      return competitors.map((comp) => ({
        title: comp.title,
        subscriberCount: comp.subscriberCount || 0,
        lifetimeViews: comp.viewCount || 0,
        recentUploads: [],
      }));
    } catch (error) {
      this.logger.warn(`Failed to load competitors: ${error.message}`);
      return [];
    }
  }

  /** Cached competitor brief with real upload views (60 min). Never caches empty — backfills after seed (A6). */
  private async getCompetitorBriefCached(
    channelId: string,
  ): Promise<NonNullable<SkillContext['competitorSummary']>> {
    const hit = this.competitorBriefCache.get(channelId);
    if (
      hit &&
      Date.now() - hit.at < SkillRegistry.CTX_TTL_MS &&
      hit.data &&
      hit.data.length > 0
    ) {
      return hit.data;
    }
    const data = await this.loadCompetitorData(channelId, {
      withUploads: true,
    });
    if (data.length > 0)
      this.competitorBriefCache.set(channelId, { at: Date.now(), data });
    return data;
  }

  /** Cached content gaps (60 min) — shared by ideas + script skills, one fetch/hour max. */
  private async getContentGapsCached(
    channelId: string,
  ): Promise<NonNullable<SkillContext['contentGaps']>> {
    const hit = this.gapsCache.get(channelId);
    if (
      hit &&
      Date.now() - hit.at < SkillRegistry.CTX_TTL_MS &&
      hit.data.length > 0
    ) {
      return hit.data;
    }
    const data = await this.competitorsService.findContentGaps(channelId);
    if (data.length > 0)
      this.gapsCache.set(channelId, { at: Date.now(), data });
    return data;
  }

  /**
   * channelId is stored as ObjectId in every collection, but these schemas'
   * `type: Types.ObjectId` paths do NOT auto-cast query strings — a raw
   * string find returns 0 (verified in prod: 105 trend docs, string query 0).
   * Explicit casts elsewhere (e.g. chat findAll) are why the app still works.
   * Always funnel channelId queries through here.
   */
  private oid(channelId: string | Types.ObjectId): string | Types.ObjectId {
    if (channelId instanceof Types.ObjectId) return channelId;
    return Types.ObjectId.isValid(channelId)
      ? new Types.ObjectId(channelId)
      : channelId;
  }

  private async loadBaseContext(
    channelId: string,
    videoId?: string,
  ): Promise<SkillContext> {
    const channel = await this.channelModel.findById(channelId).lean();
    const context: SkillContext = {};

    if (channel) {
      context.channelStats = buildCompactChannelContext(channel);
    }

    if (videoId) {
      context.videoMetadata = await this.videoModel.findById(videoId).lean();
    }

    // C2: own last-14d winners vs below-median (local Mongo, zero YouTube quota).
    // Skips when <3 videos in window (median would be meaningless).
    try {
      const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const recent = await this.videoModel
        .find({
          channelId: this.oid(channelId),
          publishedAt: { $gte: cutoff },
          deletedFromYoutube: { $ne: true },
        })
        .select('title viewCount publishedAt')
        .sort({ viewCount: -1 })
        .lean();
      if (recent.length >= 3) {
        const views = recent.map((v) => v.viewCount || 0).sort((a, b) => a - b);
        const median =
          views.length % 2
            ? views[views.length >> 1]
            : Math.round(
                (views[views.length / 2 - 1] + views[views.length / 2]) / 2,
              );
        const fmt = (list: typeof recent) =>
          list
            .map(
              (v) =>
                `- "${v.title}" — ${(v.viewCount || 0).toLocaleString()} views`,
            )
            .join('\n');
        context.recentPattern =
          `YOUR LAST 14 DAYS (${recent.length} videos, median ${median.toLocaleString()} views):\n` +
          `HIGHER VIEW TOTALS (not measured CTR winners):\n${fmt(recent.filter((v) => (v.viewCount || 0) >= median))}\n\n` +
          `LOWER VIEW TOTALS (not evidence of CTR rejection; compare age and exposure):\n${fmt(recent.filter((v) => (v.viewCount || 0) < median))}`;
      }
    } catch {
      /* optional context — never block the chat */
    }

    return context;
  }
}
