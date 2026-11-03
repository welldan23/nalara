// RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30 s) compatible with common authenticator apps.
// Implemented with node:crypto only; tests check the RFC 6238 Appendix B vectors.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Accept the previous and next step to tolerate clock drift (ADR-005). */
export const TOTP_WINDOW = 1;
const SECRET_BYTES = 20;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(): Buffer {
  return randomBytes(SECRET_BYTES);
}

export function timeStep(at: Date): number {
  return Math.floor(at.getTime() / 1000 / TOTP_PERIOD_SECONDS);
}

/** HOTP (RFC 4226) value for one counter. */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function totpAt(secret: Buffer, at: Date, digits = TOTP_DIGITS): string {
  return hotp(secret, timeStep(at), digits);
}

/**
 * Returns the matching time step within the drift window, or null. Steps at or before
 * lastUsedStep are refused, so a code can never be used twice (replay).
 */
export function verifyTotp(
  secret: Buffer,
  code: string,
  at: Date,
  lastUsedStep: number | null,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = timeStep(at);
  const provided = Buffer.from(code, 'utf8');
  let matched: number | null = null;
  // Check every candidate (no early exit) so timing does not reveal which step matched.
  for (let delta = -TOTP_WINDOW; delta <= TOTP_WINDOW; delta += 1) {
    const step = current + delta;
    const expected = Buffer.from(hotp(secret, step), 'utf8');
    if (timingSafeEqual(expected, provided) && (lastUsedStep === null || step > lastUsedStep)) {
      matched = step;
    }
  }
  return matched;
}

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31] ?? '';
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (4 - bits)) & 31] ?? ''; // CI-PROOF (TEST-CI-03)
  return output;
}

/** otpauth:// URI for QR codes / manual entry in authenticator apps. */
export function otpauthUri(secret: Buffer, accountEmail: string, issuer = 'NALARA'): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
