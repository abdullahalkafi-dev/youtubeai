import {
  OpenAiCreditsError,
  clearOpenAiCreditsExhausted,
  getOpenAiCreditsStatus,
  isOpenAiCreditsExhausted,
  isOpenAiInsufficientQuota,
  toOpenAiCreditsError,
} from './openai-credits';
import { retryWithBackoff } from '../utils/retry';

const noCredits = () =>
  Object.assign(new Error('429 You have no credits remaining. Add credits to continue using the API.'), {
    status: 429,
  });
const rateLimited = () =>
  Object.assign(new Error('429 Rate limit reached for requests'), { status: 429, code: 'rate_limit_exceeded' });

describe('openai credits detection', () => {
  beforeEach(() => clearOpenAiCreditsExhausted());

  it('detects no-credits by message, code and type', () => {
    expect(isOpenAiInsufficientQuota(noCredits())).toBe(true);
    expect(isOpenAiInsufficientQuota(Object.assign(new Error('x'), { status: 429, code: 'insufficient_quota' }))).toBe(true);
    expect(isOpenAiInsufficientQuota(Object.assign(new Error('x'), { status: 429, error: { type: 'insufficient_quota' } }))).toBe(true);
  });

  it('does not treat a plain rate limit or other statuses as no-credits', () => {
    expect(isOpenAiInsufficientQuota(rateLimited())).toBe(false);
    expect(isOpenAiInsufficientQuota(Object.assign(new Error('no credits remaining'), { status: 500 }))).toBe(false);
  });

  it('raises and clears the exhausted flag', () => {
    expect(isOpenAiCreditsExhausted()).toBe(false);
    expect(toOpenAiCreditsError(noCredits())).toBeInstanceOf(OpenAiCreditsError);
    expect(getOpenAiCreditsStatus().exhausted).toBe(true);
    clearOpenAiCreditsExhausted();
    expect(getOpenAiCreditsStatus()).toEqual({ exhausted: false, since: null, message: null });
  });
});

describe('retryWithBackoff with OpenAI errors', () => {
  beforeEach(() => clearOpenAiCreditsExhausted());

  it('fails fast on no-credits without retrying', async () => {
    const fn = jest.fn().mockRejectedValue(noCredits());
    await expect(retryWithBackoff(fn, { operationName: 'OpenAI Chat Fast', baseDelay: 1 })).rejects.toBeInstanceOf(
      OpenAiCreditsError,
    );
    expect(fn).toHaveBeenCalledTimes(1);
    expect(isOpenAiCreditsExhausted()).toBe(true);
  });

  it('still retries an ordinary rate limit', async () => {
    const fn = jest.fn().mockRejectedValueOnce(rateLimited()).mockResolvedValue('ok');
    await expect(retryWithBackoff(fn, { operationName: 'OpenAI Chat Fast', baseDelay: 1 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('clears the flag after a successful OpenAI call', async () => {
    toOpenAiCreditsError(noCredits());
    await retryWithBackoff(async () => 'ok', { operationName: 'OpenAI Chat Fast' });
    expect(isOpenAiCreditsExhausted()).toBe(false);
  });
});
