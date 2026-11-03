// Password policy and Argon2id hashing (PRD B §6.1, ADR-004). The encoded PHC string stores
// its own parameters, so they can be retuned on the VPS later without breaking old hashes.
import { hash, verify } from '@node-rs/argon2';
import type { Algorithm } from '@node-rs/argon2';

/** OWASP/RFC 9106-aligned defaults; retune on the production VPS before launch (S-10). */
export const ARGON2_PARAMS = {
  // Algorithm.Argon2id; the library exports a const enum, which verbatimModuleSyntax cannot
  // import as a value. The unit test asserts the resulting hash really is $argon2id$.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-assignment -- const enum value 2 = Argon2id, see above
  algorithm: 2 as Algorithm,
  memoryCost: 65_536, // KiB = 64 MiB
  timeCost: 3,
  parallelism: 1,
} as const;

export const PASSWORD_MIN_LENGTH = 12;
/** Upper bound keeps hashing cost bounded (TEST-AUTH-05: oversized password). */
export const PASSWORD_MAX_LENGTH = 128;

/** Unicode NFC so the same password typed on different keyboards/OSes hashes identically. */
export function normalizePassword(password: string): string {
  return password.normalize('NFC');
}

/** Returns rule violations (never the password itself). Empty array = acceptable. */
export function passwordPolicyIssues(password: string, email?: string): string[] {
  const normalized = normalizePassword(password);
  const length = codePointLength(normalized);
  const issues: string[] = [];
  if (length < PASSWORD_MIN_LENGTH) {
    issues.push(`password must be at least ${String(PASSWORD_MIN_LENGTH)} characters`);
  }
  if (length > PASSWORD_MAX_LENGTH) {
    issues.push(`password must be at most ${String(PASSWORD_MAX_LENGTH)} characters`);
  }
  if (normalized.trim().length === 0 && length > 0) {
    issues.push('password must not be only whitespace');
  }
  const localPart = email?.split('@')[0]?.toLowerCase();
  if (
    localPart !== undefined &&
    localPart.length >= 3 &&
    normalized.toLowerCase().includes(localPart)
  ) {
    issues.push('password must not contain the email name');
  }
  return issues;
}

/** Length in Unicode code points ("🔐" counts as 1), not UTF-16 code units. */
export function codePointLength(text: string): number {
  // Array.from iterates by code point, unlike text.length.
  return Array.from(text).length;
}

export async function hashPassword(password: string): Promise<string> {
  return hash(normalizePassword(password), ARGON2_PARAMS);
}

/** Constant-time comparison is done inside the Argon2 library. False on any malformed hash. */
export async function verifyPassword(encodedHash: string, password: string): Promise<boolean> {
  if (codePointLength(password) > PASSWORD_MAX_LENGTH) return false;
  try {
    return await verify(encodedHash, normalizePassword(password));
  } catch {
    return false;
  }
}
