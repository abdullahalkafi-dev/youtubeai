/**
 * One shared source for how titles and chat thumbnail text are worded and checked, so every prompt
 * that writes a title (chat package / SEO skill, dashboard SEO, daily automation, queue) says the
 * same thing and the YouTube limit is enforced in one place.
 */

/** YouTube's hard title limit, in characters. */
export const YOUTUBE_TITLE_MAX = 100;

/** Where mobile search starts cutting a title: the incident should be inside this. */
export const TITLE_FRONT_LOAD_CHARS = 60;

export const TITLE_CLARITY_RULE = `TITLE CLARITY (applies to every title you write):
- A stranger who knows nothing about the story must understand WHAT HAPPENED from the title alone. Lead with who and what (and where when it matters), using the plain fact that makes people stop, then add the click: the twist, the stakes or the question.
- Use the names, places and numbers from the research. Never use "he", "she", "they" or "this" instead of the subject, and spell out insider shorthand ("GWB" becomes "George Washington Bridge" or "GW Bridge").
- The lesson or emotion comes AFTER the incident, never instead of it. A title like "The Pain Beyond the Bridge" or "Everything Changes" says nothing about what happened.
- Length is dynamic: use as many characters as the incident needs. YouTube's hard limit is ${YOUTUBE_TITLE_MAX} characters; never exceed it. Put the incident in the first ~${TITLE_FRONT_LOAD_CHARS} characters (mobile search cuts there) and the hook after it.
- Use reported facts ("charged", "arrested", "reportedly", "killed"). Never state guilt and never invent facts.
- Example: "Retired NYPD Detective Charged After Road Rage Shooting of Con Ed Worker on George Washington Bridge".`;

export const THUMBNAIL_HEADLINE_RULE = `THUMBNAIL TEXT IS THREE SHORT LINES (about 8-12 words in all), written with " / " between the lines: LINE 1 = WHO (the name people search); LINE 2 = WHAT HAPPENED in plain reported fact (and where, when it matters); LINE 3 = THE HOOK that makes a stranger click, in Unique's lane: his insider verdict, the cost, or one open question that only the video answers. Lines 1-2 name the incident; line 3 leaves exactly one thing open and never gives the answer away. Concept 1: line 3 is his insider verdict (for example "WHAT PRISON DOES TO COPS"). Concept 2: line 3 is the shock or the stakes (for example "HE'S NEVER COMING HOME?"). Example for the same incident: "RETIRED NYPD COP / SHOOTS WORKER ON GW BRIDGE / WHAT PRISON DOES TO COPS". Never use text that does not say what happened ("HE NEVER MADE IT HOME", "THAT CALL CHANGES EVERYTHING", "WHO CAN I TRUST?") unless the incident is named in lines 1-2, and never use classroom wording ("Explained", "The Truth About", "Lessons From"). Use reported facts and never state guilt. If the client gave exact text, keep it word for word.`;

/** Characters the way YouTube counts them: code points, so emoji are not undercounted. */
export function titleLength(title: string): number {
  return Array.from(title || '').length;
}

/** Removes markdown, quotes and angle brackets that must not reach YouTube. Never shortens. */
export function cleanTitleText(title: string): string {
  return (title || '')
    .replace(/[<>]/g, '')
    .replace(/\*\*/g, '')
    .replace(/^[\s*#"'“”]+|[\s*#"'“”]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const SEPARATORS = [' — ', ' – ', ' - ', ': ', ' | ', ', '];

/**
 * Cleans a title and, only when it is over YouTube's limit, trims it at a natural break (dash, colon,
 * comma, then space) so the front of the title (the incident) is kept. Never adds "...".
 */
export function fitTitle(title: string, max: number = YOUTUBE_TITLE_MAX): string {
  const clean = cleanTitleText(title);
  if (titleLength(clean) <= max) return clean;
  const head = Array.from(clean).slice(0, max).join('');
  const floor = Math.floor(max * 0.4);
  let cut = -1;
  for (const sep of SEPARATORS) {
    const at = head.lastIndexOf(sep);
    if (at >= floor) cut = Math.max(cut, at);
  }
  if (cut === -1) {
    const space = head.lastIndexOf(' ');
    cut = space >= floor ? space : head.length;
  }
  return head
    .slice(0, cut)
    .replace(/[\s\-–—:,|]+$/g, '')
    .trim();
}

const NOT_ANCHORS = new Set([
  'the', 'this', 'that', 'these', 'those', 'what', 'why', 'how', 'when', 'who', 'where', 'and', 'but',
  'for', 'with', 'from', 'your', 'their', 'his', 'her', 'its', 'our', 'you', 'they', 'she', 'has', 'have',
  'was', 'were', 'are', 'not', 'new', 'after', 'before', 'about', 'into', 'over', 'also', 'copy',
  // channel and platform words that appear in every description
  'unique', 'mecca', 'audio', 'hosted', 'subscribe', 'like', 'comment', 'facebook', 'instagram',
  'youtube', 'tiktok', 'twitter', 'video', 'videos', 'episode', 'channel', 'follow', 'watch',
]);

/** Names, places and numbers from the facts: the words a good title must reuse. */
export function extractAnchors(...texts: Array<string | undefined | null>): Set<string> {
  const anchors = new Set<string>();
  for (const text of texts) {
    for (const m of String(text || '').matchAll(/[A-Z][A-Za-z’'.-]{1,}|\d[\d,.]*/g)) {
      const token = m[0].replace(/[.,'’-]+$/g, '').toLowerCase();
      if (token.length >= 2 && !NOT_ANCHORS.has(token)) anchors.add(token);
    }
  }
  return anchors;
}

const wordsOf = (s: string) =>
  (s || '')
    .toLowerCase()
    .replace(/[’']s\b/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * A safety net, not a judge of hooks: a title is vague when it shares no name, place or number with the
 * facts, or when it opens with a bare pronoun and names nothing.
 */
export function titleIsVague(title: string, anchors: Set<string>): boolean {
  const clean = cleanTitleText(title);
  if (!clean) return true;
  const words = wordsOf(clean);
  const sharesAnchor = words.some((w) => anchors.has(w));
  const pronounStart = /^(he|she|they|it|this|that|these|those|his|her|their)\b/i.test(clean);
  if (anchors.size > 0 && !sharesAnchor) return true;
  // A pronoun opener must be backed by a shared name; with no facts to compare it is treated as vague.
  if (pronounStart && !sharesAnchor) return true;
  return false;
}

/**
 * Chat replies are free text, so the model can write a title over YouTube's limit. After the reply is
 * saved, trim only the title line under a "## Title" / "### TITLE" heading, and only when it is too long.
 */
export function capChatTitle(content: string): { content: string; changed: boolean } {
  const match = /^(#{2,3}[ \t]+Title[^\n]*\n+)([^\n]+)/im.exec(content || '');
  if (!match) return { content, changed: false };
  const line = match[2];
  const bold = /^\*\*(.*)\*\*$/.exec(line.trim());
  const inner = (bold ? bold[1] : line).trim();
  if (titleLength(inner.replace(/\*\*/g, '')) <= YOUTUBE_TITLE_MAX) return { content, changed: false };
  const fitted = fitTitle(inner);
  const start = match.index + match[1].length;
  return {
    content: content.slice(0, start) + (bold ? `**${fitted}**` : fitted) + content.slice(start + line.length),
    changed: true,
  };
}
