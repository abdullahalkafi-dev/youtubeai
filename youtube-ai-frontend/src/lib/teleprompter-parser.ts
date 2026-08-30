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
  const normalized = content.replace(/\r\n/g, '\n');
  const clean = normalized
    .replace(/^#+\s+.*/gm, '')
    .replace(/\[BEAT\]|\[PAUSE\]/gi, '')
    .replace(/💎\s*JEWEL/gi, '')
    .trim();
  const words = clean.split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 140));
  return { wordCount: words, estimatedDurationMinutes: minutes };
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

  const normalized = content.replace(/\r\n/g, '\n');
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

      const body = trimmed.replace(/^(?:#{1,3}\s+|\*\*)?.+?(?:\*\*)?\n?/, '').trim();

      if (header.toLowerCase().includes('sources') || header.toLowerCase().includes('verified youtube')) {
        continue;
      }

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
