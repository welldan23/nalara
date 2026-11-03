// Password policy and Argon2id hashing (PRD §14.5 TEST-AUTH-04..06, 09).
import { describe, expect, it } from 'vitest';
import {
  ARGON2_PARAMS,
  PASSWORD_MAX_LENGTH,
  hashPassword,
  passwordPolicyIssues,
  verifyPassword,
} from '../../src/modules/auth/password.ts';

const GOOD = 'correct horse battery staple';

describe('password policy', () => {
  it('accepts a long passphrase', () => {
    expect(passwordPolicyIssues(GOOD, 'founder@example.invalid')).toEqual([]);
  });

  it('TEST-AUTH-04 rejects empty and short passwords', () => {
    expect(passwordPolicyIssues('')).toContain('password must be at least 12 characters');
    expect(passwordPolicyIssues('short-pass1')).toContain(
      'password must be at least 12 characters',
    );
  });

  it('TEST-AUTH-05 rejects oversized passwords before any hashing', () => {
    expect(passwordPolicyIssues('a'.repeat(PASSWORD_MAX_LENGTH + 1))).toContain(
      'password must be at most 128 characters',
    );
  });

  it('rejects whitespace-only passwords and passwords containing the email name', () => {
    expect(passwordPolicyIssues(' '.repeat(20))).toContain('password must not be only whitespace');
    expect(passwordPolicyIssues('my-founder-password-2026', 'founder@example.invalid')).toContain(
      'password must not contain the email name',
    );
  });

  it('counts Unicode code points, not UTF-16 units', () => {
    // 12 emoji = 12 code points but 24 UTF-16 units.
    expect(passwordPolicyIssues('🔐'.repeat(12))).toEqual([]);
    expect(passwordPolicyIssues('🔐'.repeat(11))).toContain(
      'password must be at least 12 characters',
    );
  });

  it('never includes the password in its messages', () => {
    const secret = 'Founder2026!';
    expect(passwordPolicyIssues(secret, 'founder@example.invalid').join(' ')).not.toContain(secret);
  });
});

describe('Argon2id hashing', { timeout: 20_000 }, () => {
  it('TEST-AUTH-09 produces an argon2id PHC string with the pinned parameters', async () => {
    const encoded = await hashPassword(GOOD);
    expect(encoded).toMatch(
      new RegExp(
        `^\\$argon2id\\$v=19\\$m=${String(ARGON2_PARAMS.memoryCost)},t=${String(ARGON2_PARAMS.timeCost)},p=${String(ARGON2_PARAMS.parallelism)}\\$`,
      ),
    );
    expect(encoded).not.toContain(GOOD);
  });

  it('salts every hash and verifies only the right password', async () => {
    const [a, b] = await Promise.all([hashPassword(GOOD), hashPassword(GOOD)]);
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, GOOD)).toBe(true);
    expect(await verifyPassword(a, `${GOOD} `)).toBe(false);
    expect(await verifyPassword(a, 'wrong password entirely')).toBe(false);
  });

  it('TEST-AUTH-06 treats NFC and NFD forms of a Unicode password as the same', async () => {
    const nfc = 'kata sandi rahasia café'.normalize('NFC');
    const nfd = nfc.normalize('NFD');
    expect(nfc).not.toBe(nfd);
    expect(await verifyPassword(await hashPassword(nfc), nfd)).toBe(true);
  });

  it('returns false for malformed hashes and oversized input instead of throwing', async () => {
    expect(await verifyPassword('not-a-hash', GOOD)).toBe(false);
    const encoded = await hashPassword(GOOD);
    expect(await verifyPassword(encoded, 'x'.repeat(10_000))).toBe(false);
  });
});
