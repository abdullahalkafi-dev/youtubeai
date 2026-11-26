import { stripBrandPrefix } from './description';
import { CaptionInput, clean, clip, contextLine, facebookHashtags, fullVideoLink } from './facebook-caption';

/**
 * Instagram reel caption: the same short style as Facebook (a hook, one line of context, up to 5 hashtags, no links, no long dashes),
 * plus one closing line that points to the full video. Links in an Instagram caption or comment are not tappable, so the line
 * says "link in bio" and the account's bio carries the channel link. Pure: no database, no clock.
 */
export const INSTAGRAM_CAPTION_MAX = 500;
const HOOK_MAX = 110;
export const BIO_LINE = 'Full video on YouTube, link in bio.';

export function buildInstagramCaption(input: CaptionInput): string {
  const hook = clip(clean(stripBrandPrefix(input.title)), HOOK_MAX);
  let context = contextLine(input.description);
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (context && (norm(context) === norm(hook) || norm(hook).includes(norm(context)))) context = '';
  const tags = facebookHashtags(input.hashtags).join(' ');
  // Only reels that really have a full video on YouTube say so.
  const pointer = fullVideoLink(input.description) ? BIO_LINE : '';

  const assemble = (withContext: boolean) => [hook, withContext ? context : '', pointer, tags].filter(Boolean).join('\n\n');
  let caption = assemble(true);
  if (caption.length > INSTAGRAM_CAPTION_MAX) caption = assemble(false);
  return caption.slice(0, INSTAGRAM_CAPTION_MAX).trim();
}
