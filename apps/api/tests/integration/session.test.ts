// P0-010 sessions and CSRF against a real database (PRD §14 TEST-SESSION-01..10, TEST-CSRF-01..10).
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import type { AppConfig } from '../../src/app.ts';
import { createDatabase } from '../../src/db/client.ts';
import type { Database } from '../../src/db/client.ts';
import { migrate } from '../../src/db/migrate.ts';
import { MIGRATIONS_DIR } from '../../src/db/migrations-dir.ts';
import { csrfTokenFor } from '../../src/modules/auth/csrf.ts';
import {
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_IDLE_TTL_MS,
  createSession,
  hashSessionToken,
  revokeSession,
  rotateSession,
} from '../../src/modules/auth/session.ts';
import { issueSessionCookie } from '../../src/routes/auth.ts';
import {
  connect,
  createTestDatabase,
  databaseAvailable,
  type TestDatabase,
} from '../support/database.ts';

const ORIGIN = 'http://localhost:3000';
const COOKIE = '__Host-nalara_session';
const config: AppConfig = {
  logLevel: 'fatal',
  nodeEnv: 'test',
  appOrigin: ORIGIN,
  session: { cookieName: COOKIE, secret: 'test-session-secret-'.padEnd(40, 'a') },
  mfaEncryptionKey: Buffer.alloc(32, 7),
};

describe.skipIf(!databaseAvailable)('sessions and CSRF', { timeout: 60_000 }, () => {
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
      `INSERT INTO users (email, password_hash, role) VALUES ('founder@example.invalid', 'x', 'founder') RETURNING id`,
    );
    userId = created.rows[0]?.id ?? '';
    database = createDatabase(testDb.appUrl, { max: 4 });
    app = await buildApp(config, { readiness: () => Promise.resolve(true), database: database.db });
    // Test-only stand-in for the login route (P0-008) so cookie attributes can be checked.
    app.post('/__test/login', async (_request, reply) => {
      issueSessionCookie(reply, COOKIE, await createSession(database.db, userId));
      return reply.code(204).send();
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await database.close();
    await admin.end();
    await testDb.drop();
  });

  const cookieFor = (token: string) => ({ cookie: `${COOKIE}=${token}` });
  const ping = (token?: string): Promise<LightMyRequestResponse> =>
    app.inject({
      method: 'GET',
      url: '/api/v1/os/ping',
      headers: token === undefined ? {} : cookieFor(token),
    });
  const logout = (token: string, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { ...cookieFor(token), ...headers },
    });
  const newSession = () => createSession(database.db, userId);
  const csrf = (sessionId: string) => csrfTokenFor(config.session.secret, sessionId);
  const code = (response: LightMyRequestResponse) =>
    (JSON.parse(response.payload) as { error: { code: string } }).error.code;

  describe('anonymous access', () => {
    it('is denied on every private route', async () => {
      expect((await ping()).statusCode).toBe(401);
      expect(code(await ping())).toBe('UNAUTHORIZED');
      expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me' })).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST', url: '/api/v1/auth/logout' })).statusCode).toBe(
        401,
      );
    });
  });

  describe('TEST-SESSION-01 session issuance', () => {
    it('stores only the SHA-256 of a 256-bit opaque token', async () => {
      const issued = await newSession();
      expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const row = await admin.query<{ token_hash: Buffer }>(
        'SELECT token_hash FROM sessions WHERE id = $1',
        [issued.sessionId],
      );
      expect(row.rows[0]?.token_hash.equals(hashSessionToken(issued.token))).toBe(true);
      const all = await admin.query<{ dump: string }>(
        `SELECT row_to_json(s)::text AS dump FROM sessions s`,
      );
      expect(all.rows.map((r) => r.dump).join()).not.toContain(issued.token);
      expect((await ping(issued.token)).statusCode).toBe(200);
    });
  });

  describe('TEST-SESSION-02..04 cookie attributes', () => {
    it('sets a host-only, HttpOnly, Secure, SameSite=Lax cookie', async () => {
      const response = await app.inject({ method: 'POST', url: '/__test/login' });
      const setCookie = String(response.headers['set-cookie']);
      expect(setCookie).toMatch(new RegExp(`^${COOKIE}=[A-Za-z0-9_-]{43};`));
      expect(setCookie).toMatch(/; HttpOnly/i); // 02
      expect(setCookie).toMatch(/; Secure/i); // 03
      expect(setCookie).toMatch(/; SameSite=Lax/i); // 04
      expect(setCookie).toMatch(/; Path=\//);
      expect(setCookie).not.toMatch(/Domain=/i);
      expect(setCookie).toMatch(/; Expires=/);
    });
  });

  describe('TEST-SESSION-05 expired session', () => {
    it('rejects a session past its absolute lifetime', async () => {
      const past = new Date(Date.now() - SESSION_ABSOLUTE_TTL_MS - 60_000);
      const issued = await createSession(database.db, userId, past);
      expect((await ping(issued.token)).statusCode).toBe(401);
    });

    it('rejects a session idle for longer than the idle limit', async () => {
      const idleSince = new Date(Date.now() - SESSION_IDLE_TTL_MS - 60_000);
      const issued = await createSession(database.db, userId, idleSince);
      expect((await ping(issued.token)).statusCode).toBe(401);
    });

    it('extends idle time while the session is used', async () => {
      const recent = new Date(Date.now() - 5 * 60_000);
      const issued = await createSession(database.db, userId, recent);
      expect((await ping(issued.token)).statusCode).toBe(200);
      const row = await admin.query<{ last_seen_at: Date }>(
        'SELECT last_seen_at FROM sessions WHERE id = $1',
        [issued.sessionId],
      );
      expect(row.rows[0]?.last_seen_at.getTime()).toBeGreaterThan(recent.getTime());
    });
  });

  describe('TEST-SESSION-06 revoked session', () => {
    it('rejects a revoked session immediately', async () => {
      const issued = await newSession();
      expect((await ping(issued.token)).statusCode).toBe(200);
      expect(await revokeSession(database.db, issued.sessionId)).toBe(true);
      expect((await ping(issued.token)).statusCode).toBe(401);
      expect(await revokeSession(database.db, issued.sessionId)).toBe(false);
    });
  });

  describe('TEST-SESSION-07 logout twice', () => {
    it('revokes server-side, clears the cookie, audits once, and rejects a second logout', async () => {
      const issued = await newSession();
      const headers = { origin: ORIGIN, 'x-csrf-token': csrf(issued.sessionId) };
      const first = await logout(issued.token, headers);
      expect(first.statusCode).toBe(204);
      expect(String(first.headers['set-cookie'])).toMatch(
        new RegExp(`^${COOKIE}=;.*Expires=Thu, 01 Jan 1970`),
      );
      expect((await ping(issued.token)).statusCode).toBe(401);
      expect((await logout(issued.token, headers)).statusCode).toBe(401);
      const audit = await admin.query(
        `SELECT 1 FROM audit_events WHERE action = 'session.logout' AND resource_id = $1`,
        [issued.sessionId],
      );
      expect(audit.rowCount).toBe(1);
    });
  });

  describe('TEST-SESSION-08 stolen or malformed token', () => {
    it.each(['garbage', '', 'a'.repeat(44), "x' OR '1'='1", 'A'.repeat(43)])(
      'rejects %j with 401, never 500',
      async (token) => {
        const response = await ping(token);
        expect(response.statusCode).toBe(401);
      },
    );
  });

  describe('TEST-SESSION-09 session rotation', () => {
    it('revokes the previous session when a new one is issued', async () => {
      const old = await newSession();
      const fresh = await rotateSession(database.db, userId, old.sessionId);
      expect(fresh.token).not.toBe(old.token);
      expect((await ping(old.token)).statusCode).toBe(401);
      expect((await ping(fresh.token)).statusCode).toBe(200);
    });
  });

  describe('TEST-SESSION-10 database outage fails closed', () => {
    it('denies access when sessions cannot be checked', async () => {
      const broken = createDatabase('postgres://nalara_app:x@127.0.0.1:9/none', {
        connectionTimeoutMs: 300,
      });
      const outageApp = await buildApp(config, {
        readiness: () => Promise.resolve(false),
        database: broken.db,
      });
      const issued = await newSession();
      const response = await outageApp.inject({
        method: 'GET',
        url: '/api/v1/os/ping',
        headers: cookieFor(issued.token),
      });
      expect(response.statusCode).toBe(503);
      // Only the error envelope: the route's own answer ({ ok: true }) never leaks. Compared as
      // structure, not text: the random request id can itself contain "ok".
      const body = JSON.parse(response.payload) as Record<string, unknown>;
      expect(Object.keys(body)).toEqual(['error']);
      expect((body['error'] as { code: string }).code).toBe('NOT_READY');
      await outageApp.close();
      await broken.close();
    });
  });

  describe('/api/v1/auth/me', () => {
    it('returns the founder profile and a CSRF token, never secrets', async () => {
      const issued = await newSession();
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: cookieFor(issued.token),
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ user: Record<string, unknown>; csrfToken: string }>();
      expect(body.user).toEqual({
        id: userId,
        email: 'founder@example.invalid',
        role: 'founder',
        mfaEnabled: false,
      });
      expect(body.csrfToken).toBe(csrf(issued.sessionId));
      expect(response.payload).not.toMatch(/password|token_hash|secret/i);
    });
  });

  describe('CSRF', () => {
    const stillValid = async (token: string) => {
      expect((await ping(token)).statusCode).toBe(200);
    };

    it('TEST-CSRF-01 missing token is rejected and the session survives', async () => {
      const issued = await newSession();
      const response = await logout(issued.token, { origin: ORIGIN });
      expect(response.statusCode).toBe(403);
      await stillValid(issued.token);
    });

    it('TEST-CSRF-02 invalid token is rejected', async () => {
      const issued = await newSession();
      expect(
        (await logout(issued.token, { origin: ORIGIN, 'x-csrf-token': 'not-the-token' }))
          .statusCode,
      ).toBe(403);
      await stillValid(issued.token);
    });

    it('TEST-CSRF-03 cross-origin POST is rejected before routing, even with a valid token', async () => {
      const issued = await newSession();
      const response = await logout(issued.token, {
        origin: 'https://evil.example',
        'x-csrf-token': csrf(issued.sessionId),
      });
      expect(response.statusCode).toBe(403);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/anything',
            headers: { origin: 'https://evil.example' },
          })
        ).statusCode,
      ).toBe(403);
      await stillValid(issued.token);
    });

    it('TEST-CSRF-04 same-origin POST with the right token succeeds', async () => {
      const issued = await newSession();
      expect(
        (await logout(issued.token, { origin: ORIGIN, 'x-csrf-token': csrf(issued.sessionId) }))
          .statusCode,
      ).toBe(204);
    });

    it('TEST-CSRF-04b Sec-Fetch-Site same-origin is accepted when Origin is absent', async () => {
      const issued = await newSession();
      const response = await logout(issued.token, {
        'sec-fetch-site': 'same-origin',
        'x-csrf-token': csrf(issued.sessionId),
      });
      expect(response.statusCode).toBe(204);
    });

    it('TEST-CSRF-05 Origin that differs only by port is rejected', async () => {
      const issued = await newSession();
      const response = await logout(issued.token, {
        origin: 'http://localhost:3001',
        'x-csrf-token': csrf(issued.sessionId),
      });
      expect(response.statusCode).toBe(403);
      await stillValid(issued.token);
    });

    it('TEST-CSRF-06 GET never performs logout', async () => {
      const issued = await newSession();
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/logout',
        headers: cookieFor(issued.token),
      });
      expect(response.statusCode).toBe(404);
      await stillValid(issued.token);
    });

    it('TEST-CSRF-07 non-JSON content type is rejected', async () => {
      const issued = await newSession();
      const response = await logout(issued.token, {
        origin: ORIGIN,
        'x-csrf-token': csrf(issued.sessionId),
        'content-type': 'text/plain',
      });
      // Body parsing happens before the handler; with a body the spoofed type is refused.
      const withBody = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: {
          ...cookieFor(issued.token),
          origin: ORIGIN,
          'x-csrf-token': csrf(issued.sessionId),
          'content-type': 'text/plain',
        },
        payload: 'logout=1',
      });
      expect(withBody.statusCode).toBe(415);
      expect([204, 415]).toContain(response.statusCode);
    });

    it('TEST-CSRF-08 a token from another session is useless', async () => {
      const a = await newSession();
      const b = await newSession();
      expect(
        (await logout(b.token, { origin: ORIGIN, 'x-csrf-token': csrf(a.sessionId) })).statusCode,
      ).toBe(403);
      await stillValid(b.token);
    });

    it('TEST-CSRF-09 a preflight from an unexpected origin gets no CORS grant', async () => {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/api/v1/auth/logout',
        headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
      });
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('TEST-CSRF-10 cross-site logout and header-less mutations are rejected', async () => {
      const issued = await newSession();
      expect(
        (
          await logout(issued.token, {
            'sec-fetch-site': 'cross-site',
            'x-csrf-token': csrf(issued.sessionId),
          })
        ).statusCode,
      ).toBe(403);
      // No Origin and no Sec-Fetch-Site: not a browser on our pages, so authenticated mutations refuse.
      expect(
        (await logout(issued.token, { 'x-csrf-token': csrf(issued.sessionId) })).statusCode,
      ).toBe(403);
      await stillValid(issued.token);
    });
  });
});
