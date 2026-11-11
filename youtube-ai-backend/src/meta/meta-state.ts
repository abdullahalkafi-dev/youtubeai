import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const STATE_TTL_MS = 10 * 60 * 1000;

interface StatePayload {
  /** app user id */
  u: string;
  /** nonce */
  n: string;
  /** expiry, epoch ms */
  e: number;
}

function sign(body: string, secret: string): string {
  // Domain-separated key so the state MAC can never be confused with a JWT signature.
  const key = createHmac('sha256', secret).update('meta-oauth-state').digest();
  return createHmac('sha256', key).update(body).digest('base64url');
}

/** Signed, short-lived OAuth `state` that carries the app user id through Meta's redirect. */
export function createMetaState(userId: string, secret: string, now = Date.now()): string {
  const payload: StatePayload = { u: userId, n: randomBytes(8).toString('hex'), e: now + STATE_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

/** Returns the app user id, or null when the state is malformed, tampered with or expired. */
export function verifyMetaState(state: string | undefined, secret: string, now = Date.now()): string | null {
  if (!state || !secret) return null;
  const [body, mac, extra] = state.split('.');
  if (!body || !mac || extra !== undefined) return null;

  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload;
    if (typeof payload.u !== 'string' || typeof payload.e !== 'number') return null;
    if (payload.e < now) return null;
    return payload.u;
  } catch {
    return null;
  }
}
