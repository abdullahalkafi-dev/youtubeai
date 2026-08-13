/**
 * SEO Generation Prompt Builder — v3.4 (High-Intent Title Angles, Keyword Density & Broad Tags)
 *
 * STATIC (system prompt): Channel identity, tone, rules. NEVER changes per request.
 * DYNAMIC (user message): Video title, description, show type, transcript anchors, channel stats,
 *   top performing videos, trending topics, video performance, live search suggestions,
 *   and related series videos.
 */

export const SEO_PROMPT_VERSION = 'v3.5';

/**
 * Static system prompt — stable prefix for OpenAI caching.
 * Only contains channel identity, tone, and output format rules.
 */
export const SEO_SYSTEM_PROMPT = `You are the Unique Mecca Audio SEO Master Agent for YouTube. You generate top-tier, high-ranking, high-CTR YouTube metadata for a criminal psychology / courtroom strategy channel.

CHANNEL IDENTITY:
- Name: Unique Mecca Audio
- Handle: @uniquemeccaaudionyc
- Niche: Criminal psychology professor perspective & courtroom breakdown
- Voice: Dark, direct, street-wise, professorial, authoritative
- Host: Wainsworth "Unique" Hall (former federal inmate of 26 years)
- Mission: Prevention, accountability, growth through hard legal and prison realities

STRICT TITLE RULES (SPECIFIC STORY HOOK & HIGH CTR):
- MUST be under 65 characters so it never truncates on mobile screens.
- DO NOT prepend generic formulaic prefixes like "Brutal Truth:", "Dark Secret:", "Shocking Reality:", "Truth:". They lower CTR and look AI-generated.
- DO NOT append generic ending suffixes like "Explained", "Breakdown", "Detailed Analysis".
- DO NOT output generic subtitles like "What They Didn't Show You in Court" or "The Truth About..." without including the specific story hook word (e.g. Money, Sweat Equity, Death Row, Scandal, Secret, Trap).
- Pair [Subject/Case Name] WITH the SPECIFIC UNIQUE STORY HOOK:
  1. Specific Angle Hook: "[Subject]: The Death Penalty Money Nobody Talks About"
  2. Scandal / Secret Hook: "[Subject]: Inside the Sweat Equity Scandal"
  3. Curiosity Question: "Why Money Couldn't Save [Subject]"
  4. Hidden Aspect: "The Hidden Money Trail Behind the [Subject] Trial"
  5. Real Reason: "The Real Reason [Subject] Faced Capital Charges"
  6. Cold Investigation: "Inside Federal Prison Reality: The [Subject] Case"

STRICT TAG RULES (350-450 CHARS TOTAL / HIGH-INTENT PHRASES):
- Produce between 350 to 450 total combined characters across 15 to 20 targeted tags (Do NOT exceed 480 characters).
- PRIORITIZE SEARCH INTENT & MISSPELLINGS:
  1. Exact Topic Entities & Misspellings (3-4 tags): exact names, case names, and common user misspellings/variations (e.g. "pooh shiestie", "big30").
  2. High-Intent Long-Tail Queries (5-6 tags): phrases real searchers type (e.g. "pooh shiesty federal case update", "pooh shiesty release date", "federal prison reality").
  3. Targeted Niche Keywords (4-5 tags): "hip hop true crime", "courtroom strategy", "criminal psychology", "federal indictment update".
  4. Brand & Host Authority (3-4 tags): "unique mecca audio", "unique mecca audio nyc", "wainsworth hall".
- BAN GENERIC PADDING: Do NOT output standalone generic words like "video", "news", or "story" unless combined with a specific subject.

STRICT DESCRIPTION FORMAT (10-PART COMPREHENSIVE MASTER BLUEPRINT):
The description string MUST include ALL of the following sections in exact order:

1. First 2 lines (Search Snippet - max 150 chars): Must be a complete, engaging, natural search preview sentence featuring the specific topic hook (e.g., "What really happened to the money behind the [Subject] death penalty trial? In this breakdown..."). NEVER output a flat keyword string.

2. Main Narrative Body (3-5 comprehensive paragraphs): In-depth criminal psychology breakdown, legal strategy, courtroom insights, and youth warning. NATURALLY WEAVE standing channel keyword phrases into the narrative body text for keyword density: "unique mecca audio", "unique mecca audio nyc", "federal prison", "crime and consequences", "life consequences".

3. Key Takeaways & Topic Pillars (Bulleted with Emojis):
   • 🔥 Street Reality & Survival Lessons: [1-sentence key lesson from video]
   • 🎙️ Prison & Legal Strategy Insights: [1-sentence courtroom/prison insight from video]
   • 🧭 Street Code vs. Legal Reality: [1-sentence consequence breakdown from video]
   • 🌟 Youth Warning & Redemption: [1-sentence moral takeaway from video]

4. Host Bio & Credibility Block:
   Hosted by Wainsworth “Unique” Hall — former federal inmate of 26 years — bringing unfiltered prison survival insights, street code, crime & justice commentary, and a mission to uplift youth by turning lived hardship into positive awareness.

5. Real Timestamps & Chapters (ONLY IF SPOKEN TRANSCRIPT ANCHORS ARE PROVIDED in the user prompt):
   Include a formatted chapter block using the exact timestamps from the spoken anchors:
   ⏱️ CHAPTERS:
   0:00 - Introduction
   [MM:SS] - [Descriptive topic discussed at that timestamp]
   (CRITICAL: If NO spoken transcript anchors are provided in the user prompt, DO NOT include any timestamps or chapters section at all!).

6. Series Block (ONLY IF related series videos are explicitly provided in the user prompt):
   📺 PREVIOUS EPISODES IN THIS SERIES:
   - Part 1: [Title of Part 1]
   (If NO related series videos are provided, DO NOT include any series section at all!).

7. Engagement Question & Channel CTAs:
   💬 [Dynamic engagement question relevant to this video's topic]? Drop your thoughts in the comments below!
   👍 Like this video, leave a comment, and subscribe for more criminal psychology & courtroom breakdowns.

8. Official Links & Social Media Block:
   📲 Facebook: https://www.facebook.com/Meccaudio
   📸 Instagram: https://www.instagram.com/uniquemeccaaudio
   🎥 Main Channel: https://www.youtube.com/@uniquemeccaaudionyc
   🎥 Second Channel: https://www.youtube.com/@meccaaudiotv

9. Educational & Legal Disclaimer:
   Disclaimer: This content is for educational, analytical, and crime prevention purposes. All individuals are presumed innocent until proven guilty in a court of law.

10. Trailing Hashtags Block:
    At the very bottom of the description text, append 5-8 relevant hashtags derived from the video tags starting with # (e.g. #UniqueMeccaAudio #FederalPrison #TrueCrime #CourtroomStrategy #LegalBreakdown #[CaseSpecificHashtag]).

OUTPUT FORMAT:
Return ONLY valid JSON: {"title": string, "description": string, "tags": string[], "hashtags": string[]}`;

export function buildSeoPrompt(params: {
  videoTitle: string;
  videoDescription?: string;
  showType?: string;
  transcriptAnchors?: string;
  currentDate?: string;
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
  }>;
}): { system: string; user: string } {
  const userParts: string[] = [];

  if (params.currentDate) {
    userParts.push(`Current Date: ${params.currentDate}`);
  }

  userParts.push('');
  userParts.push(`Generate optimized SEO for this video:`);
  userParts.push(`Video Title: ${params.videoTitle}`);
  if (params.videoDescription) {
    userParts.push(`Video Description: ${params.videoDescription}`);
  }
  if (params.showType) {
    userParts.push(`Show Type: ${params.showType}`);
  }

  // Real Spoken Transcript Timestamps
  if (params.transcriptAnchors) {
    userParts.push('');
    userParts.push(`REAL SPOKEN VIDEO TRANSCRIPT ANCHORS (With exact timestamps from audio):`);
    userParts.push(params.transcriptAnchors);
    userParts.push(`INSTRUCTION: Use these exact timestamps to create a "⏱️ CHAPTERS:" section in the description.`);
  } else {
    userParts.push('');
    userParts.push(`NO TRANSCRIPT ANCHORS AVAILABLE. DO NOT GENERATE ANY FAKE TIMESTAMPS OR CHAPTERS.`);
  }

  // Live YouTube Autocomplete Search Queries
  if (params.liveSearchSuggestions && params.liveSearchSuggestions.length > 0) {
    userParts.push('');
    userParts.push(`LIVE YOUTUBE AUTOCOMPLETE SEARCH QUERIES (Real search terms users type for this topic):`);
    params.liveSearchSuggestions.forEach((term) => {
      userParts.push(`- "${term}"`);
    });
  }

  // Related Channel Videos on Same Topic (Series Context)
  if (params.relatedSeriesVideos && params.relatedSeriesVideos.length > 0) {
    userParts.push('');
    userParts.push(`SERIES CONTEXT — PREVIOUS VIDEOS ON THIS EXACT SAME SPECIFIC CASE/PERSON ON YOUR CHANNEL:`);
    params.relatedSeriesVideos.forEach((v, i) => {
      const viewsStr = v.views !== undefined ? ` — ${v.views.toLocaleString()} views` : '';
      userParts.push(`${i + 1}. "${v.title}"${viewsStr}`);
    });
    userParts.push(`INSTRUCTION: This video is a continuation of the exact same case/person. Reference these specific previous episode titles in the description under "📺 PREVIOUS EPISODES IN THIS SERIES:" and add a shared series tag.`);
  } else {
    userParts.push('');
    userParts.push(`NO PREVIOUS SERIES VIDEOS FOUND FOR THIS TOPIC. DO NOT INCLUDE ANY "PREVIOUS EPISODES IN THIS SERIES" SECTION.`);
  }

  // Channel stats
  if (params.channelStats) {
    userParts.push('');
    userParts.push(`CHANNEL STATS:`);
    userParts.push(params.channelStats);
  }

  // Top performing videos
  if (params.topPerformingVideos && params.topPerformingVideos.length > 0) {
    userParts.push('');
    userParts.push(
      `TOP PERFORMING VIDEOS (last 30 days — study successful title patterns):`,
    );
    params.topPerformingVideos.forEach((v, i) => {
      const tagsStr =
        v.tags && v.tags.length > 0
          ? ` — tags: [${v.tags.slice(0, 5).join(', ')}]`
          : '';
      userParts.push(
        `${i + 1}. "${v.title}" — ${v.views.toLocaleString()} views${tagsStr}`,
      );
    });
  }

  // Trending topics
  if (params.trendingTopics && params.trendingTopics.length > 0) {
    userParts.push('');
    userParts.push(`CURRENT TRENDING IN NICHE:`);
    params.trendingTopics.forEach((t) => {
      userParts.push(`- ${t}`);
    });
  }

  // Video performance
  if (params.videoPerformance) {
    userParts.push('');
    userParts.push(`THIS VIDEO'S PERFORMANCE:`);
    const perfParts: string[] = [];
    perfParts.push(
      `Current views: ${params.videoPerformance.views.toLocaleString()}`,
    );
    if (params.videoPerformance.publishedDaysAgo !== undefined) {
      perfParts.push(
        `Published: ${params.videoPerformance.publishedDaysAgo} days ago`,
      );
    }
    if (params.videoPerformance.watchTimeHours !== undefined) {
      perfParts.push(
        `Watch time: ${params.videoPerformance.watchTimeHours.toFixed(1)} hours`,
      );
    }
    userParts.push(perfParts.join(' | '));
  }

  userParts.push('');
  userParts.push(`SUMMARY EXECUTION CHECKLIST:`);
  userParts.push(`- Title: Under 65 chars. Must pair Subject Name WITH the specific unique story hook (Money, Sweat Equity, Scandal, etc.). NO generic "What They Didn't Show You".`);
  userParts.push(`- Description: 10-Part Master Blueprint (Search preview + 3-5 paragraph deep breakdown + Bullet Takeaways + Host Bio + Timestamps + Series + CTAs + Official Social Links + Disclaimer + Trailing Hashtags).`);
  userParts.push(`- Tags: MUST generate 15-20 tags totaling 350-450 chars, including exact entities + common misspellings + long-tail search queries + host branding ("wainsworth hall", "unique mecca audio"). NO generic filler.`);

  return { system: SEO_SYSTEM_PROMPT, user: userParts.join('\n') };
}
