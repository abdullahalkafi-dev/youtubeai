/**
 * Deterministic Teleprompter Script Markdown <-> Block Parser & Serializer
 * Ensures 100% fidelity across visual editing cycles.
 */

export interface TeleprompterStats {
  wordCount: number;
  estimatedDurationMinutes: number;
}

export function calculateTeleprompterStats(content: string): TeleprompterStats {
  if (!content || typeof content !== 'string') {
    return { wordCount: 0, estimatedDurationMinutes: 0 };
  }
  const sections = parseScriptSections(content);
  let totalWords = 0;
  for (const sec of sections) {
    const cleanBody = sec.body
      .replace(/^#+\s+.*/gm, '')
      .replace(/\[BEAT\]|\[PAUSE\]/gi, '')
      .replace(/💎\s*JEWEL/gi, '')
      .trim();
    totalWords += cleanBody.split(/\s+/).filter(Boolean).length;
  }
  if (totalWords === 0) {
    const clean = content
      .replace(/^#+\s+.*/gm, '')
      .replace(/\[BEAT\]|\[PAUSE\]/gi, '')
      .replace(/💎\s*JEWEL/gi, '')
      .trim();
    totalWords = clean.split(/\s+/).filter(Boolean).length;
  }
  const minutes = Math.max(1, Math.round(totalWords / 140));
  return { wordCount: totalWords, estimatedDurationMinutes: minutes };
}

export interface ParsedScriptSection {
  header: string;
  subHeader?: string;
  body: string;
  isJewel: boolean;
  isViralQuestions?: boolean;
}

export function sanitizeScriptTitle(title: string): string {
  if (!title) return '';
  return title
    .replace(/^[🎙\s*#"'“”]+|[🎙\s*#"'“”]+$/g, '')
    .replace(/\*\*/g, '')
    .trim();
}

export function isValidScriptTitle(title: string): boolean {
  if (!title || typeof title !== 'string') return false;
  const clean = sanitizeScriptTitle(title);
  if (clean.length < 4 || clean.length > 150) return false;

  const blacklist = [
    /^(?:🎙\s*)?LIVE SCRIPT/i,
    /^TELEPROMPTER/i,
    /^ACCURACY NOTE/i,
    /^IMPORTANT ACCURACY/i,
    /^LEGAL STATUS/i,
    /^BEFORE YOU RECORD/i,
    /^SCRIPT DRAFT/i,
    /^FULL SCRIPT/i,
    /^6-PART SCRIPT/i,
    /^BEAUTIFIED TELEPROMPTER/i,
    /^YOUTUBE (?:VIDEO )?SCRIPT/i,
    /^PRODUCTION PACKAGE/i,
    /^VIDEO TOPIC IDEAS/i,
    /^UNTITLED/i,
    /^AI CHAT/i,
    /^SECTION \d+/i,
    /^COLD OPEN/i,
    /^WHAT HAPPENED/i,
    /^UNIQUE MECCA BREAKDOWN/i,
    /^THE HUMAN COST/i,
    /^THE YOUTH WARNING/i,
    /^FINAL JEWEL/i,
    /^10 VIRAL QUESTIONS/i,
  ];

  return !blacklist.some((rx) => rx.test(clean));
}

export function extractScriptTitle(content: string, baseTitle?: string, videoTitle?: string): string {
  if (!content) return videoTitle || baseTitle || 'YouTube Video Script';

  // 1. Explicit AI Contract line: # SCRIPT TITLE: [Title] or Title: [Title]
  const explicitMatch = content.match(/(?:^|\n)(?:#+\s*)?(?:(?:Episode|Script|Video)\s+)?Title:\s*["“]?([^"\n\r”]+)["”]?/i);
  if (explicitMatch && explicitMatch[1]) {
    const clean = sanitizeScriptTitle(explicitMatch[1]);
    if (isValidScriptTitle(clean)) return clean;
  }

  // 2. Quoted Headline on its own line near the start
  const quotedMatch = content.match(/(?:^|\n)\s*["“]([^"”\n\r]{6,120})["”]\s*(?:\n|$)/);
  if (quotedMatch && quotedMatch[1]) {
    const clean = sanitizeScriptTitle(quotedMatch[1]);
    if (isValidScriptTitle(clean)) return clean;
  }

  // 3. Markdown Heading # or ## near the top
  const headingMatches = content.matchAll(/(?:^|\n)(?:#{1,3})\s+([^#\n\r]{6,120})(?:\n|$)/g);
  for (const m of headingMatches) {
    const candidate = sanitizeScriptTitle(m[1]);
    if (isValidScriptTitle(candidate)) {
      return candidate;
    }
  }

  // 4. Quoted hook in COLD OPEN line
  const coldOpenHook = content.match(/COLD OPEN[^\n]*?["“]([^"”\n\r]{6,120})["”]/i);
  if (coldOpenHook && coldOpenHook[1]) {
    const clean = sanitizeScriptTitle(coldOpenHook[1]);
    if (isValidScriptTitle(clean)) return clean;
  }

  // 5. Video Title / Thread Title fallback
  const fallback = videoTitle || baseTitle;
  if (fallback && isValidScriptTitle(fallback)) {
    return sanitizeScriptTitle(fallback);
  }

  return fallback || 'YouTube Video Script';
}

/**
 * Splits raw teleprompter markdown into structured sections.
 */
export function parseScriptSections(content: string): ParsedScriptSection[] {
  if (!content || typeof content !== 'string') return [];

  const normalized = content
    .replace(/<!--\s*SCRIPT_(?:START|END)\s*-->/gi, '')
    .replace(/<<<\/?SCRIPT_(?:START|END)>>>/gi, '')
    .replace(/^[#\s]*(?:SCRIPT|EPISODE|VIDEO)\s+TITLE:\s*[^\n\r]*$/gim, '')
    .replace(/\r\n/g, '\n');
  const sections: ParsedScriptSection[] = [];
  const parts = normalized.split(/(?=^#{1,3}\s+|^(?:\*\*)?(?:COLD OPEN|WHAT HAPPENED|UNIQUE MECCA BREAKDOWN|THE HUMAN COST|THE YOUTH WARNING|FINAL JEWEL|10 VIRAL QUESTIONS))/gim);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const headerMatch = trimmed.match(/^(?:#{1,3}\s+|\*\*)?(.+?)(?:\*\*)?$/m);
    if (headerMatch) {
      let rawHeader = headerMatch[1].trim();
      const header = rawHeader
        .replace(/^[\*\#\"\']+|[\*\#\"\']+$/g, '')
        .replace(/\*\*/g, '')
        .trim();

      const lowerH = header.toLowerCase();
      // Filter out Strategy (Sections 1-7), SEO & Metadata (Sections 9-18)
      if (
        lowerH.includes('sources') ||
        lowerH.includes('verified youtube') ||
        lowerH.includes('accuracy notes') ||
        lowerH.includes('story score') ||
        lowerH.includes('show type') ||
        lowerH.includes('title option') ||
        lowerH.includes('thumbnail concept') ||
        lowerH.includes('youtube description') ||
        lowerH.includes('keywords') ||
        lowerH.includes('hashtags') ||
        lowerH.includes('tag-box') ||
        lowerH.includes('pinned-comment') ||
        lowerH.includes('shorts concept') ||
        lowerH.includes('case & news sources')
      ) {
        continue;
      }

      const firstNl = trimmed.indexOf('\n');
      const body = firstNl !== -1 ? trimmed.slice(firstNl + 1).trim() : '';

      const isJewel = header.toLowerCase().includes('jewel');
      const isViralQuestions = header.toLowerCase().includes('viral question');

      sections.push({
        header,
        body,
        isJewel,
        isViralQuestions,
      });
    } else if (sections.length > 0) {
      sections[sections.length - 1].body += '\n\n' + trimmed;
    } else {
      sections.push({
        header: 'INTRO',
        body: trimmed,
        isJewel: false,
      });
    }
  }

  if (sections.length === 0 && normalized.trim()) {
    sections.push({ header: 'SCRIPT', body: normalized.trim(), isJewel: false });
  }

  return sections;
}

/**
 * Clean copy generator — extracts only the pure spoken teleprompter lines.
 */
export function extractCleanTeleprompterText(content: string): string {
  if (!content) return '';
  const normalized = content.replace(/\r\n/g, '\n');
  const sections = parseScriptSections(normalized);
  return sections
    .map(sec => {
      const head = sec.header ? `\n\n=== ${sec.header.toUpperCase()} ===\n` : '';
      const cleanBody = sec.body
        .replace(/^>\s*/gm, '')
        .replace(/\*\*/g, '')
        .replace(/^•\s*/gm, '• ')
        .trim();
      return `${head}${cleanBody}`;
    })
    .join('\n')
    .trim();
}
