import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/** AES-256-GCM with a key derived from the service secret. Output: base64(iv|tag|ciphertext). */
export function encryptText(plain: string, secret: string): string {
  const key = createHash('sha256').update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

export function decryptText(payload: string, secret: string): string {
  const raw = Buffer.from(payload, 'base64');
  const key = createHash('sha256').update(secret).digest();
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

export function sha1(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}
