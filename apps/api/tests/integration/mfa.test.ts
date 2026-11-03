// P0-009 MFA against a real database (PRD §14 TEST-MFA-01..10) plus the full login flow.
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import type { AppConfig } from '../../src/app.ts';
import { createDatabase } from '../../src/db/client.ts';
import type { Database } from '../../src/db/client.ts';
import { migrate } from '../../src/db/migrate.ts';
import { MIGRATIONS_DIR } from '../../src/db/migrations-dir.ts';
import { MAX_CHALLENGE_ATTEMPTS } from '../../src/modules/auth/mfa.ts';
import { hashPassword } from '../../src/modules/auth/password.ts';
import { totpAt } from '../../src/modules/auth/totp.ts';
import {
  connect,
  createTestDatabase,
  databaseAvailable,
  type TestDatabase,
} from '../support/database.ts';

const ORIGIN = 'http://localhost:3000';
const EMAIL = 'founder@example.invalid';
const PASSWORD = 'mfa integration passphrase 2026';
const SESSION = '__Host-nalara_session';
const CHALLENGE = '__Host-nalara_challenge';
const config: AppConfig = {
  logLevel: 'fatal',
  nodeEnv: 'test',
  appOrigin: ORIGIN,
  session: { cookieName: SESSION, secret: 'test-session-secret-'.padEnd(40, 'a') },
  mfaEncryptionKey: Buffer.alloc(32, 7),
};

function base32Decode(text: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of text) {
    value = ((value << 5) | alphabet.indexOf(char)) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Avoid the last 3 s of a 30 s step so "now" in the test equals "now" on the server. */
async function awayFromStepBoundary(): Promise<void> {
  const intoStep = (Date.now() / 1000) % 30;
  if (intoStep > 27)
    await new Promise((resolve) => setTimeout(resolve, (30 - intoStep + 0.2) * 1000));
}

const codeAt = (secret: Buffer, steps = 0) => totpAt(secret, new Date(Date.now() + steps * 30_000));

describe.skipIf(!databaseAvailable)('MFA', { timeout: 120_000 }, () => {
  let testDb: TestDatabase;
  let database: Database;
  let admin: pg.Client;
  let app: FastifyInstance;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    const migrator = await connect(testDb.migratorUrl);
    await migrate(migrator, MIGRATIONS_DIR);
    await migrator.end();
    admin = await connect(testDb.migratorUrl);
    await admin.query(`INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'founder')`, [
      EMAIL,
      await hashPassword(PASSWORD),
    ]);
    database = createDatabase(testDb.appUrl, { max: 10 });
    app = await buildApp(config, {
      readiness: () => Promise.resolve(true),
      database: database.db,
      loginRateLimitMax: 1_000,
      mfaRateLimitMax: 1_000,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await database.close();
    await admin.end();
    await testDb.drop();
  });

  const cookie = (response: LightMyRequestResponse, name: string) =>
    new RegExp(`${name}=([A-Za-z0-9_-]+)`).exec(String(response.headers['set-cookie']))?.[1];
  const post = (
    url: string,
    payload: unknown,
    cookies: Record<string, string> = {},
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method: 'POST',
      url,
      payload: payload as Record<string, unknown>,
      headers: {
        origin: ORIGIN,
        cookie: Object.entries(cookies)
          .map(([k, v]) => `${k}=${v}`)
          .join('; '),
        ...headers,
      },
    });
  const login = async () => {
    const response = await post('/api/v1/auth/login', { email: EMAIL, password: PASSWORD });
    expect(response.statusCode).toBe(200);
    return {
      next: response.json<{ next: string }>().next,
      challenge: cookie(response, CHALLENGE) ?? '',
    };
  };
  const verify = (challenge: string, factor: Record<string, string>) =>
    post('/api/v1/auth/mfa/verify', factor, { [CHALLENGE]: challenge });
  const ping = (session: string) =>
    app.inject({
      method: 'GET',
      url: '/api/v1/os/ping',
      headers: { cookie: `${SESSION}=${session}` },
    });
  const errorCode = (response: LightMyRequestResponse) =>
    (JSON.parse(response.payload) as { error: { code: string } }).error.code;
  const sessionCount = async () =>
    Number((await admin.query<{ n: string }>('SELECT count(*) AS n FROM sessions')).rows[0]?.n);

  let secret: Buffer = Buffer.alloc(0);
  let recoveryCodes: string[] = [];

  describe('enrolment (first login)', () => {
    it('an enrolment challenge cannot reach private routes or skip setup', async () => {
      const { next, challenge } = await login();
      expect(next).toBe('mfa_enrolment');
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/os/ping',
        headers: { cookie: `${CHALLENGE}=${challenge}; ${SESSION}=${challenge}` },
      });
      expect(response.statusCode).toBe(401);
      // verify without setup has no pending secret → generic failure, no session
      expect((await verify(challenge, { code: '123456' })).statusCode).toBe(401);
      expect(await sessionCount()).toBe(0);
    });

    it('TEST-MFA-10 an abandoned setup leaves MFA disabled and is discarded by the next login', async () => {
      const first = await login();
      const setup = await post('/api/v1/auth/mfa/setup', {}, { [CHALLENGE]: first.challenge });
      expect(setup.statusCode).toBe(200);
      const abandoned = base32Decode(setup.json<{ secret: string }>().secret);
      const state = await admin.query<{ mfa_enabled: boolean; totp_secret_enc: Buffer | null }>(
        'SELECT mfa_enabled, totp_secret_enc FROM users',
      );
      expect(state.rows[0]).toEqual({ mfa_enabled: false, totp_secret_enc: null });
      const second = await login();
      await awayFromStepBoundary();
      expect((await verify(first.challenge, { code: codeAt(abandoned) })).statusCode).toBe(401);
      expect(second.next).toBe('mfa_enrolment');
    });

    it('TEST-MFA-01 valid TOTP completes enrolment, stores the secret encrypted, and mints a session', async () => {
      const { challenge } = await login();
      const setup = await post('/api/v1/auth/mfa/setup', {}, { [CHALLENGE]: challenge });
      const body = setup.json<{ secret: string; otpauthUri: string }>();
      expect(body.otpauthUri).toContain(`secret=${body.secret}`);
      secret = base32Decode(body.secret);

      await awayFromStepBoundary();
      const response = await verify(challenge, { code: codeAt(secret) });
      expect(response.statusCode).toBe(200);
      const result = response.json<{ ok: boolean; recoveryCodes: string[] }>();
      recoveryCodes = result.recoveryCodes;
      expect(recoveryCodes).toHaveLength(10);
      const session = cookie(response, SESSION) ?? '';
      expect(session).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(String(response.headers['set-cookie'])).toMatch(new RegExp(`${CHALLENGE}=;`));
      expect((await ping(session)).statusCode).toBe(200);

      const stored = await admin.query<{
        mfa_enabled: boolean;
        totp_secret_enc: Buffer;
        dump: string;
      }>(`SELECT mfa_enabled, totp_secret_enc, row_to_json(u)::text AS dump FROM users u`);
      expect(stored.rows[0]?.mfa_enabled).toBe(true);
      expect(stored.rows[0]?.totp_secret_enc.includes(secret)).toBe(false);
      expect(stored.rows[0]?.dump).not.toContain(body.secret);
      const codes = await admin.query<{ dump: string }>(
        `SELECT row_to_json(r)::text AS dump FROM recovery_codes r`,
      );
      expect(codes.rowCount).toBe(10);
      expect(codes.rows.map((row) => row.dump).join()).not.toContain(
        recoveryCodes[0]?.replace(/-/g, ''),
      );
    });
  });

  describe('second factor at login', () => {
    beforeEach(async () => {
      await admin.query('UPDATE users SET totp_last_step = NULL');
    });

    it('full flow: password → mfa challenge → TOTP → session → logout', async () => {
      const { next, challenge } = await login();
      expect(next).toBe('mfa');
      await awayFromStepBoundary();
      const response = await verify(challenge, { code: codeAt(secret) });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
      const session = cookie(response, SESSION) ?? '';
      expect((await ping(session)).statusCode).toBe(200);
      const me = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { cookie: `${SESSION}=${session}` },
      });
      const csrf = me.json<{ csrfToken: string }>().csrfToken;
      expect(
        (await post('/api/v1/auth/logout', {}, { [SESSION]: session }, { 'x-csrf-token': csrf }))
          .statusCode,
      ).toBe(204);
      expect((await ping(session)).statusCode).toBe(401);
    });

    it('an mfa challenge cannot re-run setup', async () => {
      const { challenge } = await login();
      expect(
        (await post('/api/v1/auth/mfa/setup', {}, { [CHALLENGE]: challenge })).statusCode,
      ).toBe(401);
    });

    it('TEST-MFA-02 wrong TOTP is refused with the generic error', async () => {
      const { challenge } = await login();
      await awayFromStepBoundary();
      const wrong = String((Number(codeAt(secret)) + 1) % 1_000_000).padStart(6, '0');
      const response = await verify(challenge, { code: wrong });
      expect(response.statusCode).toBe(401);
      expect(errorCode(response)).toBe('INVALID_CODE');
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('TEST-MFA-03 expired challenge is refused even with a correct code', async () => {
      const { challenge } = await login();
      await admin.query(
        `UPDATE login_challenges SET expires_at = created_at + interval '1 millisecond'`,
      );
      await awayFromStepBoundary();
      expect((await verify(challenge, { code: codeAt(secret) })).statusCode).toBe(401);
    });

    it('TEST-MFA-04 replayed challenge and replayed code are refused', async () => {
      const { challenge } = await login();
      await awayFromStepBoundary();
      const code = codeAt(secret);
      expect((await verify(challenge, { code })).statusCode).toBe(200);
      expect((await verify(challenge, { code: codeAt(secret, 1) })).statusCode).toBe(401);
      const again = await login();
      expect((await verify(again.challenge, { code })).statusCode).toBe(401);
    });

    it('TEST-MFA-05 a forged or foreign challenge token is refused', async () => {
      await awayFromStepBoundary();
      for (const forged of ['', 'not-a-token', 'A'.repeat(43)]) {
        expect((await verify(forged, { code: codeAt(secret) })).statusCode).toBe(401);
      }
    });

    it('TEST-MFA-06 clock drift: ±1 step accepted, ±2 refused', async () => {
      for (const [steps, expected] of [
        [-1, 200],
        [1, 200],
        [-2, 401],
        [3, 401],
      ] as const) {
        await admin.query('UPDATE users SET totp_last_step = NULL');
        const { challenge } = await login();
        await awayFromStepBoundary();
        expect(
          (await verify(challenge, { code: codeAt(secret, steps) })).statusCode,
          `step ${String(steps)}`,
        ).toBe(expected);
      }
    });

    it('dies after too many wrong codes', async () => {
      const { challenge } = await login();
      for (let i = 0; i < MAX_CHALLENGE_ATTEMPTS; i += 1) {
        expect((await verify(challenge, { code: '000000' })).statusCode).toBe(401);
      }
      await awayFromStepBoundary();
      expect((await verify(challenge, { code: codeAt(secret) })).statusCode).toBe(401);
    });

    it('TEST-MFA-07 invalid recovery code is refused', async () => {
      const { challenge } = await login();
      expect((await verify(challenge, { recoveryCode: 'aaaa-bbbb-cccc-dddd' })).statusCode).toBe(
        401,
      );
      expect((await verify(challenge, { recoveryCode: 'short' })).statusCode).toBe(400);
    });

    it('TEST-MFA-08 a recovery code works once, in any formatting', async () => {
      const code = recoveryCodes[0] ?? '';
      const first = await login();
      const ok = await verify(first.challenge, {
        recoveryCode: code.toUpperCase().replace(/-/g, ' '),
      });
      expect(ok.statusCode).toBe(200);
      const second = await login();
      expect((await verify(second.challenge, { recoveryCode: code })).statusCode).toBe(401);
    });

    it('TEST-MFA-09 rotating recovery codes invalidates every previous code', async () => {
      const { challenge } = await login();
      await awayFromStepBoundary();
      const session = cookie(await verify(challenge, { code: codeAt(secret) }), SESSION) ?? '';
      const me = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { cookie: `${SESSION}=${session}` },
      });
      const csrf = me.json<{ csrfToken: string }>().csrfToken;
      expect(
        (await post('/api/v1/auth/mfa/recovery-codes', {}, { [SESSION]: session })).statusCode,
      ).toBe(403);
      const rotated = await post(
        '/api/v1/auth/mfa/recovery-codes',
        {},
        { [SESSION]: session },
        { 'x-csrf-token': csrf },
      );
      expect(rotated.statusCode).toBe(200);
      const fresh = rotated.json<{ recoveryCodes: string[] }>().recoveryCodes;
      expect(fresh).toHaveLength(10);
      const old = await login();
      expect(
        (await verify(old.challenge, { recoveryCode: recoveryCodes[1] ?? '' })).statusCode,
      ).toBe(401);
      const next = await login();
      expect((await verify(next.challenge, { recoveryCode: fresh[0] ?? '' })).statusCode).toBe(200);
    });

    it('concurrent use of one correct code yields exactly one session', async () => {
      const before = await sessionCount();
      const { challenge } = await login();
      await awayFromStepBoundary();
      const code = codeAt(secret);
      const results = await Promise.all([
        verify(challenge, { code }),
        verify(challenge, { code }),
        verify(challenge, { code }),
      ]);
      expect(results.filter((response) => response.statusCode === 200)).toHaveLength(1);
      expect(await sessionCount()).toBe(before + 1);
    });

    it('limits second-factor attempts per client IP with 429', async () => {
      const limited = await buildApp(config, {
        readiness: () => Promise.resolve(true),
        database: database.db,
        loginRateLimitMax: 1_000,
        mfaRateLimitMax: 2,
      });
      const statuses: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        const response = await limited.inject({
          method: 'POST',
          url: '/api/v1/auth/mfa/verify',
          headers: { origin: ORIGIN },
          payload: { code: '000000' },
        });
        statuses.push(response.statusCode);
      }
      expect(statuses).toEqual([401, 401, 429]);
      await limited.close();
    });

    it('audits MFA outcomes with only the allowed metadata', async () => {
      const rows = await admin.query<{
        action: string;
        result: string;
        metadata: Record<string, unknown>;
      }>(
        `SELECT action, result, metadata FROM audit_events WHERE action IN ('auth.mfa', 'mfa.enrol', 'mfa.recovery_rotate')`,
      );
      expect(rows.rows.some((row) => row.action === 'mfa.enrol' && row.result === 'success')).toBe(
        true,
      );
      expect(
        rows.rows.some((row) => row.action === 'auth.mfa' && row.metadata['method'] === 'recovery'),
      ).toBe(true);
      for (const row of rows.rows) {
        expect(Object.keys(row.metadata).every((key) => key === 'method')).toBe(true);
      }
    });
  });
});
