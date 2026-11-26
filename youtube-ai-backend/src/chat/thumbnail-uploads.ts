/**
 * A photo the client sent in the chat for a named person ("that's the picture of John Gotti senior").
 * Used only for a person the system found no verified photo for, and only when the client's own words
 * name that person, so a random upload is never taken as someone's face.
 */

interface ChatMessageLike {
  role?: string;
  content?: string;
  attachments?: Array<{ type?: string; url?: string; path?: string }>;
  metadata?: { attachments?: Array<{ type?: string; url?: string; path?: string }> };
}

export interface ChatUpload {
  url: string;
  /** What the client wrote with the photo. */
  text: string;
}

const HOST_PHOTO = /\b(?:this\s+is\s+me|my\s+(?:picture|photo|face)|use\s+(?:my|this)\s+(?:photo|picture)\s+for\s+me|for\s+me)\b/i;

/** Photos from the client's most recent messages, newest first (the host's own photos are skipped). */
export function recentChatUploads(messages: ChatMessageLike[], lastUserMessages = 8): ChatUpload[] {
  const out: ChatUpload[] = [];
  let seen = 0;
  for (const m of [...(messages || [])].reverse()) {
    if (m?.role !== 'user') continue;
    if (++seen > lastUserMessages) break;
    const text = String(m.content || '').replace(/\[Image uploaded:[^\]]*\]/gi, ' ').trim();
    if (HOST_PHOTO.test(text)) continue;
    for (const a of m.attachments || m.metadata?.attachments || []) {
      const url = a?.url || a?.path;
      const isImage = a?.type === 'image' || /\.(?:png|jpe?g|webp)(?:\?|$)/i.test(String(url || ''));
      if (url && isImage) out.push({ url, text });
    }
  }
  return out;
}

const words = (value: string) =>
  String(value || '')
    .toLowerCase()
    .replace(/["'“”]/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const SENIOR = /\b(?:senior|sr)\b/i;
const JUNIOR = /\b(?:junior|jr)\b/i;

/** Edit distance, capped: only used to forgive a mis-typed or mis-heard name ("yellow busy" for "Yella Beezy"). */
function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/** The same word, allowing a slip in a longer word (one letter up to 5 letters, two from 6). */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5) return false;
  return distance(a, b) <= (Math.max(a.length, b.length) >= 6 ? 2 : 1);
}

/**
 * True when the words sent with this photo name ANOTHER person by a word that is not part of this
 * person's own name ("this is yellow busy and Moe three"). John Gotti Sr. and Jr. share their words, so
 * they do not count as "another" person here (the Sr./Jr. rules in matchUploadedPhoto separate them).
 */
export function uploadNamesOtherPerson(personName: string, otherName: string, upload: ChatUpload): boolean {
  const mine = new Set(words(personName));
  const unique = words(otherName).filter((w) => w.length >= 4 && w !== 'senior' && w !== 'junior' && !mine.has(w));
  return unique.some((u) => words(upload.text).some((w) => sameWord(w, u)));
}

/** Words that say "this photo is the person" (used only when exactly one person is missing a photo). */
const LIKENESS_CUE = /\b(?:this\s+is|that(?:'|’)?s|that\s+is|here(?:'|’)?s|use\s+(?:this|that)|(?:picture|photo|image)\s+of)\b/i;

/**
 * The uploaded photo whose message names this person (never the other generation: Sr. vs Jr.).
 * The name may be typed or dictated loosely ("yellow busy"), so words are compared with a small slip
 * allowed. With `onlyMissingPerson`, a photo the client introduced as "this is / use this picture" is
 * taken when no name matched, but only when exactly one recent upload is introduced that way (two
 * would be a guess, and a wrong face is worse than asking).
 */
export function matchUploadedPhoto(
  personName: string,
  uploads: ChatUpload[],
  opts: { onlyMissingPerson?: boolean } = {},
): ChatUpload | undefined {
  const nameWords = words(personName).filter((w) => w.length >= 4 && w !== 'senior' && w !== 'junior');
  if (!nameWords.length) return undefined;
  const wantsSenior = SENIOR.test(personName);
  const wantsJunior = JUNIOR.test(personName);
  const named = uploads.find((u) => {
    if (!words(u.text).some((w) => nameWords.some((n) => sameWord(w, n)))) return false;
    if (wantsJunior && SENIOR.test(u.text) && !JUNIOR.test(u.text)) return false;
    if (wantsSenior && JUNIOR.test(u.text) && !SENIOR.test(u.text)) return false;
    // "John Gotti" alone, with a message that says "junior", is the junior's photo.
    if (!wantsJunior && JUNIOR.test(u.text) && !SENIOR.test(u.text)) return false;
    return true;
  });
  if (named || !opts.onlyMissingPerson) return named;
  const introduced = uploads.filter(
    (u) => LIKENESS_CUE.test(u.text) && !JUNIOR.test(u.text) && !SENIOR.test(u.text),
  );
  return introduced.length === 1 ? introduced[0] : undefined;
}
