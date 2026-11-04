// P1-05 Source Registry, manual: CRUD with status and licence, audited, no deletes (PRD v4 §6.2,
// §10.1 P1-05).
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
import { createSession } from '../../src/modules/auth/session.ts';
import {
  connect,
  createTestDatabase,
  databaseAvailable,
  sqlState,
  type TestDatabase,
} from '../support/database.ts';

const ORIGIN = 'http://localhost:3000';
const COOKIE = '__Host-nalara_session';
const SECRET = 'test-session-secret-'.padEnd(40, 'a');
const config: AppConfig = {
  logLevel: 'fatal',
  nodeEnv: 'test',
  appOrigin: ORIGIN,
  session: { cookieName: COOKIE, secret: SECRET },
  mfaEncryptionKey: Buffer.alloc(32, 7),
};

describe.skipIf(!databaseAvailable)('source registry', { timeout: 60_000 }, () => {
  let testDb: TestDatabase;
  let database: Database;
  let migrator: pg.Client;
  let app: FastifyInstance;
  let token = '';
  let csrf = '';

  beforeAll(async () => {
    testDb = await createTestDatabase();
    migrator = await connect(testDb.migratorUrl);
    await migrate(migrator, MIGRATIONS_DIR);
    const user = await migrator.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, role, mfa_enabled, totp_secret_enc)
       VALUES ('founder@example.invalid', 'x', 'founder', true, '\\x00') RETURNING id`,
    );
    database = createDatabase(testDb.appUrl, { max: 5 });
    const session = await createSession(database.db, user.rows[0]?.id ?? '');
    token = session.token;
    csrf = csrfTokenFor(SECRET, session.sessionId);
    app = await buildApp(config, { readiness: () => Promise.resolve(true), database: database.db });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await database.close();
    await migrator.end();
    await testDb.drop();
  });

  const send = (
    method: 'POST' | 'PATCH' | 'GET',
    url: string,
    payload?: unknown,
    csrfHeader = true,
  ) =>
    app.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
      headers: {
        origin: ORIGIN,
        cookie: `${COOKIE}=${token}`,
        ...(csrfHeader ? { 'x-csrf-token': csrf } : {}),
      },
    });
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed JSON helper for tests
  const parse = <T>(response: LightMyRequestResponse): T => response.json();
  const fields = (response: LightMyRequestResponse) =>
    parse<{ error: { fields?: { path: string; rule: string }[] } }>(response).error.fields ?? [];
  let urlCounter = 0;
  const bps = (overrides: Record<string, unknown> = {}) => {
    urlCounter += 1;
    return {
      name: 'BPS — Berita Resmi Statistik',
      organization: 'Badan Pusat Statistik',
      type: 'statistics',
      officialUrl: `https://www.bps.go.id/id/pressrelease/${String(urlCounter)}`,
      ...overrides,
    };
  };
  interface Source {
    id: string;
    status: string;
    licenseStatus: string;
    version: number;
    attribution: string | null;
    notes: string | null;
  }
  const create = async (overrides: Record<string, unknown> = {}) => {
    const response = await send('POST', '/api/v1/os/sources', bps(overrides));
    expect(response.statusCode, response.body).toBe(201);
    return parse<{ source: Source }>(response).source;
  };

  it('creates a candidate with an unknown licence by default, audited', async () => {
    const source = await create();
    expect(source).toMatchObject({ status: 'candidate', licenseStatus: 'unknown', version: 1 });
    const audit = await migrator.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM audit_events WHERE action = 'source.create' AND resource_id = $1`,
      [source.id],
    );
    expect(audit.rows[0]?.metadata).toEqual({
      version: 1,
      status: 'candidate',
      license_status: 'unknown',
    });
    const detail = await send('GET', `/api/v1/os/sources/${source.id}`);
    expect(parse<{ source: Source }>(detail).source.id).toBe(source.id);
  });

  it('refuses bad URLs, shorteners, duplicates and HTML-free control characters', async () => {
    for (const [officialUrl, rule] of [
      ['http://www.bps.go.id/', 'https_required'],
      ['https://user:pw@www.bps.go.id/', 'https_required'],
      ['javascript:alert(1)', 'https_required'],
      ['https://bit.ly/abc', 'aggregator_url'],
    ]) {
      const response = await send('POST', '/api/v1/os/sources', bps({ officialUrl }));
      expect(response.statusCode, officialUrl).toBe(400);
      expect(fields(response), officialUrl).toEqual([{ path: 'officialUrl', rule }]);
    }
    const first = await create({ officialUrl: 'https://www.bi.go.id/id/statistik' });
    expect(first.status).toBe('candidate');
    const duplicate = await send(
      'POST',
      '/api/v1/os/sources',
      bps({ officialUrl: 'https://WWW.BI.GO.ID/id/statistik' }),
    );
    expect(fields(duplicate)).toEqual([{ path: 'officialUrl', rule: 'duplicate' }]);
    const control = await send('POST', '/api/v1/os/sources', bps({ name: 'BPS\u0007' }));
    expect(fields(control)).toEqual([{ path: 'name', rule: 'control_characters' }]);
    const unknown = await send('POST', '/api/v1/os/sources', { ...bps(), extra: 'x' });
    expect(unknown.statusCode).toBe(400);
  });

  it('verifies only with a known licence, and attribution licences need the credit line', async () => {
    const blocked = await send('POST', '/api/v1/os/sources', bps({ status: 'verified' }));
    expect(fields(blocked)).toEqual([{ path: 'status', rule: 'verified_needs_license' }]);
    const noCredit = await send(
      'POST',
      '/api/v1/os/sources',
      bps({ licenseStatus: 'attribution_required' }),
    );
    expect(fields(noCredit)).toEqual([{ path: 'attribution', rule: 'attribution_required' }]);
    const verified = await create({
      status: 'verified',
      licenseStatus: 'attribution_required',
      attribution: 'Sumber: Badan Pusat Statistik',
    });
    expect(verified.status).toBe('verified');
    // The database holds the same rule even without the API.
    expect(
      await sqlState(
        migrator.query(`UPDATE sources SET license_status = 'unknown' WHERE id = $1`, [
          verified.id,
        ]),
      ),
    ).toBe('23514');
  });

  it('updates with optimistic locking and audits field names, never values', async () => {
    const source = await create();
    const body = { ...bps(), officialUrl: `https://www.bps.go.id/id/statistik-${source.id}` };
    const ok = await send('PATCH', `/api/v1/os/sources/${source.id}`, {
      ...body,
      expectedVersion: 1,
      licenseStatus: 'open',
      status: 'verified',
      notes: 'CATATAN-RAHASIA-FOUNDER',
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(parse<{ source: Source }>(ok).source).toMatchObject({ version: 2, status: 'verified' });

    const stale = await send('PATCH', `/api/v1/os/sources/${source.id}`, {
      ...body,
      expectedVersion: 1,
      status: 'paused',
    });
    expect(stale.statusCode).toBe(409);
    const unchanged = await send('PATCH', `/api/v1/os/sources/${source.id}`, {
      ...body,
      expectedVersion: 2,
      licenseStatus: 'open',
      status: 'verified',
      notes: 'CATATAN-RAHASIA-FOUNDER',
    });
    expect(fields(unchanged)).toEqual([{ path: 'source', rule: 'unchanged' }]);

    const audit = await migrator.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM audit_events WHERE action = 'source.update' AND resource_id = $1`,
      [source.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.metadata).toEqual({
      version: 2,
      status: 'verified',
      license_status: 'open',
      changed: 'officialUrl,licenseStatus,status,notes',
    });
    expect(JSON.stringify(audit.rows)).not.toContain('CATATAN-RAHASIA');

    // Clearing an optional field stores null.
    const cleared = await send('PATCH', `/api/v1/os/sources/${source.id}`, {
      ...body,
      expectedVersion: 2,
      licenseStatus: 'open',
      status: 'paused',
      notes: '   ',
    });
    expect(parse<{ source: Source }>(cleared).source).toMatchObject({
      notes: null,
      status: 'paused',
    });
  });

  it('lists by status; sources cannot be deleted, only disabled', async () => {
    const source = await create();
    await send('PATCH', `/api/v1/os/sources/${source.id}`, {
      ...bps(),
      expectedVersion: 1,
      status: 'disabled',
    });
    const disabled = parse<{ sources: Source[] }>(
      await send('GET', '/api/v1/os/sources?status=disabled'),
    ).sources;
    expect(disabled.map((entry) => entry.id)).toEqual([source.id]);
    expect((await send('GET', '/api/v1/os/sources?status=nope')).statusCode).toBe(400);
    expect(await sqlState(migrator.query('DELETE FROM sources WHERE id = $1', [source.id]))).toBe(
      '42501',
    );
    const appClient = await connect(testDb.appUrl);
    try {
      expect(await sqlState(appClient.query('DELETE FROM sources'))).toBe('42501');
    } finally {
      await appClient.end();
    }
  });

  it('needs a founder session, CSRF on writes, and hides malformed ids as 404', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/api/v1/os/sources' });
    expect(anonymous.statusCode).toBe(401);
    const noCsrf = await send('POST', '/api/v1/os/sources', bps(), false);
    expect(noCsrf.statusCode).toBe(403);
    expect((await send('GET', '/api/v1/os/sources/not-a-uuid')).statusCode).toBe(404);
    expect(
      (await send('GET', '/api/v1/os/sources/01900000-0000-7000-8000-0000000000ff')).statusCode,
    ).toBe(404);
  });
});
