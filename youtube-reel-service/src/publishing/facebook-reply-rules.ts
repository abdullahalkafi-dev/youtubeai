/**
 * The rules of the Facebook comment replies, kept pure (no database, no clock of their own, no model) so every one can be tested and
 * audited. FACEBOOK-COMMENT-REPLIES.md explains each in plain words. Order of defence for a comment:
 *   1. `hardSkipReason`  (here, free, cannot be argued with)  ->  2. the model may still say "skip"  ->  3. `validateReply` on what it wrote
 *   ->  4. timing and caps (`gapMs`, the daily cap)  ->  5. a last check against Facebook right before posting.
 */

export const REPLY_MAX_CHARS = 180;
export const COMMENT_MAX_CHARS = 600;
export const STORED_COMMENT_MAX = 500;
/** A queued reply that has waited this long is dropped: a late answer to an old comment reads wrong. */
export const QUEUE_STALE_MS = 24 * 3_600_000;
/** Posting a reply fails this many times, then the comment is marked failed. */
export const MAX_POST_ATTEMPTS = 3;
/** The Page's own link comment starts like this (facebook-caption.ts `fullVideoComment`); it must never be answered. */
export const OWN_LINK_COMMENT_PREFIX = 'watch the full video on youtube';

export interface FbComment {
  id: string;
  message?: string | null;
  created_time?: string;
  comment_count?: number;
  from?: { id?: string } | null;
}

/** Slurs: a comment containing any is never answered, whatever its intent (nothing here is quoted back or judged). */
const SLUR = /n[i1!]gg+(?:a|er|az|as|uh)?s?\b|\bfag(?:got)?s?\b|\bretard(?:ed|s)?\b|\bcunts?\b|\bkikes?\b|\bchinks?\b|\bspics?\b|\bdykes?\b|\btrann(?:y|ies)\b|\bwetbacks?\b/i;
/** Insults and profanity aimed at someone. */
const ABUSE = /\bf+u+c+k+\s*(?:you|u|off|boy|yall|y'all)\b|\bfuck\s*boy\b|\bbitch(?:es)?\b|\bpussy\b|\bdumb\s*ass\b|\bjackass\b|\bpiece of shit\b|\bshut (?:the fuck )?up\b|\bkill yourself\b|\bkys\b|\bmotherfucker\b|\basshole\b|\bscum\b/i;
const THREAT = /\b(?:kill|shoot|stab|rape|murder|hang)\b.{0,40}\b(?:you|him|her|them|y'all|yall|your)\b/i;
const SELF_HARM = /\b(?:suicid\w*|kill myself|end my life|want to die|don'?t want to live)\b/i;
const POLITICS = /\b(?:trump|biden|maga|democrats?|republicans?|obama|kamala|harris|gop|liberals?|conservatives?)\b/i;
const SPAM_LINK = /https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(?:com|net|org|io|me|co|ru|xyz|ly|info|biz|site|link|shop|vip)\b/i;
const SPAM_CONTACT = /\b(?:whats\s*app|telegram|t\.me|cash\s*app|\$[a-z][a-z0-9]{2,}|dm me|inbox me|message me|crypto|bitcoin|forex|investment|giveaway|click (?:the )?link|follow me|check my page|make money)\b|\+?\d[\d\s().-]{8,}\d/i;

/** Why a comment must NOT be answered, decided without the model; null = it may go on to the model. */
export function hardSkipReason(raw: string | null | undefined): string | null {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return 'no_text'; // a photo, a sticker or a GIF only
  if (text.length > COMMENT_MAX_CHARS) return 'too_long';
  if (SELF_HARM.test(text)) return 'needs_care';
  if (THREAT.test(text)) return 'threat';
  if (SLUR.test(text)) return 'slur';
  if (ABUSE.test(text)) return 'abuse';
  if (SPAM_LINK.test(text) || SPAM_CONTACT.test(text)) return 'spam';
  if (POLITICS.test(text)) return 'politics';
  return null;
}

export const isOwnComment = (c: FbComment, pageId: string): boolean =>
  (!!c.from?.id && String(c.from.id) === String(pageId)) || String(c.message ?? '').trim().toLowerCase().startsWith(OWN_LINK_COMMENT_PREFIX);

const EMOJI = /\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic})*[\u{1F3FB}-\u{1F3FF}️]?/gu;

/** Cleans what the model wrote: no dashes, links, hashtags, @mentions or quotes; at most one emoji; cut to REPLY_MAX_CHARS. */
export function cleanReply(raw: string | null | undefined): string {
  let s = String(raw ?? '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[#@]\S+/g, '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/["“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const emojis = s.match(EMOJI) ?? [];
  if (emojis.length > 1) {
    let seen = 0;
    s = s.replace(EMOJI, (m) => (++seen === 1 ? m : '')).replace(/\s+/g, ' ').trim();
  }
  if (s.length > REPLY_MAX_CHARS) {
    const cut = s.slice(0, REPLY_MAX_CHARS - 1);
    const at = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    s = at > REPLY_MAX_CHARS * 0.4 ? cut.slice(0, at + 1) : `${cut.replace(/[\s,;:]+\S*$/, '').replace(/[\s,;:.]+$/, '')}…`;
  }
  return s.trim();
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** True when `reply` repeats a recent reply (same text, or the same first words). Variety is a rule: a Page that answers alike looks like a bot. */
export function isRepeat(reply: string, recent: string[]): boolean {
  const a = norm(reply);
  if (!a) return false;
  return recent.some((r) => {
    const b = norm(r);
    return !!b && (a === b || (a.length >= 14 && b.length >= 14 && a.slice(0, 16) === b.slice(0, 16)));
  });
}

const FORBIDDEN_PHRASES = /\bas an ai\b|\blanguage model\b|\bi understand (?:the|your)\b|\bi hear you, but\b|\bwainsworth\b|\bhall\b|\bcriminal liability\b|\blegally and factually\b|\bsalute\b.*\bsalute\b/i;
const PRIVATE_NUMBER = /\+?\d[\d\s().-]{8,}\d/;
/** The one number that may appear: the booking line printed on every reel. */
const BOOKING_DIGITS = '9176809091';
const BOOKING_NUMBER = /1?[\s.-]?\(?917\)?[\s.-]?680[\s.-]?9091/g;

/** Why a written reply must not be posted; null = fine. `recent` = the latest replies, to keep them different. */
export function validateReply(reply: string, recent: string[]): string | null {
  if (!reply.trim()) return 'empty';
  if (reply.trim().length < 6) return 'too_short'; // what is left after cleaning must still be an answer
  if (reply.length > REPLY_MAX_CHARS) return 'too_long';
  if (/https?:\/\/|www\./i.test(reply)) return 'link';
  if (/[—–]/.test(reply)) return 'dash';
  if (FORBIDDEN_PHRASES.test(reply)) return 'forbidden_phrase';
  const num = PRIVATE_NUMBER.exec(reply);
  if (num && !num[0].replace(/\D/g, '').endsWith(BOOKING_DIGITS)) return 'phone_number';
  if (hardSkipReason(reply.replace(BOOKING_NUMBER, ''))) return 'unsafe_text';
  if (isRepeat(reply, recent)) return 'repeat';
  return null;
}

/** A random wait of 2 to 6 minutes between two posted replies, fixed by `seed` (the previous reply's time) so a retry cannot shorten it. */
export function gapMs(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const r = ((h >>> 0) % 10_000) / 10_000;
  return Math.round((2 + r * 4) * 60_000);
}

export const dailyRemaining = (usedToday: number, cap: number): number => Math.max(0, cap - usedToday);

/** What stops the lane by itself, from the error of a post attempt: login/permission = until reconnected; a rate or spam block = for a while. */
export function replyPause(err: { kind?: string; code?: string; message?: string }, now: Date): { reason: string; until: Date | null } | null {
  if (err.kind === 'auth') return { reason: 'Facebook refused the login or the permission to reply: reconnect Facebook in the app Settings', until: null };
  const spam = String(err.code ?? '') === '368' || /temporarily blocked|spam|too fast|slow down/i.test(String(err.message ?? ''));
  if (err.kind === 'quota' || spam) return { reason: `Facebook limited commenting (${String(err.message ?? err.code ?? 'rate limit').slice(0, 120)}): paused for 12 hours`, until: new Date(now.getTime() + 12 * 3_600_000) };
  return null;
}

export const skipReasonOf = (raw: string | null | undefined): string => {
  const s = String(raw ?? '').toLowerCase().replace(/[^a-z_ ]/g, '').trim().replace(/\s+/g, '_').slice(0, 40);
  return s || 'model_skip';
};
