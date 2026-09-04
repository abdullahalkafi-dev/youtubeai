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

/**
 * Splits raw teleprompter markdown into structured sections.
 */
export function parseScriptSections(content: string): ParsedScriptSection[] {
  if (!content || typeof content !== 'string') return [];

  const normalized = content
    .replace(/<!--\s*SCRIPT_(?:START|END)\s*-->/gi, '')
    .replace(/<<<\/?SCRIPT_(?:START|END)>>>/gi, '')
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
