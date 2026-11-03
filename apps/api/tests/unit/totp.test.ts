// TOTP/HOTP, base32, AES-GCM secret box and recovery codes against published vectors.
import { describe, expect, it } from 'vitest';
import {
  RECOVERY_CODE_COUNT,
  generateRecoveryCodes,
  hashRecoveryCode,
  isPlausibleRecoveryCode,
} from '../../src/modules/auth/recovery-codes.ts';
import { SecretBoxError, open, seal, totpContext } from '../../src/modules/auth/secret-box.ts';
import { base32Encode, hotp, otpauthUri, totpAt, verifyTotp } from '../../src/modules/auth/totp.ts';

const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');

describe('HOTP (RFC 4226 Appendix D)', () => {
  it('matches the published 6-digit values for counters 0..9', () => {
    const expected = [
      '755224',
      '287082',
      '359152',
      '969429',
      '338314',
      '254676',
      '287922',
      '162583',
      '399871',
      '520489',
    ];
    expect(expected.map((_, counter) => hotp(RFC_SECRET, counter))).toEqual(expected);
  });
});

describe('TOTP (RFC 6238 Appendix B, SHA-1)', () => {
  it.each([
    [59, '94287082'],
    [1_111_111_109, '07081804'],
    [1_111_111_111, '14050471'],
    [1_234_567_890, '89005924'],
    [2_000_000_000, '69279037'],
    [20_000_000_000, '65353130'],
  ])('T=%i → %s', (seconds, code) => {
    expect(totpAt(RFC_SECRET, new Date(seconds * 1000), 8)).toBe(code);
  });

  it('accepts ±1 step, refuses ±2 steps, and refuses replays', () => {
    const now = new Date(1_234_567_890_000);
    const at = (steps: number) => totpAt(RFC_SECRET, new Date(now.getTime() + steps * 30_000));
    const step = Math.floor(now.getTime() / 30_000);
    expect(verifyTotp(RFC_SECRET, at(0), now, null)).toBe(step);
    expect(verifyTotp(RFC_SECRET, at(-1), now, null)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, at(1), now, null)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, at(-2), now, null)).toBeNull();
    expect(verifyTotp(RFC_SECRET, at(2), now, null)).toBeNull();
    expect(verifyTotp(RFC_SECRET, at(0), now, step)).toBeNull();
    expect(verifyTotp(RFC_SECRET, at(1), now, step)).toBe(step + 1);
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 456']) {
      expect(verifyTotp(RFC_SECRET, bad, now, null)).toBeNull();
    }
  });
});

describe('base32 (RFC 4648 §10, unpadded)', () => {
  it.each([
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ])('%s → %s', (input, output) => {
    expect(base32Encode(Buffer.from(input, 'ascii'))).toBe(output);
  });

  it('builds an otpauth URI authenticator apps understand', () => {
    const uri = otpauthUri(RFC_SECRET, 'founder@example.invalid');
    expect(uri).toBe(
      'otpauth://totp/NALARA%3Afounder%40example.invalid?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=NALARA&algorithm=SHA1&digits=6&period=30',
    );
  });
});

describe('secret box (AES-256-GCM)', () => {
  const key = Buffer.alloc(32, 9);
  const secret = Buffer.from('totp-secret-bytes');

  it('round-trips and never contains the plaintext', () => {
    const sealed = seal(key, secret, totpContext('user-a'));
    expect(sealed.includes(secret)).toBe(false);
    expect(open(key, sealed, totpContext('user-a')).equals(secret)).toBe(true);
    expect(seal(key, secret, totpContext('user-a')).equals(sealed)).toBe(false); // fresh IV
  });

  it('refuses the wrong key, the wrong owner, and tampering', () => {
    const sealed = seal(key, secret, totpContext('user-a'));
    expect(() => open(Buffer.alloc(32, 1), sealed, totpContext('user-a'))).toThrow(SecretBoxError);
    expect(() => open(key, sealed, totpContext('user-b'))).toThrow(SecretBoxError);
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 20] = (tampered[tampered.length - 20] ?? 0) ^ 1;
    expect(() => open(key, tampered, totpContext('user-a'))).toThrow(SecretBoxError);
    expect(() => open(key, Buffer.alloc(3), totpContext('user-a'))).toThrow(SecretBoxError);
  });
});

describe('recovery codes', () => {
  it('generates distinct 80-bit codes in a readable format', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const code of codes) {
      expect(code).toMatch(/^[a-z2-7]{4}(-[a-z2-7]{4}){3}$/);
      expect(isPlausibleRecoveryCode(code)).toBe(true);
    }
  });

  it('hashes independently of dashes, spaces and case', () => {
    const [code = ''] = generateRecoveryCodes(1);
    const variant = code.replace(/-/g, ' ').toUpperCase();
    expect(hashRecoveryCode(variant).equals(hashRecoveryCode(code))).toBe(true);
    expect(isPlausibleRecoveryCode('not-a-code')).toBe(false);
  });
});
