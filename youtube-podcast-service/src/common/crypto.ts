import { createDecipheriv, createHash } from 'crypto';

/** Reads what the reel service stored with AES-256-GCM: base64(iv|tag|ciphertext), key derived from the shared secret. Decrypt only. */
export function decryptText(payload: string, secret: string): string {
  const raw = Buffer.from(payload, 'base64');
  const key = createHash('sha256').update(secret).digest();
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
