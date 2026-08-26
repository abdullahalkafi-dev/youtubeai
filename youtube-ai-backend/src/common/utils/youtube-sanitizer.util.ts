/**
 * Sanitizes YouTube video tags to strictly comply with YouTube Data API v3 rules.
 *
 * Rules:
 * 1. Remove hashtags (#), angle brackets (<, >), newlines, carriage returns, and tabs.
 * 2. Replace internal commas with spaces (commas are YouTube tag delimiters).
 * 3. Individual tag length <= 100 characters, >= 2 characters.
 * 4. Case-insensitive deduplication.
 * 5. Total combined length (when joined by commas) <= 490 characters (safe margin under YouTube's 500 limit).
 */
export function sanitizeYouTubeTags(rawTags: (string | null | undefined)[] = []): string[] {
  if (!rawTags || !Array.isArray(rawTags)) return [];

  const MAX_TOTAL_LENGTH = 490;
  const cleanTags: string[] = [];
  const seenLower = new Set<string>();
  let currentTotalLength = 0;

  for (const rawTag of rawTags) {
    if (!rawTag || typeof rawTag !== 'string') continue;

    // 1. Clean illegal characters and comma delimiters
    let tag = rawTag
      .replace(/[<>#\r\n\t]/g, '')
      .replace(/,/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // 2. Length constraints per tag
    if (tag.length < 2 || tag.length > 100) continue;

    // 3. Case-insensitive deduplication
    const lower = tag.toLowerCase();
    if (seenLower.has(lower)) continue;

    // 4. Calculate total length if added (tag + comma delimiter)
    const delimiterLength = cleanTags.length > 0 ? 1 : 0;
    const addedLength = delimiterLength + tag.length;

    if (currentTotalLength + addedLength > MAX_TOTAL_LENGTH) {
      // Reached safe limit
      break;
    }

    seenLower.add(lower);
    cleanTags.push(tag);
    currentTotalLength += addedLength;
  }

  return cleanTags;
}

