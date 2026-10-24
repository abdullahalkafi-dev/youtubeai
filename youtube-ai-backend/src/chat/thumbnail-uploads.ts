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

/** The uploaded photo whose message names this person (never the other generation: Sr. vs Jr.). */
export function matchUploadedPhoto(personName: string, uploads: ChatUpload[]): ChatUpload | undefined {
  const nameWords = new Set(words(personName).filter((w) => w.length >= 4 && w !== 'senior' && w !== 'junior'));
  if (!nameWords.size) return undefined;
  const wantsSenior = SENIOR.test(personName);
  const wantsJunior = JUNIOR.test(personName);
  return uploads.find((u) => {
    if (!words(u.text).some((w) => nameWords.has(w))) return false;
    if (wantsJunior && SENIOR.test(u.text) && !JUNIOR.test(u.text)) return false;
    if (wantsSenior && JUNIOR.test(u.text) && !SENIOR.test(u.text)) return false;
    // "John Gotti" alone, with a message that says "junior", is the junior's photo.
    if (!wantsJunior && JUNIOR.test(u.text) && !SENIOR.test(u.text)) return false;
    return true;
  });
}
