// P0-008 password login against a real database (PRD §14.5 TEST-AUTH-01..09).
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import type { AppConfig } from '../../src/app.ts';
import { createDatabase } from '../../src/db/client.ts';
import type { Database } from '../../src/db/client.ts';
import { migrate } from '../../src/db/migrate.ts';
import { MIGRATIONS_DIR } from '../../src/db/migrations-dir.ts';
import {
  LOCKOUT_MS,
  MAX_FAILED_ATTEMPTS,
  hashChallengeToken,
} from '../../src/modules/auth/login.ts';
import { hashPassword } from '../../src/modules/auth/password.ts';
import { CHALLENGE_COOKIE } from '../../src/routes/auth.ts';
import {
  connect,
  createTestDatabase,
  databaseAvailable,
  type TestDatabase,
} from '../support/database.ts';

const ORIGIN = 'http://localhost:3000';
const EMAIL = 'founder@example.invalid';
// NFC form; TEST-AUTH-06 logs in with the NFD form of the same text.
const PASSWORD = 'kata sandi rahasia café 2026'.normalize('NFC');
const config: AppConfig = {
  logLevel: 'fatal',
  nodeEnv: 'test',
  appOrigin: ORIGIN,
  session: { cookieName: '__Host-nalara_session', secret: 'test-session-secret-'.padEnd(40, 'a') },
};

describe.skipIf(!databaseAvailable)('password login', { timeout: 120_000 }, () => {
  let testDb: TestDatabase;
  let database: Database;
  let admin: pg.Client;
  let app: FastifyInstance;
  let userId: string;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    const migrator = await connect(testDb.migratorUrl);
    await migrate(migrator, MIGRATIONS_DIR);
    await migrator.end();
    admin = await connect(testDb.migratorUrl);
    const created = await admin.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'founder') RETURNING id`,
      [EMAIL, await hashPassword(PASSWORD)],
    );
    userId = created.rows[0]?.id ?? '';
    database = createDatabase(testDb.appUrl, { max: 10 });
    app = await buildApp(config, {
      readiness: () => Promise.resolve(true),
      database: database.db,
      loginRateLimitMax: 1_000,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await database.close();
    await admin.end();
    await testDb.drop();
  });

  beforeEach(async () => {
    await admin.query(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, mfa_enabled = false',
    );
  });

  const login = (
    email: string,
    password: string,
    target: FastifyInstance = app,
  ): Promise<LightMyRequestResponse> =>
    target.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: ORIGIN },
      payload: { email, password },
    });
  const errorCode = (response: LightMyRequestResponse) =>
    (JSON.parse(response.payload) as { error: { code: string } }).error.code;
  const userState = async () =>
    (
      await admin.query<{ failed_login_attempts: number; locked_until: Date | null }>(
        'SELECT failed_login_attempts, locked_until FROM users WHERE id = $1',
        [userId],
      )
    ).rows[0];
  const challengeFrom = (response: LightMyRequestResponse) =>
    /__Host-nalara_challenge=([A-Za-z0-9_-]+)/.exec(String(response.headers['set-cookie']))?.[1] ??
    '';

  describe('TEST-AUTH-01 valid password', () => {
    it('returns only an enrolment challenge cookie, never a session', async () => {
      const response = await login(EMAIL, PASSWORD);
      expect(response.statusCode).toBe(200);
      expect(response.json<{ next: string }>().next).toBe('mfa_enrolment');
      const setCookie = String(response.headers['set-cookie']);
      expect(setCookie).toMatch(new RegExp(`^${CHALLENGE_COOKIE}=[A-Za-z0-9_-]{43};`));
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/Secure/i);
      expect(setCookie).toMatch(/SameSite=Strict/i);
      expect(setCookie).not.toContain('__Host-nalara_session');
      expect(response.payload).not.toMatch(/[A-Za-z0-9_-]{43}/);

      const token = challengeFrom(response);
      const row = await admin.query<{ scope: string; used_at: Date | null }>(
        'SELECT scope, used_at FROM login_challenges WHERE token_hash = $1',
        [hashChallengeToken(token)],
      );
      expect(row.rows).toEqual([{ scope: 'enrolment', used_at: null }]);
      const sessions = await admin.query('SELECT 1 FROM sessions');
      expect(sessions.rowCount).toBe(0);
    });

    it('cannot use the challenge as a session for private routes', async () => {
      const token = challengeFrom(await login(EMAIL, PASSWORD));
      for (const cookie of [`${CHALLENGE_COOKIE}=${token}`, `__Host-nalara_session=${token}`]) {
        const response = await app.inject({
          method: 'GET',
          url: '/api/v1/os/ping',
          headers: { cookie },
        });
        expect(response.statusCode).toBe(401);
      }
    });

    it('asks for an MFA code once MFA is enabled', async () => {
      await admin.query('UPDATE users SET mfa_enabled = true');
      const response = await login(EMAIL, PASSWORD);
      expect(response.json<{ next: string }>().next).toBe('mfa');
    });

    it('invalidates an older unused challenge when a new one is issued', async () => {
      const first = challengeFrom(await login(EMAIL, PASSWORD));
      await login(EMAIL, PASSWORD);
      const row = await admin.query<{ used_at: Date | null }>(
        'SELECT used_at FROM login_challenges WHERE token_hash = $1',
        [hashChallengeToken(first)],
      );
      expect(row.rows[0]?.used_at).not.toBeNull();
    });

    it('accepts the email case-insensitively', async () => {
      expect((await login('Founder@Example.INVALID', PASSWORD)).statusCode).toBe(200);
    });
  });

  describe('TEST-AUTH-02 wrong password', () => {
    it('returns the generic failure and counts the attempt', async () => {
      const response = await login(EMAIL, 'definitely the wrong password');
      expect(response.statusCode).toBe(401);
      expect(errorCode(response)).toBe('INVALID_CREDENTIALS');
      expect(response.headers['set-cookie']).toBeUndefined();
      expect((await userState())?.failed_login_attempts).toBe(1);
    });
  });

  describe('TEST-AUTH-03 unknown account (no enumeration)', () => {
    it('is indistinguishable from a wrong password, including timing', async () => {
      const timed = async (email: string) => {
        const started = performance.now();
        const response = await login(email, 'definitely the wrong password');
        return { response, ms: performance.now() - started };
      };
      const known = await timed(EMAIL);
      const unknown = await timed('nobody@example.invalid');
      expect(unknown.response.statusCode).toBe(known.response.statusCode);
      const strip = (payload: string) => payload.replace(/"requestId":"[^"]+"/, '');
      expect(strip(unknown.response.payload)).toBe(strip(known.response.payload));
      // Both pay for one Argon2 verification (hundreds of ms); an early return would be ~1 ms.
      expect(unknown.ms).toBeGreaterThan(known.ms * 0.4);
    });
  });

  describe('TEST-AUTH-04 empty password', () => {
    it('is rejected by validation without echoing input', async () => {
      const response = await login(EMAIL, '');
      expect(response.statusCode).toBe(400);
      expect(errorCode(response)).toBe('VALIDATION_FAILED');
      expect(response.payload).not.toContain(EMAIL);
      expect((await userState())?.failed_login_attempts).toBe(0);
    });
  });

  describe('TEST-AUTH-05 oversized password', () => {
    it('rejects absurd input before hashing and treats long-but-bounded input as wrong', async () => {
      expect((await login(EMAIL, 'x'.repeat(2_000))).statusCode).toBe(400);
      const long = await login(EMAIL, 'y'.repeat(500));
      expect(long.statusCode).toBe(401);
      expect(errorCode(long)).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('TEST-AUTH-06 unicode password', () => {
    it('accepts the same password typed in another Unicode normal form', async () => {
      const nfd = PASSWORD.normalize('NFD');
      expect(nfd).not.toBe(PASSWORD);
      expect((await login(EMAIL, nfd)).statusCode).toBe(200);
    });
  });

  describe('TEST-AUTH-07 rapid failures', () => {
    it('locks the account after repeated failures, even for the correct password', async () => {
      for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) {
        expect((await login(EMAIL, `wrong password number ${String(i)}`)).statusCode).toBe(401);
      }
      const state = await userState();
      expect(state?.failed_login_attempts).toBe(MAX_FAILED_ATTEMPTS);
      expect(state?.locked_until?.getTime()).toBeGreaterThan(Date.now() + LOCKOUT_MS - 60_000);

      const whileLocked = await login(EMAIL, PASSWORD);
      expect(whileLocked.statusCode).toBe(401);
      expect(errorCode(whileLocked)).toBe('INVALID_CREDENTIALS');

      await admin.query(`UPDATE users SET locked_until = now() - interval '1 second'`);
      expect((await login(EMAIL, PASSWORD)).statusCode).toBe(200);
      expect(await userState()).toEqual({ failed_login_attempts: 0, locked_until: null });
    });

    it('limits attempts per client IP with 429', async () => {
      const limited = await buildApp(config, {
        readiness: () => Promise.resolve(true),
        database: database.db,
        loginRateLimitMax: 3,
      });
      const statuses: number[] = [];
      for (let i = 0; i < 4; i += 1)
        statuses.push((await login(EMAIL, 'wrong', limited)).statusCode);
      expect(statuses).toEqual([401, 401, 401, 429]);
      await limited.close();
    });
  });

  describe('TEST-AUTH-08 parallel login attempts', () => {
    it('counts every concurrent failure exactly once (no lost updates)', async () => {
      await admin.query('DELETE FROM audit_events');
      const attempts = 8;
      const responses = await Promise.all(
        Array.from({ length: attempts }, (_, i) => login(EMAIL, `parallel wrong ${String(i)}`)),
      );
      expect(responses.every((response) => response.statusCode === 401)).toBe(true);
      // Attempts that arrive after the lock are 'denied' and not counted; every counted one is
      // a 'failure'. A lost update would make the counter smaller than the failure count.
      const audit = await admin.query<{ result: string; n: number }>(
        `SELECT result, count(*)::int AS n FROM audit_events
         WHERE action = 'auth.password' AND resource_id = $1 GROUP BY result`,
        [userId],
      );
      const byResult = Object.fromEntries(audit.rows.map((row) => [row.result, row.n]));
      const failures = byResult['failure'] ?? 0;
      expect(failures + (byResult['denied'] ?? 0)).toBe(attempts);
      expect(failures).toBeGreaterThanOrEqual(MAX_FAILED_ATTEMPTS);
      const state = await userState();
      expect(state?.failed_login_attempts).toBe(failures);
      expect(state?.locked_until).not.toBeNull();
    });
  });

  describe('TEST-AUTH-09 hash verification and audit', () => {
    it('audits outcomes without storing the password or the email attempted', async () => {
      await admin.query('DELETE FROM audit_events');
      await login(EMAIL, PASSWORD);
      await login(EMAIL, 'wrong password here');
      await login('stranger@example.invalid', 'wrong password here');
      const rows = await admin.query<{ result: string; resource_id: string | null; dump: string }>(
        `SELECT result, resource_id, row_to_json(a)::text AS dump FROM audit_events a
         WHERE action = 'auth.password' ORDER BY created_at`,
      );
      expect(rows.rows.map((row) => [row.result, row.resource_id])).toEqual([
        ['success', userId],
        ['failure', userId],
        ['failure', null],
      ]);
      const dump = rows.rows.map((row) => row.dump).join();
      expect(dump).not.toMatch(/wrong password|kata sandi|stranger@/);
    });
  });

  describe('login CSRF', () => {
    it('refuses a cross-origin login attempt before checking credentials', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin: 'https://evil.example' },
        payload: { email: EMAIL, password: PASSWORD },
      });
      expect(response.statusCode).toBe(403);
      expect(response.headers['set-cookie']).toBeUndefined();
    });
  });
});
