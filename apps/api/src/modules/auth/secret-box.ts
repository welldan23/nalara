// AES-256-GCM encryption for TOTP secrets at rest (ADR-005, S-06). The key lives only in the
// MFA_ENCRYPTION_KEY environment variable. Ciphertexts are bound to their owner (AAD), so a
// secret copied into another row does not decrypt.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 1;

export class SecretBoxError extends Error {
  constructor() {
    super('stored secret could not be decrypted');
    this.name = 'SecretBoxError';
  }
}

/** Layout: version(1) || iv(12) || ciphertext || tag(16). */
export function seal(key: Buffer, plaintext: Buffer, context: string): Buffer {
  if (key.length !== 32) throw new Error('AES-256-GCM key must be 32 bytes');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, ciphertext, cipher.getAuthTag()]);
}

export function open(key: Buffer, sealed: Buffer, context: string): Buffer {
  if (sealed.length < 1 + IV_BYTES + TAG_BYTES + 1 || sealed[0] !== VERSION)
    throw new SecretBoxError();
  const iv = sealed.subarray(1, 1 + IV_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  const ciphertext = sealed.subarray(1 + IV_BYTES, sealed.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new SecretBoxError();
  }
}

export function totpContext(userId: string): string {
  return `nalara:totp:${userId}`;
}
