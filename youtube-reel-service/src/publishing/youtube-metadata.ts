import type { PostMetadata } from './types';

export const YT_TITLE_MAX = 100;
export const YT_DESCRIPTION_MAX_BYTES = 5000;
export const YT_TAGS_MAX_CHARS = 480; // YouTube allows 500 including separators; keep a margin
const MIN_SCHEDULE_AHEAD_MS = 5 * 60_000;

/** YouTube rejects `<` and `>` in titles, descriptions and tags. */
function stripAngles(text: string): string {
  return text.replace(/[<>]/g, '');
}

export function sanitizeTitle(title: string): string {
  const clean = stripAngles(title).replace(/\s+/g, ' ').trim();
  if (clean.length <= YT_TITLE_MAX) return clean;
  return clean.slice(0, YT_TITLE_MAX - 1).trimEnd() + '…';
}

/** Cut to a byte limit without splitting a multi-byte character. */
export function truncateBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let out = '';
  let bytes = 0;
  for (const ch of text) {
    const b = Buffer.byteLength(ch, 'utf8');
    if (bytes + b > maxBytes) break;
    out += ch;
    bytes += b;
  }
  return out.trimEnd();
}

export function normaliseHashtag(tag: string): string {
  const body = tag.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '');
  return body ? `#${body}` : '';
}

/** Description + hashtags (YouTube surfaces the first three hashtags above the title). `#shorts` is always present. */
export function buildDescription(description: string, hashtags: string[]): { text: string; truncated: boolean } {
  const tags = [...new Set(hashtags.map(normaliseHashtag).filter(Boolean))];
  if (!tags.some((t) => t.toLowerCase() === '#shorts')) tags.push('#shorts');
  const tail = `\n\n${tags.slice(0, 15).join(' ')}`;
  const body = stripAngles(description).trim();
  const full = `${body}${tail}`;
  if (Buffer.byteLength(full, 'utf8') <= YT_DESCRIPTION_MAX_BYTES) return { text: full, truncated: false };
  const room = YT_DESCRIPTION_MAX_BYTES - Buffer.byteLength(tail, 'utf8');
  return { text: `${truncateBytes(body, Math.max(0, room))}${tail}`, truncated: true };
}

/** YouTube counts a multi-word tag with its surrounding quotes, plus one comma between tags. */
export function fitTags(tags: string[]): { tags: string[]; dropped: number } {
  const out: string[] = [];
  let used = 0;
  let dropped = 0;
  for (const raw of tags) {
    const tag = stripAngles(raw).replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!tag || out.some((t) => t.toLowerCase() === tag.toLowerCase())) continue;
    const cost = tag.length + (tag.includes(' ') ? 2 : 0) + (out.length ? 1 : 0);
    if (used + cost > YT_TAGS_MAX_CHARS) {
      dropped++;
      continue;
    }
    out.push(tag);
    used += cost;
  }
  return { tags: out, dropped };
}

export interface YouTubeInsertBody {
  snippet: {
    title: string;
    description: string;
    tags: string[];
    categoryId: string;
    defaultLanguage: string;
    defaultAudioLanguage: string;
  };
  status: {
    privacyStatus: 'private' | 'unlisted' | 'public';
    selfDeclaredMadeForKids: boolean;
    containsSyntheticMedia: boolean;
    publishAt?: string;
  };
}

/**
 * Everything goes into the single `videos.insert` call (title, description, tags, category, privacy, schedule),
 * so no `videos.update` (50 units) is needed afterwards.
 */
export function buildInsertBody(meta: PostMetadata, now = Date.now()): { body: YouTubeInsertBody; warnings: string[] } {
  const warnings: string[] = [];
  const desc = buildDescription(meta.description, meta.hashtags);
  if (desc.truncated) warnings.push('Description was shortened to fit YouTube\'s 5000-byte limit.');
  const tags = fitTags(meta.tags);
  if (tags.dropped) warnings.push(`${tags.dropped} tag(s) dropped to fit YouTube's 500-character tag limit.`);
  const title = sanitizeTitle(meta.title);
  if (title !== meta.title.trim()) warnings.push('Title was cleaned/shortened to fit YouTube\'s rules.');

  let privacy = meta.privacy;
  let publishAt: string | undefined;
  if (meta.scheduleAt) {
    const when = new Date(meta.scheduleAt).getTime();
    if (!Number.isFinite(when)) throw new Error('Invalid schedule time');
    if (when < now + MIN_SCHEDULE_AHEAD_MS) throw new Error('Scheduled time must be at least 5 minutes in the future');
    publishAt = new Date(when).toISOString();
    privacy = 'private'; // YouTube requires private + publishAt; it flips to public at that moment
  }

  return {
    body: {
      snippet: {
        title,
        description: desc.text,
        tags: tags.tags,
        categoryId: /^\d{1,3}$/.test(meta.categoryId) ? meta.categoryId : '22',
        defaultLanguage: 'en',
        defaultAudioLanguage: 'en',
      },
      status: {
        privacyStatus: privacy,
        selfDeclaredMadeForKids: meta.madeForKids,
        containsSyntheticMedia: meta.containsSyntheticMedia,
        ...(publishAt ? { publishAt } : {}),
      },
    },
    warnings,
  };
}
