/** Classify yt-dlp failures so we know whether to pause everything, skip one video, or just retry. */
export type YtdlpFailure = 'auth' | 'unavailable' | 'transient';

const AUTH = [
  /sign in to confirm you.?re not a bot/i,
  /the page needs to be reloaded/i,
  /cookies are no longer valid/i,
  /LOGIN_REQUIRED/,
  /use --cookies-from-browser or --cookies for the authentication/i,
];
const UNAVAILABLE = [
  /video unavailable/i,
  /private video/i,
  /has been removed/i,
  /members[- ]only/i,
  /confirm your age/i,
  /age[- ]restricted/i,
  /not available in your country/i,
  /premieres in/i,
  /live event will begin/i,
  /this live event has ended/i,
  /copyright/i,
];

export function classifyYtdlpError(stderr: string): YtdlpFailure {
  if (AUTH.some((r) => r.test(stderr))) return 'auth';
  if (UNAVAILABLE.some((r) => r.test(stderr))) return 'unavailable';
  return 'transient';
}

/** Extract the human readable "ERROR: ..." line(s). */
export function ytdlpErrorLine(stderr: string): string {
  const lines = stderr.split(/\r?\n/).filter((l) => l.startsWith('ERROR'));
  return (lines.pop() ?? stderr.trim().split(/\r?\n/).pop() ?? 'unknown error').slice(0, 400);
}

/** Prefer H.264 ≤1080p + AAC (no re-encode needed for most players); fall back gracefully. */
export const YTDLP_FORMAT =
  'bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b';

/** Validate a Netscape cookies.txt for YouTube and normalise line endings. */
export function normaliseCookies(raw: string): { ok: true; text: string } | { ok: false; reason: string } {
  // Pasted text often has tabs turned into spaces: rebuild the 7 tab-separated fields.
  const text =
    raw
      .replace(/^﻿/, '')
      .replace(/\r\n?/g, '\n')
      .trim()
      .split('\n')
      .map((l) => {
        const line = l.trim();
        if (!line || (line.startsWith('#') && !line.startsWith('#HttpOnly_')) || line.split('\t').length >= 7) return line;
        const parts = line.split(/\s+/);
        return parts.length >= 7 ? [...parts.slice(0, 6), parts.slice(6).join(' ')].join('\t') : line;
      })
      .join('\n') + '\n';
  const rows = text.split('\n').filter((l) => l && (!l.startsWith('#') || l.startsWith('#HttpOnly_')));
  const fields = rows.map((l) => l.replace(/^#HttpOnly_/, '').split('\t'));
  if (!fields.length || fields.some((f) => f.length < 7)) {
    return { ok: false, reason: 'This is not a Netscape cookies.txt file (each cookie line must have 7 tab-separated fields).' };
  }
  const yt = fields.filter((f) => /(^|\.)youtube\.com$/i.test(f[0]));
  if (!yt.length) return { ok: false, reason: 'The file has no youtube.com cookies. Export while on youtube.com.' };
  const names = new Set(yt.map((f) => f[5]));
  const hasSession = ['SID', '__Secure-1PSID', '__Secure-3PSID', 'LOGIN_INFO'].some((n) => names.has(n));
  if (!hasSession) return { ok: false, reason: 'No logged-in YouTube session found in the file. Log in to YouTube first, then export.' };
  return { ok: true, text };
}
