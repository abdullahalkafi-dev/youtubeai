/**
 * Words and replies that decide whether a chat message must end in thumbnail images.
 * Kept apart from ChatService so the rules can be tested without the whole service.
 */

/** The client's own words ask for a picture to be made ("generate thumbnail", "make the image", "redo it"). */
const ASKS_TO_MAKE_IMAGE =
  /\b(?:generate|make|create|produce|render|design|redo|regenerate|remake)\b[^.?!\n]{0,60}\b(?:thumb\w*|images?|pictures?|cover\s*arts?)\b/i;

/** "generate" (or make, redo...) and an image word in one sentence: the client wants a picture drawn now. */
export function asksToMakeImage(content: string): boolean {
  const text = String(content || '').replace(/\[Image uploaded:[^\]]*\]/gi, ' ');
  return ASKS_TO_MAKE_IMAGE.test(text);
}

/**
 * The model's reply says it cannot make the image ("I can't render images in this chat", "the
 * image-generation tool isn't available", "production-ready edit prompt"). Such a reply is wrong in
 * this app: the images are drawn from the concept block.
 */
export function claimsNoImages(reply: string): boolean {
  const text = String(reply || '');
  return (
    /\b(?:can(?:'|’)?t|cannot|unable to|not able to|don(?:'|’)?t have)\b[^.\n]{0,70}\b(?:render|generate|attach|create|produce|show|display|draw)\b[^.\n]{0,50}\b(?:image|thumbnail|picture|photo)/i.test(text) ||
    /\bimage[- ]generation\b[^.\n]{0,40}\b(?:isn(?:'|’)?t|is not|not|un)\s*available/i.test(text) ||
    /\b(?:image|thumbnail)\s+(?:tool|editor|generator)\b[^.\n]{0,60}\b(?:isn(?:'|’)?t|is not|cannot|can(?:'|’)?t|unavailable)/i.test(text) ||
    /\bproduction-ready (?:edit )?prompt\b/i.test(text)
  );
}

/**
 * Earlier replies that refused ("I can't render images") teach the model to refuse again (on Nov 25 it
 * refused four times in a row). They are replaced with a neutral note before the history is sent back.
 */
export function scrubImageRefusals<T extends { role: string; content: string }>(messages: T[]): T[] {
  return messages.map((m) =>
    m.role === 'assistant' && claimsNoImages(m.content)
      ? { ...m, content: '(An earlier reply could not draw images. That was wrong: this app draws the thumbnail images automatically from the concept block.)' }
      : m,
  );
}

/** A reply that holds the two-concept block the page turns into images. */
export function hasConceptBlock(reply: string): boolean {
  return String(reply || '').includes('THUMBNAILS_START');
}

/**
 * The reply must be rescued (rewritten as a concept block so the images get drawn):
 *  - the client explicitly asked for a picture to be made, and the reply has no concept block; or
 *  - the router saw a confident thumbnail ask, and the reply says the app cannot make images.
 * A theory question ("what makes a good thumbnail?") with no block is left alone, so no image is
 * ever drawn (and paid for) that nobody asked for.
 */
export function needsConceptRescue(params: {
  explicitAsk: boolean;
  routedThumbnail: boolean;
  reply: string;
}): boolean {
  // A reply that holds the block is never rescued: the images are drawn from it.
  if (hasConceptBlock(params.reply)) return false;
  // A long, real answer (a script, an SEO package) that merely lacks the block is not a refusal.
  if (params.explicitAsk) return claimsNoImages(params.reply) || String(params.reply || '').length < 1500;
  return params.routedThumbnail && claimsNoImages(params.reply);
}
