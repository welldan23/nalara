// One-time recovery codes (ADR-005). 10 codes of 16 base32 characters (80 bits each), shown
// once, stored only as SHA-256. Input is normalised so dashes, spaces and case do not matter.
import { createHash, randomBytes } from 'node:crypto';
import { base32Encode } from './totp.ts';

export const RECOVERY_CODE_COUNT = 10;

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const raw = base32Encode(randomBytes(10)).toLowerCase(); // 16 chars
    return raw.match(/.{4}/g)?.join('-') ?? raw;
  });
}

export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, '').toLowerCase();
}

export function isPlausibleRecoveryCode(code: string): boolean {
  return /^[a-z2-7]{16}$/.test(normalizeRecoveryCode(code));
}

export function hashRecoveryCode(code: string): Buffer {
  return createHash('sha256').update(normalizeRecoveryCode(code), 'utf8').digest();
}
