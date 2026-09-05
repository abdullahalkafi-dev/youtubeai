import { Injectable, Logger } from '@nestjs/common';
import { ChatSkill, SkillContext } from './skill.interface';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Channel, ChannelDocument } from '../../mongo/schemas/channel.schema';
import { Video, VideoDocument } from '../../mongo/schemas/video.schema';
import { TrendingTopic, TrendingTopicDocument } from '../../mongo/schemas/trending-topic.schema';
import { SeoSuggestion, SeoSuggestionDocument } from '../../mongo/schemas/seo-suggestion.schema';
import { CompetitorChannel, CompetitorChannelDocument } from '../../mongo/schemas/competitor-channel.schema';
import { ChromaService } from '../../chroma/chroma.service';
import { YoutubeAnalyticsService } from '../../youtube/youtube-analytics.service';
import { buildCompactChannelContext } from '../../openai/prompts/context';

@Injectable()
export class SkillRegistry {
  private readonly logger = new Logger(SkillRegistry.name);
  private skills = new Map<string, ChatSkill>();

  constructor(
    @InjectModel(Channel.name) private readonly channelModel: Model<ChannelDocument>,
    @InjectModel(Video.name) private readonly videoModel: Model<VideoDocument>,
    @InjectModel(TrendingTopic.name) private readonly trendingTopicModel: Model<TrendingTopicDocument>,
    @InjectModel(SeoSuggestion.name) private readonly seoSuggestionModel: Model<SeoSuggestionDocument>,
    @InjectModel(CompetitorChannel.name) private readonly competitorModel: Model<CompetitorChannelDocument>,
    private readonly chromaService: ChromaService,
    private readonly analyticsService: YoutubeAnalyticsService,
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
   Act as an intuitive creative partner. Acknowledge the user's topic or image specifically, highlight a sharp narrative angle or visual hook immediately, and smoothly invite next steps (e.g., offering to spin up 3 high-CTR thumbnail concepts, draft an outline, or write an SEO package). NEVER present a rigid, robotic questionnaire or ask the user to "just type the letter".

4. NEVER output a full script unless the user explicitly asked for a script.
5. Keep responses crisp, punchy, and actionable unless the user asks for deep detail.

## OUTPUT FORMATS BY INTENT

### If SCRIPT intent:
Follow the 6-part script structure with timestamps, section headers, and 💎 JEWEL at end of each section. Always wrap the spoken script portion between "<!-- SCRIPT_START -->" and "<!-- SCRIPT_END -->". Line 1 inside "<!-- SCRIPT_START -->" MUST ALWAYS be: "# SCRIPT TITLE: [Specific Topic / Case Headline]".

### If SEO intent:
## Title
[title under 70 chars]
## Description
[10-part blueprint: hook + 3-5 paragraph breakdown + bullet takeaways + host bio + CTAs + social links + disclaimer + trailing #hashtags]
## Tags
[10-15 tags, comma-separated]
## Hashtags
[3-5 hashtags with #]

### If THUMBNAIL intent:
Always deliver your strategic explanation first in markdown, then wrap the concrete concepts inside <!-- THUMBNAILS_START --> and <!-- THUMBNAILS_END -->:
<!-- THUMBNAILS_START -->
### Concept 1: [Angle Name]
**Text overlay:** [2-4 UPPERCASE words with two-tone phrasing, e.g. "HE SAID TOO MUCH"]
**Visual concept:**
- Left Zone (0-40%): [Commanding close-up chest-up shot of named subject with physical attire and emotion]
- Center Zone (35-65%): [Key story prop, e.g. red evidence folder stamped "CASE FILE", court transcripts]
- Right Zone & Background (60-100%): [Rich background setting filling full frame, e.g. courtroom gallery with spectators, flags]
- Lighting & Camera: [35mm documentary photography, directional rim lighting, deep shadows]
**Color scheme:** [2-3 dominant colors, e.g. Cold deep blue, slate black, high-contrast white, crimson red accent]
**Why it clicks:** [1-sentence psychological rationale]

(Same 3-zone structure for Concept 2 and 3)
<!-- THUMBNAILS_END -->

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
      buildSystemPrompt: (channel, ctx) => this.buildBasePrompt(channel, ctx) + `\n\nYou are the Unique Mecca Audio Show Agent working in GENERAL MODE. You handle any question — scripts, SEO, thumbnails, ideas, trends, strategy, personal questions, or creative collaboration.

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

When discussing ANY real-world person, criminal case, or video topic:
- Always include a dedicated **Verified Legal & Custody Status** block with current facts:
  ### Verified Legal & Custody Status
  - **Current Status:** [e.g., Convicted / Sentenced / Appealing / On Trial]
  - **Facility / Custody:** [e.g., FCI Fort Dix, NJ / MDC Brooklyn / On Bail]
  - **Sentence / Charges:** [e.g., 50 months + 5 yrs supervised release]
  - **Latest Breaking Update:** [e.g., Release date delayed following prison altercation]
- Include rich media markdown when available:
  - Subject or news image: ![Subject Name](image_url)
  - YouTube video link/card: [YouTube Video: Video Title](https://www.youtube.com/watch?v=ID) or [![Video Title](thumbnail_url)](https://www.youtube.com/watch?v=ID)
  - Direct citations to reputable news sources (Court TV, Law & Crime, AP News, local reporting)

When the user asks about channel performance, strategy, what to post, or content planning:
- Reference the CHANNEL ANALYTICS data above (views, retention, traffic sources)
- Reference the COMPETITOR data above (what they're posting, gaps)
- Reference the VIDEOS GETTING SEARCH TRAFFIC above (old videos worth re-optimizing)
- Reference the TRENDING TOPICS above (with freshness label and detailed summary)
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

${generalFormat}`,
      loadContext: async (channelId, videoId) => {
        const [base, trending, competitorData, existingVideos] = await Promise.all([
          this.loadBaseContext(channelId, videoId),
          this.trendingTopicModel.find({ channelId }).sort({ opportunityScore: -1 }).limit(5).lean().catch(() => []),
          this.loadCompetitorData(channelId).catch(() => []),
          this.videoModel.find({ channelId, deletedFromYoutube: { $ne: true } }).sort({ publishedAt: -1 }).limit(50).select('title publishedAt viewCount youtubeId').lean().catch(() => []),
        ]);

        base.trendingTopics = trending;
        if (competitorData.length > 0) base.competitorSummary = competitorData;
        base.existingVideos = existingVideos.map(v => ({
          title: v.title,
          publishedAt: v.publishedAt?.toString() || '',
          viewCount: v.viewCount || 0,
          youtubeId: v.youtubeId || '',
        }));

        // Load channel analytics in parallel if channel is valid
        try {
          const channel = await this.channelModel.findById(channelId).lean();
          if (channel?.youtubeChannelId && channel?.userId) {
            const endDate = new Date().toISOString().split('T')[0];
            const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

            let trafficSources: Array<{ source: string; views: number; watchMinutes: number; subsGained: number }> = [];
            let topVideos: Array<{ videoId: string; title: string; views: number; watchMinutes: number; retentionPercent: number; revenue: number }> = [];
            try {
              [trafficSources, topVideos] = await Promise.all([
                this.analyticsService.getTrafficSources(channel.userId.toString(), channel.youtubeChannelId, startDate, endDate),
                this.analyticsService.getTopVideosByWatchTime(channel.userId.toString(), channel.youtubeChannelId, startDate, endDate, 5),
              ]);
            } catch { /* analytics optional */ }

            const totalViews = trafficSources.reduce((sum, t) => sum + (t.views || 0), 0);
            const totalWatchMinutes = trafficSources.reduce((sum, t) => sum + (t.watchMinutes || 0), 0);
            const totalRevenue = topVideos.reduce((sum, v) => sum + (v.revenue || 0), 0);
            const avgRetention = topVideos.length > 0
              ? Math.round(topVideos.reduce((sum, v) => sum + (v.retentionPercent || 0), 0) / topVideos.length)
              : 0;

            base.channelAnalytics = {
              views: totalViews,
              watchTimeHours: Math.round(totalWatchMinutes / 60),
              revenue: Math.round(totalRevenue * 100) / 100,
              retentionPercent: avgRetention,
              trafficSources: trafficSources.slice(0, 5).map(t => ({ source: t.source, views: t.views })),
            };

            if (topVideos.length > 0) {
              base.topVideos = topVideos.map(v => ({ title: v.title, viewCount: v.views, tags: [] }));
            }
          }
        } catch (error) {
          this.logger.warn(`Failed to load analytics for context: ${error.message}`);
        }

        return base;
      },
      getFormatInstructions: () => generalFormat,
      getTemperature: () => 0.7,
    });

    // Script skill — complete video package
    const scriptFormat = `## VIDEO PACKAGE OUTPUT

Unless the user requests only one specific item, provide the COMPLETE video package in this order:

### 1. STORY SCORE
[X.X/10] — GREENLIGHT / HOLD / PASS
[Brief justification for the score]

### 2. RECOMMENDED SHOW TYPE
[Which of the 7 show types] — [why in one sentence]

### 3. UNIQUE MECCA AUDIO TWIST
What most creators are missing about this story. Pick the hidden angle:
- The psychological cell (what's happening in the mind that nobody sees)
- The family sentence (the punishment that extends to mothers, children, siblings)
- The courtroom translation of street behavior (what the jury sees vs what the street sees)
- The camera becoming the informant (social media, body cams, texts as evidence)
- The one weak link destroying the whole crew
- Freedom outside but fear inside (out on bail but mentally imprisoned)
- The sentence beginning before the judge speaks
- The cost of five reckless seconds

### 4. BEST LESSON ANGLE
The single most powerful teaching point for this video — what does the audience walk away knowing?

### 5. THREE TITLE OPTIONS
A. [Title under 70 chars]
B. [Title under 70 chars]
C. [Title under 70 chars]

### 6. THREE THUMBNAIL TEXT OPTIONS
A. [2-4 words]
B. [2-4 words]
C. [2-4 words]

### 7. THUMBNAIL VISUAL CONCEPT
[Describe the image, color scheme, layout]

### 8. FULL TELEPROMPTER SCRIPT
CRITICAL DELIMITER RULE: Wrap Section 8 strictly between "<!-- SCRIPT_START -->" and "<!-- SCRIPT_END -->".
Format Section 8 strictly as a spoken-cadence teleprompter script:

<!-- SCRIPT_START -->
# SCRIPT TITLE: [Specific Topic / Case Headline]

# [EPISODE TITLE]

## 1. COLD OPEN [0:00 - 0:45]
[Teleprompter lines with **• Lead**, > Spoken breaths, [BEAT]]

## 2. WHAT HAPPENED [0:45 - 2:30]
[Teleprompter lines with verified facts + parenthetical citations e.g. (AP, 2025)]

## 3. UNIQUE MECCA BREAKDOWN [2:30 - 6:30]
[Teleprompter lines with street code translation & prison psychology]

## 4. THE HUMAN COST [6:30 - 8:30]
[Teleprompter lines — Mother, family, lost years]

## 5. THE YOUTH WARNING [8:30 - 10:30]
[Teleprompter lines — Direct warning to young viewers]

### 💎 JEWEL
**[Moral lesson]**
> [Spoken takeaway]

---

# 10 VIRAL QUESTIONS [10:30 - 12:00]
**1. [QUESTION]?**
> [Spoken probe]

### 💎 FINAL JEWEL
**[Concluding wisdom]**
<!-- SCRIPT_END -->

End each section with **💎 JEWEL:** [moral lesson]
After each jewel, rotate a branded audience prompt.

### 9. YOUTUBE DESCRIPTION
Search preview snippet + 3-5 paragraph deep breakdown + bullet takeaways + host bio + CTAs + official social links + legal disclaimer + trailing #hashtags.

### 10. HIGH-VOLUME KEYWORDS
[List 10-15 high-search-volume keywords]

### 11. HIGH-CPM KEYWORDS
[List 5-10 keywords that attract high-paying advertisers]

### 12. HASHTAGS
[3-5 hashtags with # prefix]

### 13. YOUTUBE TAG-BOX KEYWORDS
[15-20 tags for the YouTube tag field, comma-separated]

### 14. TEN VIRAL AUDIENCE QUESTIONS
1. [Question] — [Brief answer that sparks debate]
2. [Question] — [Brief answer]
... (10 total)

### 15. THREE PINNED-COMMENT OPTIONS
A. [Engagement question for the pinned comment]
B. [Different angle engagement question]
C. [Third option]

### 16. ONE SHORTS CONCEPT
**Title:** [Short title]
**Clip:** [Which 45-59 second section of the script to extract]
**Hook:** [The first 3 seconds]
**Text overlay:** [What text to put on screen]

## 17. 📺 VERIFIED YOUTUBE VIDEO SOURCES & B-ROLL CLIPS (PRIORITY #1)
Always provide 2 to 4 real YouTube video links from Court TV, Law & Crime, AP, NBC, CBS, 1090 Jake, VladTV with recommended timestamps:
1. [Channel Name: Video Title](https://www.youtube.com/watch?v=VIDEO_ID)
   - Scene / Timestamp: [e.g. 0:45–1:15]
   - How to Use: [e.g. Overlay B-roll at Section 2]

## 18. 📰 OFFICIAL CASE & NEWS SOURCES
1. [Publication Name](URL)
2. [Publication Name](URL)`;
    this.register({
      name: 'Script Writer',
      category: 'script',
      buildSystemPrompt: (channel, ctx) => this.buildBasePrompt(channel, ctx) + `\n\nYou are a script writer for this YouTube channel. Write complete video packages that follow the 6-part structure.

IMPORTANT RULES:
- TIMING & DURATION: Script pacing MUST target 9 to 14 minutes (approx. 1,300 to 1,900 words spoken at ~140 WPM) unless the user explicitly requests a different duration.
- REVISIONS: If the user asks to rewrite, edit, or adjust a specific section or the script, output ONLY the revised spoken script beats. DO NOT regenerate Sections 1–7 or metadata unless requested.
- PRIORITIZE VERIFIED YOUTUBE VIDEO SOURCES (Court TV, Law & Crime, AP, NBC, 1090 Jake, VladTV) formatted as direct YouTube links: [Channel: Title](https://www.youtube.com/watch?v=VIDEO_ID)
- Separate REPORTED FACTS from UNIQUE'S ANALYSIS clearly in the script
- Label the legal status of any case (Arrested, Charged, Indictmented, Convicted, Sentenced, etc.)
- Use "allegedly" and "reportedly" for unconfirmed claims
- Write for teleprompter: short lines, natural contractions, 8-15 beats per section
- Every section ends with a 💎 JEWEL moral lesson
- After each jewel, include a rotating branded audience prompt
- For global viewers, explain American legal terms in street language when they appear
- Never present psychological interpretation as confirmed fact

${scriptFormat}`,
      loadContext: async (channelId, videoId) => {
        const base = await this.loadBaseContext(channelId, videoId);
        const trending = await this.trendingTopicModel.find({ channelId }).sort({ opportunityScore: -1 }).limit(5).lean();
        base.trendingTopics = trending;
        return base;
      },
      getFormatInstructions: () => scriptFormat,
      getTemperature: () => 0.85,
    });

    // SEO skill
    const seoFormat = `Format your response in this exact structure:

## Title
[Your optimized title here — under 70 characters, curious, emotional]

## Description
[10-part blueprint: Search preview hook + 3-5 paragraph deep breakdown + bullet takeaways + Host Bio + CTAs + official social links + legal disclaimer + trailing #hashtags]

## Tags
[List 10-15 tags separated by commas — under 30 chars each]

## Hashtags
[3-5 hashtags with # prefix, space-separated]`;
    this.register({
      name: 'SEO Optimizer',
      category: 'seo',
      buildSystemPrompt: (channel, ctx) => this.buildBasePrompt(channel, ctx) + `\n\nYou are an SEO optimizer for this YouTube channel. Generate optimized titles, descriptions, tags, and hashtags.\n\nRules:\n- Titles: Under 70 chars, curious, emotional words\n- Descriptions: 10-Part Blueprint (Hook + 3-5 paragraph breakdown + bullet takeaways + Host Bio + CTAs + social links + disclaimer + trailing #hashtags)\n- Tags: 10-15 max, under 30 chars each\n- Hashtags: 3-5 max\n\n${seoFormat}`,
      loadContext: async (channelId, videoId) => {
        const base = await this.loadBaseContext(channelId, videoId);
        if (videoId) {
          const video = await this.videoModel.findById(videoId).lean();
          base.videoMetadata = video;
          // Load approved patterns from RAG
          try {
            const approved = await this.chromaService.query('seo_suggestions', video?.title || '', 3, { status: 'approved' });
            if (approved.length > 0) base.approvedSeoPatterns = approved.map(r => r.text).join('\n---\n');
          } catch { /* RAG optional */ }
        }
        const topVideos = await this.videoModel.find({ channelId }).sort({ viewCount: -1 }).limit(8).select('title viewCount tags').lean();
        base.topVideos = topVideos;
        return base;
      },
      getFormatInstructions: () => `Format your response in this exact structure:

## Title
[Your optimized title here — under 70 characters, curious, emotional]

## Description
[10-part blueprint: Search preview hook + 3-5 paragraph deep breakdown + bullet takeaways + Host Bio + CTAs + official social links + legal disclaimer + trailing #hashtags]

## Tags
[List 10-15 tags separated by commas — under 30 chars each]

## Hashtags
[3-5 hashtags with # prefix, space-separated]`,
      getTemperature: () => 0.5,
    });

    // Thumbnail skill
    const thumbnailFormat = `Always wrap all 3 thumbnail concepts strictly inside the delimiters <!-- THUMBNAILS_START --> and <!-- THUMBNAILS_END -->:

<!-- THUMBNAILS_START -->
### Concept 1: [Angle Name]
**Text overlay:** [2-4 UPPERCASE words with two-tone phrasing, e.g. "HE SAID TOO MUCH"]
**Visual concept:**
- Left Zone (0-40%): [Commanding close-up chest-up shot (40-60% canvas height) of named subject with physical attire and distinct emotional expression]
- Center Zone (35-65%): [Key story prop or split, e.g. red evidence dossier stamped "CASE FILE", scattered transcripts, or confrontation point]
- Right Zone & Background (60-100%): [Rich background setting filling the full canvas edge-to-edge, e.g. courtroom gallery with seated spectators in suits, jury box, flags, or warm paneling]
- Lighting & Camera: [35mm documentary photography, 85mm portrait lens, directional rim lighting, deep chiaroscuro]
**Color scheme:** [2-3 dominant colors, e.g. Cold deep blue, slate black, high-contrast white, crimson red accent]
**Why it clicks:** [1-sentence psychological rationale]

### Concept 2: [Angle Name]
**Text overlay:** [2-4 UPPERCASE words max, e.g. "UNDER PRESSURE"]
**Visual concept:**
- Left Zone (0-40%): [Named subject close-up with physical attire and emotional expression]
- Center Zone (35-65%): [Forensic evidence dossier, documents, scales of justice, or confrontation point]
- Right Zone & Background (60-100%): [Full atmospheric courtroom or holding corridor environment filling the right side]
- Lighting & Camera: [Dramatic high-contrast 35mm photo style]
**Color scheme:** [Primary colors to use]
**Why it clicks:** [Rationale]

### Concept 3: [Angle Name]
**Text overlay:** [2-4 UPPERCASE words max]
**Visual concept:**
- Left Zone (0-40%): [Intense commanding portrait or face-off with physical attire]
- Center Zone (35-65%): [Symbolic evidence anchor, defense table, or document stack]
- Right Zone & Background (60-100%): [Atmospheric courtroom bench or dim gallery filling the full canvas]
- Lighting & Camera: [High-contrast chiaroscuro lighting, 35mm photo look]
**Color scheme:** [Primary colors to use]
**Why it clicks:** [Rationale]
<!-- THUMBNAILS_END -->`;
    this.register({
      name: 'Thumbnail Designer',
      category: 'thumbnail',
      buildSystemPrompt: (channel, ctx) =>
        this.buildBasePrompt(channel, ctx) +
        `\n\nYou are the lead Thumbnail Director for "Unique Mecca Audio" (@uniquemeccaaudionyc), specializing in high-CTR, cinematic thumbnails for criminal psychology, legal breakdowns, and prison reality.

Generate 3 DISTINCT, story-grounded thumbnail concepts specifically tailored to the user's video topic across 3 diverse narrative angles & visual framings:
1. Concept 1 (Multi-Character Drama & Emotional Contrast): When multiple figures are involved (e.g. rapper, defense lawyer, co-defendant, witness), give EACH named person a contrasting, heightened facial expression (e.g., Lawyer smiling/confident on left, Defendant stressed/looking down in center, Witness angry/defensive on right).
2. Concept 2 (Evidence & Forensic Tension): Focus on high-stakes documentary devices — e.g. a red confidential evidence dossier ("CASE FILE: ..."), dramatic spotlight on documents, scales of justice, or subject in profile shadow.
3. Concept 3 (Psychological Atmosphere / Solitary Tension): Focus on a powerful solitary portrait or scene — e.g. subject in holding cell or courtroom spotlight, deep chiaroscuro shadows, intense emotional gaze.

RULES:
- Text overlay: EXACTLY 2 to 4 bold impact words in UPPERCASE (e.g. "HE SAID TOO MUCH", "UNDER PRESSURE", "TELLING ON THE DEAD?"). Use two-tone phrasing (Line 1 White, Line 2 Yellow or Red). Do NOT output full titles or long sentences.
- FULL-CANVAS 3-ZONE STAGING: Fill the entire 16:9 canvas with rich environmental detail from left to right. NEVER leave the right side as an empty black void. Background courtroom spectators, jury benches, and architectural details must extend across the full frame.
- SUBJECT PROXIMITY: Subjects must be commanding close-up chest-up shots (occupying 40–60% of canvas height). Never place subjects far away as tiny distant figures.
- CONTEXTUAL STORY DEVICES: Use broken glass fracture seam ONLY when the story specifically involves broken trust, confessions, or betrayal. Otherwise use clean directional spotlights, authentic red evidence dossiers, transcripts, scales of justice, or American flags.
- TYPOGRAPHY & OVERLAY CLEARANCE: Headline text belongs in the left third or top-left. Never place headline text in the bottom-right corner (reserved for Unique Mecca host sticker).
- GPT-IMAGE-2 CAMERA-READY DIRECTIVE: Describe ONLY tangible physical objects, lighting, and attire that a camera can photograph. STRICTLY FORBIDDEN: Never write meta-disclaimers ("legally sourced image", "no fake courtroom events", "not a fabricated reaction", "representing consequence", "allegedly").
- Style: Cinematic dark, dramatic chiaroscuro lighting, high-contrast photography look. Realistic photo style, NOT cartoon or 3D animation.

${thumbnailFormat}`,
      loadContext: async (channelId, videoId) => {
        const base = await this.loadBaseContext(channelId, videoId);
        try {
          const topVideos = await this.videoModel
            .find({ channelId, deletedFromYoutube: { $ne: true } })
            .sort({ viewCount: -1 })
            .limit(4)
            .select('title viewCount tags youtubeId')
            .lean();
          base.topVideos = topVideos.map(v => ({ title: v.title, viewCount: v.viewCount, tags: v.tags || [] }));
        } catch { /* optional */ }
        return base;
      },
      getFormatInstructions: () => thumbnailFormat,
      getTemperature: () => 0.8,
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
- **Title idea:** [Suggested title]
- **Show type:** [Which of the 7 show types fits best]
- **Hook:** [Opening line to grab attention]
- **Differentiation:** [What makes this take different from competitors]`;
    this.register({
      name: 'Competitor Analyst',
      category: 'competitor',
      buildSystemPrompt: (channel, ctx) => this.buildBasePrompt(channel, ctx) + `\n\nYou are a competitor analyst. Analyze competing channels and identify gaps and opportunities.\n\n${competitorFormat}`,
      loadContext: async (channelId, videoId) => {
        const base = await this.loadBaseContext(channelId, videoId);

        // Load actual competitor data
        const competitorData = await this.loadCompetitorData(channelId);
        if (competitorData.length > 0) {
          base.competitorSummary = competitorData;
        }

        // Also load trending for gap analysis
        const trending = await this.trendingTopicModel.find({ channelId }).sort({ opportunityScore: -1 }).limit(10).lean();
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
      buildSystemPrompt: (channel, ctx) => this.buildBasePrompt(channel, ctx) + `\n\nYou are a trend researcher for this channel's niche. Find and evaluate trending topics.\n\nScoring criteria:\nA. SEARCH DEMAND\nB. EMOTIONAL PRESSURE\nC. AUTHORITY FIT\nD. THUMBNAIL POWER\nE. TITLE CURIOSITY\nF. TRUST RETENTION\nG. REPLAY VALUE\nH. SPONSOR SAFETY\n\nGREENLIGHT: 8.5+ | HOLD: 7.0-8.4 | PASS: under 7.0\n\n${trendsFormat}`,
      loadContext: async (channelId) => {
        const base = await this.loadBaseContext(channelId);
        const trending = await this.trendingTopicModel.find({ channelId }).sort({ opportunityScore: -1 }).limit(5).lean();
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
      buildSystemPrompt: (channel, ctx) => this.buildBasePrompt(channel, ctx) + `\n\nYou are a content idea evaluator. Score ideas on 8 criteria (1-10 each):\nA. SEARCH DEMAND\nB. EMOTIONAL PRESSURE\nC. AUTHORITY FIT\nD. THUMBNAIL POWER\nE. TITLE CURIOSITY\nF. TRUST RETENTION\nG. REPLAY VALUE\nH. SPONSOR SAFETY\n\nGREENLIGHT: 8.5+ | HOLD: 7.0-8.4 | PASS: under 7.0\n\n${ideasFormat}`,
      loadContext: async (channelId) => {
        const base = await this.loadBaseContext(channelId);
        // Load trending for context on what's popular
        const trending = await this.trendingTopicModel
          .find({ channelId })
          .sort({ opportunityScore: -1 })
          .limit(5)
          .lean();
        base.trendingTopics = trending;

        // Load top videos for scoring context
        const topVideos = await this.videoModel
          .find({ channelId })
          .sort({ viewCount: -1 })
          .limit(5)
          .select('title viewCount tags')
          .lean();
        base.topVideos = topVideos;

        return base;
      },
      getFormatInstructions: () => ideasFormat,
      getTemperature: () => 0.3,
    });

    // Outline skill
    const outlineFormat = `Format your response in this exact structure:

## Hook Options

### Hook 1: [The Angle Name]
[Opening 15-second script — the line that makes them stop scrolling]

### Hook 2: [The Story Name]
[Opening 15-second script — different approach]

### Hook 3: [The Stakes Name]
[Opening 15-second script — third approach]

## Recommended Show Type
[Which of the 7 show types fits best] — [why in one sentence]

## Outline

### COLD OPEN [0:00 - 0:45]
- [The point to make, said plainly]

### WHAT HAPPENED [0:45 - 2:30]
- [Fact 1]
- [Fact 2]

### UNIQUE MECCA BREAKDOWN [2:30 - 6:30]
- [Analysis point 1]
- [Analysis point 2]
- [Analysis point 3]

### THE HUMAN COST [6:30 - 8:30]
- [Human element 1]
- [Human element 2]

### THE YOUTH WARNING [8:30 - 10:30]
- [Warning point]

### FINAL JEWEL + 10 VIRAL Q&As [10:30 - 12:00]
- **JEWEL:** [The moral lesson]
- [5 of the 10 viral questions]

## Score
[X.X/10] — [GREENLIGHT / HOLD / PASS]

- Search Demand: [X/10]
- Emotional Pressure: [X/10]
- Authority Fit: [X/10]
- Thumbnail Power: [X/10]`;
    this.register({
      name: 'Outline Builder',
      category: 'outline',
      buildSystemPrompt: (channel, ctx) => this.buildBasePrompt(channel, ctx) + `\n\nYou are an outline builder for this YouTube channel. Before writing any script, you research the topic, develop the angle, and create a structured outline.\n\nYour job:\n1. Research the topic using web search if needed\n2. Identify the unique angle — what only this creator can say\n3. Generate 3 distinct hook options for the first 15 seconds\n4. Recommend which of the 7 show types fits best\n5. Build a detailed outline following the 6-part structure\n6. Score the outline using the 8-criteria system\n\nEvery outline must pass this test: could any other creator make this same video? If yes, the angle is not unique enough.\n\n${outlineFormat}`,
      loadContext: async (channelId, videoId) => {
        const base = await this.loadBaseContext(channelId, videoId);
        const trending = await this.trendingTopicModel.find({ channelId }).sort({ opportunityScore: -1 }).limit(5).lean();
        base.trendingTopics = trending;
        return base;
      },
      getFormatInstructions: () => outlineFormat,
      getTemperature: () => 0.7,
    });

    // Scene image skill — 16:9 cinematic b-roll/background generation
    const imageFormat = `Format 3 scene concepts in this exact structure:

### Scene Concept 1
**Scene:** [Detailed description of the 16:9 scene]
**Style:** [Cinematic style — lighting, mood, camera angle]
**Colors:** [Primary colors and atmosphere]
**Text overlay (optional):** [If applicable, 2-4 words]

### Scene Concept 2
...

### Scene Concept 3
...

🎯 Context Anchor: [What subject/topic this image is for, what video it belongs to]`;
    this.register({
      name: 'Scene Image Generator',
      category: 'image',
      buildSystemPrompt: (channel, ctx) => this.buildBasePrompt(channel, ctx) + `\n\nYou are a scene image concept generator for YouTube video production.

When the user asks for an image, generate 3 DISTINCT scene concepts as structured text.
Each concept describes a 16:9 cinematic scene for video b-roll, background visuals, or standalone images.

CRITICAL RULES:
- DO NOT generate images directly. Present concepts as text FIRST.
- Each concept MUST include: Scene description, Style/mood, Color palette, Optional text overlay.
- Concepts should be cinematic, dramatic, and match the channel's dark/true-crime aesthetic.
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

  register(skill: ChatSkill) {
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

    // Check if user is responding to an A/B/C/D or 1/2/3/4 menu choice (e.g. "a", "b", "option a", "choice 2")
    const optionMatch = trimmed.match(/^(?:option\s+|choice\s+)?([a-d1-4])[\.\)]?$/i);
    if (optionMatch && previousAssistantMessage) {
      const selectedKey = optionMatch[1].toUpperCase();

      // Split lines and search for option matching the key (e.g. "A. SCRIPT", "B) SEO", "1. THUMBNAIL")
      const lines = previousAssistantMessage.split('\n');
      for (const line of lines) {
        const lineTrim = line.trim();
        const optionHeaderMatch = lineTrim.match(/^(?:([A-D1-4])[\.\)]\s*)(.+)/i);
        if (optionHeaderMatch && optionHeaderMatch[1].toUpperCase() === selectedKey) {
          const targetOptionText = optionHeaderMatch[2];
          const intentFromMenu = this.classifyTextIntent(targetOptionText);
          if (intentFromMenu !== 'general') {
            return intentFromMenu;
          }
        }
      }
    }

    // Check for conversational iteration on previous thumbnails (e.g. "make them darker", "change concept 2", "try lighter")
    if (previousAssistantMessage && (previousAssistantMessage.includes('THUMBNAILS_START') || /Concept\s*[1-3]/i.test(previousAssistantMessage))) {
      if (/\b(darker|lighter|change\s+concept|concept\s*[1-3]|make\s+(?:it|them)\s+(?:more|less)?\s*(?:dark|light|cinematic|dramatic|intense)|different\s+(?:angle|color|face)|add\s+(?:prosecutor|lawyer|judge|microphone|gavel)|try\s+another|give\s+me\s+\d+\s+more)\b/i.test(trimmed)) {
        return 'thumbnail';
      }
    }

    return this.classifyTextIntent(trimmed);
  }

  private classifyTextIntent(lower: string): string {
    // 1. Action-specific visual intents FIRST (handles singular/plural and phrase patterns)
    if (/\b(thumbnails?|cover\s*arts?|thumbs?)\b/i.test(lower)) return 'thumbnail';

    if (/\b(generate.*image|create.*image|scene.*image|background.*(?:image|picture)|b.?roll|cinematic.*(?:image|scene)|picture.*(?:for|to|of)|make.*(?:image|picture)|photos?|wallpapers?)\b/i.test(lower)) return 'image';

    // 2. Metadata / SEO
    if (/\b(seo|title.*description|tags?|keywords?|optimize|hashtags?|meta\s*description)\b/i.test(lower)) return 'seo';

    // 3. Script intent (explicit script requests only)
    if (/\b(write.*scripts?|draft.*scripts?|full.*scripts?|teleprompter|cold\s+open|6.?part|video\s+scripts?|\bscripts?\b)\b/i.test(lower)) return 'script';

    // 4. Analysis, Strategy & Trends
    if (/\b(trending|trends|what.*popular|hot topics?|current events|whats.*news)\b/i.test(lower)) return 'trends';

    if (/\b(competitor|competing|other channels?|content gaps?|rivals?|what.*they.*doing)\b/i.test(lower)) return 'competitor';

    if (/\b(ideas?|score.*ideas?|rate.*ideas?|evaluate|greenlight|pass)\b/i.test(lower)) return 'ideas';

    if (/\b(outlines?|structure|organize|plan.*video|hooks?|angles?)\b/i.test(lower)) return 'outline';

    return 'general';
  }

  /**
   * STATIC system prompt — byte-identical across requests for OpenAI caching.
   * Contains: CHAT_SYSTEM_PROMPT + static skill instructions + format instructions.
   * NEVER includes dynamic data (channel stats, trending topics, etc.).
   */
  private buildBasePrompt(channel: any, context: SkillContext): string {
    const { CHAT_SYSTEM_PROMPT } = require('../../openai/prompts/chat');
    return CHAT_SYSTEM_PROMPT;
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
      parts.push(`CURRENT VIDEO:\nTitle: ${context.videoMetadata.title}\nViews: ${context.videoMetadata.viewCount}\nTags: ${(context.videoMetadata.tags || []).join(', ')}`);
    }
    if (context.trendingTopics && context.trendingTopics.length > 0) {
      let freshnessLabel = '';
      const fetchedDates = context.trendingTopics
        .filter((t: any) => t.fetchedAt)
        .map((t: any) => new Date(t.fetchedAt).getTime());
      if (fetchedDates.length > 0) {
        const newestFetchAt = Math.max(...fetchedDates);
        const daysSinceFetch = Math.round(
          (Date.now() - newestFetchAt) / (1000 * 60 * 60 * 24)
        );
        freshnessLabel = daysSinceFetch <= 3
          ? (daysSinceFetch === 0 ? ' ✅ Fresh (today)' : ` ✅ Fresh (${daysSinceFetch}d old)`)
          : ` ❌ Stale (${daysSinceFetch} days old)`;
      }
      parts.push(
        `TRENDING TOPICS (Data:${freshnessLabel}):\n` +
        context.trendingTopics.map((t: any) =>
          `- ${t.title} (Score: ${t.opportunityScore || 0}, Badge: ${t.badge || 'none'})\n` +
          `  Summary: ${t.summary || 'No summary available'}\n` +
          `  Source: ${t.source || 'Unknown'} | ${t.sourceUrl || 'No URL'}\n` +
          `  Published: ${t.publishedAt ? new Date(t.publishedAt).toLocaleDateString() : 'Unknown'}\n` +
          `  YouTube: ${t.youtubeVideoUrl || 'None matched'}\n` +
          `  Channel: ${t.youtubeChannelTitle || 'N/A'}`
        ).join('\n\n')
      );
    }
    if (context.channelAnalytics) {
      const a = context.channelAnalytics;
      const trafficStr = a.trafficSources.length > 0
        ? a.trafficSources.map(t => `${t.source}: ${t.views.toLocaleString()}`).join(', ')
        : 'No data yet';
      parts.push(`CHANNEL ANALYTICS (Last 30 days):\nViews: ${a.views.toLocaleString()} | Watch Time: ${a.watchTimeHours} hrs | Revenue: $${a.revenue}\nTraffic Sources: ${trafficStr}`);
    }
    if (context.competitorSummary && context.competitorSummary.length > 0) {
      parts.push(`COMPETITORS:\n${context.competitorSummary.map(c => `- ${c.title} (${c.subscriberCount.toLocaleString()} subs)${c.recentUploads.length > 0 ? `, latest: "${c.recentUploads[0].title}"` : ''}`).join('\n')}`);
    }
    if (context.revivalOpportunities && context.revivalOpportunities.length > 0) {
      parts.push(`VIDEOS GETTING SEARCH TRAFFIC (consider re-optimizing):\n${context.revivalOpportunities.map(v => `- "${v.title}" — ${v.viewCount.toLocaleString()} total views`).join('\n')}`);
    }
    if (context.topVideos && context.topVideos.length > 0) {
      parts.push(`TOP PERFORMING VIDEOS:\n${context.topVideos.map((v: any, i: number) => `${i + 1}. "${v.title}" — ${v.viewCount.toLocaleString()} views`).join('\n')}`);
    }
    if (context.approvedSeoPatterns) {
      parts.push(`APPROVED SEO PATTERNS:\n${context.approvedSeoPatterns}`);
    }
    if (context.existingVideos && context.existingVideos.length > 0) {
      parts.push(`EXISTING VIDEOS (last 50 — check before suggesting topics to avoid duplicates):\n${context.existingVideos.map(v => `- "${v.title}" (${v.publishedAt ? new Date(v.publishedAt).toLocaleDateString() : 'unknown date'}, ${v.viewCount?.toLocaleString() || 0} views)`).join('\n')}`);
    }

    return parts.join('\n\n');
  }

  private async loadCompetitorData(channelId: string): Promise<Array<{ title: string; subscriberCount: number; recentUploads: Array<{ title: string; publishedAt: string }> }>> {
    try {
      const competitors = await this.competitorModel
        .find({ channelId })
        .sort({ subscriberCount: -1 })
        .limit(5)
        .lean();

      // Note: Competitor videos are NOT in the user's DB (they're external channels).
      // recentUploads is always empty — this is by design. The AI uses subscriberCount
      // and title for competitor analysis, not their video lists.
      return competitors.map((comp) => ({
        title: comp.title,
        subscriberCount: comp.subscriberCount,
        recentUploads: [],
      }));
    } catch (error) {
      this.logger.warn(`Failed to load competitors: ${error.message}`);
      return [];
    }
  }

  private async loadBaseContext(channelId: string, videoId?: string): Promise<SkillContext> {
    const channel = await this.channelModel.findById(channelId).lean();
    const context: SkillContext = {};

    if (channel) {
      context.channelStats = buildCompactChannelContext(channel);
    }

    if (videoId) {
      context.videoMetadata = await this.videoModel.findById(videoId).lean();
    }

    return context;
  }
}
