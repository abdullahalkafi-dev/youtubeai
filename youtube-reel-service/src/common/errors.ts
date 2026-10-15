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

export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
