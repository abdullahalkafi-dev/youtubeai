/** YouTube rejected the session (bot check / expired cookies). Downloads must pause until re-login. */
export class YouTubeAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YouTubeAuthError';
  }
}

/** This specific video can't be fetched (private, age-gated, removed...). Skip it, keep the campaign going. */
export class VideoUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoUnavailableError';
  }
}

/** The campaign was cancelled by the user while a job was running. */
export class CancelledError extends Error {
  constructor(message = 'Campaign cancelled') {
    super(message);
    this.name = 'CancelledError';
  }
}

/** Non-retryable failure: retrying would produce the same result. */
export class FatalJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FatalJobError';
  }
}

export const OPENAI_NO_CREDITS_MESSAGE =
  'No OpenAI credits available. Add credits at https://platform.openai.com/settings/organization/billing and try again.';

/** The OpenAI account is out of credits. Retrying cannot help, so it is a fatal job error with a client-readable message. */
export class OpenAiCreditsError extends FatalJobError {
  constructor(message = OPENAI_NO_CREDITS_MESSAGE) {
    super(message);
    this.name = 'OpenAiCreditsError';
  }
}

/** Maps a raw OpenAI SDK 429 "insufficient_quota / no credits remaining" to OpenAiCreditsError; null for anything else. */
export function toOpenAiCreditsError(err: any): OpenAiCreditsError | null {
  if (err instanceof OpenAiCreditsError) return err;
  if ((err?.status ?? err?.response?.status) !== 429) return null;
  const code = err?.code ?? err?.error?.code;
  const type = err?.type ?? err?.error?.type;
  const msg = String(err?.message ?? '');
  if (code === 'insufficient_quota' || type === 'insufficient_quota' || /no credits remaining|insufficient[_ ]quota|exceeded your current quota/i.test(msg)) {
    return new OpenAiCreditsError();
  }
  return null;
}

export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
