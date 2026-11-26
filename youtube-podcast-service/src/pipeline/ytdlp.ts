/** Same failure classes as the reel service: a rejected session pauses everything, an unavailable video is skipped, anything else is retried. */
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

export function ytdlpErrorLine(stderr: string): string {
  const lines = stderr.split(/\r?\n/).filter((l) => l.startsWith('ERROR'));
  return (lines.pop() ?? stderr.trim().split(/\r?\n/).pop() ?? 'unknown error').slice(0, 400);
}

/** Audio only: a podcast needs the voice, not the 1 GB video. */
export const YTDLP_AUDIO_FORMAT = 'ba[ext=m4a]/ba/b';

export class VideoUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoUnavailableError';
  }
}
