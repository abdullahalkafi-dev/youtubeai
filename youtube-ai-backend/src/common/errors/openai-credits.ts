/**
 * OpenAI "no credits" handling.
 *
 * OpenAI answers 429 for two very different things: a rate limit (worth retrying)
 * and `insufficient_quota` / "You have no credits remaining" (never worth retrying,
 * the client has to add credits). This module detects the second one once, turns it
 * into a typed error, and keeps a small in-process flag so background jobs can
 * pause and the dashboard can show a banner.
 */

export const OPENAI_NO_CREDITS_CODE = 'OPENAI_NO_CREDITS';

export const OPENAI_NO_CREDITS_MESSAGE =
  'No OpenAI credits available. Add credits at https://platform.openai.com/settings/organization/billing and try again.';

/** How long the flag stays up after the last credits error. Background jobs re-probe after this. */
export const OPENAI_CREDITS_FLAG_TTL_MS = 15 * 60 * 1000;

export class OpenAiCreditsError extends Error {
  readonly code = OPENAI_NO_CREDITS_CODE;
  readonly status = 402;

  constructor(message: string = OPENAI_NO_CREDITS_MESSAGE) {
    super(message);
    this.name = 'OpenAiCreditsError';
  }
}

export function isOpenAiCreditsError(error: any): boolean {
  return error instanceof OpenAiCreditsError || error?.code === OPENAI_NO_CREDITS_CODE;
}

/** True for an OpenAI SDK error that means the account is out of credits (not a plain rate limit). */
export function isOpenAiInsufficientQuota(error: any): boolean {
  const status = error?.status ?? error?.response?.status ?? error?.statusCode;
  if (status !== 429) return false;
  const code = error?.code ?? error?.error?.code ?? error?.error?.error?.code;
  const type = error?.type ?? error?.error?.type ?? error?.error?.error?.type;
  if (code === 'insufficient_quota' || type === 'insufficient_quota') return true;
  const message = String(error?.message ?? '');
  return /no credits remaining|insufficient[_ ]quota|exceeded your current quota/i.test(message);
}

/** Maps a raw OpenAI error to OpenAiCreditsError (and raises the flag); returns null when it is something else. */
export function toOpenAiCreditsError(error: any): OpenAiCreditsError | null {
  if (error instanceof OpenAiCreditsError) {
    markOpenAiCreditsExhausted();
    return error;
  }
  if (!isOpenAiInsufficientQuota(error)) return null;
  markOpenAiCreditsExhausted();
  return new OpenAiCreditsError();
}

let lastCreditsErrorAt = 0;

export function markOpenAiCreditsExhausted(): void {
  lastCreditsErrorAt = Date.now();
}

/** Called after a successful OpenAI call: credits are back. */
export function clearOpenAiCreditsExhausted(): void {
  lastCreditsErrorAt = 0;
}

export function isOpenAiCreditsExhausted(): boolean {
  return lastCreditsErrorAt > 0 && Date.now() - lastCreditsErrorAt < OPENAI_CREDITS_FLAG_TTL_MS;
}

export function getOpenAiCreditsStatus(): {
  exhausted: boolean;
  since: string | null;
  message: string | null;
} {
  const exhausted = isOpenAiCreditsExhausted();
  return {
    exhausted,
    since: exhausted ? new Date(lastCreditsErrorAt).toISOString() : null,
    message: exhausted ? OPENAI_NO_CREDITS_MESSAGE : null,
  };
}
