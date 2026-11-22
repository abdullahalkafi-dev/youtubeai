import { stripBrandPrefix } from './description';

/**
 * Facebook reel caption, SHORT style (client decision 2026-11-23: a hook, one line of context, 3-5 hashtags, no links).
 * Facebook shows only the first lines of a reel caption before "See more" and does not make links in it tappable, so the
 * YouTube description (full-video line, tags, long text) is not reused. Pure: no database, no clock.
 */

/** A caption is cut back to this size (context goes first), so the hook and hashtags always survive. */
export const FACEBOOK_CAPTION_MAX = 400;
const HOOK_MAX = 110;
const CONTEXT_MAX = 160;
const HASHTAGS_MAX = 5;
const URL_RE = /https?:\/\/\S+/gi;
const HAS_URL = /https?:\/\//i;

export interface CaptionInput {
  title: string;
  description?: string | null;
  hashtags?: string[] | null;
}

const clean = (s: string) =>
  s
    .replace(URL_RE, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Cut at a word boundary, ending on "…" when something was dropped. */
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.5 ? cut.slice(0, at) : cut).replace(/[\s,;:.\-–—]+$/, '')}…`;
}

/** The first plain sentence(s) of the description, without the "🎥 FULL VIDEO" line, links or hashtag lines. */
export function contextLine(description: string | null | undefined, max = CONTEXT_MAX): string {
  const paragraphs = String(description ?? '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('🎥') && !HAS_URL.test(l) && !/^(#\S+\s*)+$/.test(l));
  const first = paragraphs[0];
  if (!first) return '';
  const text = clean(first);
  const sentence = /^(.+?[.!?])(\s|$)/.exec(text)?.[1] ?? text;
  return clip(sentence.length >= 25 ? sentence : text, max);
}

/** `#Word` tags, de-duplicated, letters/digits/underscore only, at most 5. Never invents tags. */
export function facebookHashtags(tags: string[] | null | undefined, limit = HASHTAGS_MAX): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags ?? []) {
    const word = String(raw ?? '').replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '');
    if (!word || word.length > 30 || seen.has(word.toLowerCase())) continue;
    seen.add(word.toLowerCase());
    out.push(`#${word}`);
    if (out.length >= limit) break;
  }
  return out;
}

export function buildFacebookCaption(input: CaptionInput): string {
  const hook = clip(clean(stripBrandPrefix(input.title)), HOOK_MAX);
  let context = contextLine(input.description);
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (context && (norm(context) === norm(hook) || norm(hook).includes(norm(context)))) context = '';
  const tags = facebookHashtags(input.hashtags).join(' ');

  const assemble = (withContext: boolean) => [hook, withContext ? context : '', tags].filter(Boolean).join('\n\n');
  let caption = assemble(true);
  if (caption.length > FACEBOOK_CAPTION_MAX) caption = assemble(false);
  return caption.slice(0, FACEBOOK_CAPTION_MAX).trim();
}
