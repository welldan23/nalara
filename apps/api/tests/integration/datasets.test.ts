// P4-02 NALARA Data catalogue: datasets from registry sources, immutable versions (raw file +
// transform + observations, each hashed), and a publish step that needs a verified source, a
// publishable licence and a version that still reproduces. TEST data only.
import { createHash } from 'node:crypto';
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

const CSV_V1 = 'Bulan;Inflasi\nSeptember 2026;2,61\nOktober 2026;2,8\n';
const CSV_V2 = 'Bulan;Inflasi\nSeptember 2026;2,65\nOktober 2026;2,8\n';
const SPEC = {
  format: 'csv',
  delimiter: ';',
  decimal: ',',
  thousands: '.',
  periodColumn: 'Bulan',
  periodFormat: 'month',
  valueColumn: 'Inflasi',
};
const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

describe.skipIf(!databaseAvailable)('datasets', { timeout: 60_000 }, () => {
  let testDb: TestDatabase;
  let database: Database;
  let migrator: pg.Client;
  let app: FastifyInstance;
  let token = '';
  let csrf = '';
  let sourceId = '';
  let datasetId = '';

  beforeAll(async () => {
    testDb = await createTestDatabase();
    migrator = await connect(testDb.migratorUrl);
    await migrate(migrator, MIGRATIONS_DIR);
    const user = await migrator.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, role, mfa_enabled, totp_secret_enc)
       VALUES ('founder@example.invalid', 'x', 'founder', true, '\\x00') RETURNING id`,
    );
    sourceId =
      (
        await migrator.query<{ id: string }>(
          `INSERT INTO sources (name, organization, type, official_url, license_status, status, created_by)
           VALUES ('Berita Resmi Statistik', 'Badan Pusat Statistik', 'statistics',
                   'https://www.bps.go.id/', 'unknown', 'candidate', $1) RETURNING id`,
          [user.rows[0]?.id],
        )
      ).rows[0]?.id ?? '';
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

  const send = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown, withCsrf = true) =>
    app.inject({
      method,
      url: `/api/v1/os${url}`,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
      headers: {
        origin: ORIGIN,
        cookie: `${COOKIE}=${token}`,
        ...(withCsrf ? { 'x-csrf-token': csrf } : {}),
      },
    });
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed JSON helper for tests
  const parse = <T>(response: LightMyRequestResponse): T => response.json();
  const fields = (response: LightMyRequestResponse) =>
    parse<{ error: { fields?: { path: string; rule: string }[] } }>(response).error.fields;
  const dataset = {
    slug: 'inflasi-bulanan-test',
    title: 'Inflasi bulanan (TEST)',
    description: 'Data contoh untuk tes, bukan data resmi.',
    sourcePageUrl: 'https://www.bps.go.id/id/statistics-table/inflasi',
    unit: 'persen (yoy)',
    frequency: 'monthly',
    methodology: 'Diambil dari tabel resmi, kolom inflasi tahunan.',
  };
  const version = (overrides: Record<string, unknown> = {}) => ({
    file: b64(CSV_V1),
    filename: 'inflasi-2026.csv',
    fileUrl: 'https://www.bps.go.id/id/statistics-table/inflasi.csv',
    retrievedOn: '2026-11-03',
    spec: SPEC,
    revisionNote: 'Versi pertama.',
    ...overrides,
  });
  const current = async () =>
    parse<{ dataset: { version: number; status: string; publishedVersion: number | null } }>(
      await send('GET', `/datasets/${datasetId}`),
    ).dataset;

  it('creates a dataset from a registry source, with its own licence and methodology', async () => {
    const created = await send('POST', '/datasets', { ...dataset, sourceId });
    expect(created.statusCode, created.body).toBe(201);
    datasetId = parse<{ id: string }>(created).id;
    expect(fields(await send('POST', '/datasets', { ...dataset, sourceId }))).toEqual([
      { path: 'slug', rule: 'duplicate' },
    ]);
    expect(
      fields(
        await send('POST', '/datasets', {
          ...dataset,
          slug: 'lain',
          sourceId: '01900000-0000-7000-8000-0000000000ff',
        }),
      ),
    ).toEqual([{ path: 'sourceId', rule: 'unknown' }]);
    expect(
      (await send('POST', '/datasets', { ...dataset, slug: 'Bad Slug!', sourceId })).statusCode,
    ).toBe(400);
    expect(
      fields(
        await send('POST', '/datasets', {
          ...dataset,
          slug: 'atribusi',
          sourceId,
          licenseStatus: 'attribution_required',
        }),
      ),
    ).toEqual([{ path: 'attribution', rule: 'attribution_required' }]);
  });

  it('previews a transform without storing it, and points at the offending line', async () => {
    const preview = parse<{ observationCount: number; sample: unknown[]; sha256: string }>(
      await send('POST', '/datasets/preview', { file: b64(CSV_V1), spec: SPEC }),
    );
    expect(preview.observationCount).toBe(2);
    expect(preview.sample).toEqual([
      { series: null, period: '2026-09', value: 2.61 },
      { series: null, period: '2026-10', value: 2.8 },
    ]);
    expect(
      fields(
        await send('POST', '/datasets/preview', {
          file: b64('Bulan;Inflasi\nOktober 2026;2,8\nBulan 13;3'),
          spec: SPEC,
        }),
      ),
    ).toEqual([{ path: 'file.line.3', rule: 'period_invalid' }]);
    expect(
      (await send('POST', '/datasets/preview', { file: 'not base64!', spec: SPEC })).statusCode,
    ).toBe(400);
    expect((await migrator.query('SELECT 1 FROM dataset_versions')).rowCount).toBe(0);
  });

  it('stores immutable versions whose hashes reproduce', async () => {
    const first = await send('POST', `/datasets/${datasetId}/versions`, version());
    expect(first.statusCode, first.body).toBe(201);
    expect(parse<{ version: number }>(first).version).toBe(1);
    expect(
      fields(
        await send(
          'POST',
          `/datasets/${datasetId}/versions`,
          version({ retrievedOn: '2999-01-01' }),
        ),
      ),
    ).toEqual([{ path: 'retrievedOn', rule: 'future' }]);

    const verified = parse<{ rawMatches: boolean; observationsMatch: boolean }>(
      await send('POST', `/datasets/${datasetId}/versions/1/verify`),
    );
    expect(verified).toMatchObject({ rawMatches: true, observationsMatch: true });

    const raw = await send('GET', `/datasets/${datasetId}/versions/1/raw`);
    expect(raw.headers['content-type']).toBe('application/octet-stream');
    expect(raw.headers['content-disposition']).toMatch(
      /^attachment; filename="nalara-data-[0-9a-f]{12}\.csv"$/,
    );
    expect(raw.headers['x-raw-sha256']).toBe(createHash('sha256').update(CSV_V1).digest('hex'));
    expect(raw.rawPayload.toString()).toBe(CSV_V1);

    // Evidence: no role can change or delete a version.
    for (const client of [migrator, await connect(testDb.appUrl)]) {
      expect(
        await sqlState(client.query(`UPDATE dataset_versions SET revision_note = 'diubah'`)),
      ).toBe('42501');
      expect(await sqlState(client.query('DELETE FROM dataset_versions'))).toBe('42501');
      if (client !== migrator) await client.end();
    }
  });

  it('publishes only with a verified source and a publishable licence', async () => {
    const publish = async (v: number) =>
      send('POST', `/datasets/${datasetId}/publish`, {
        version: v,
        expectedVersion: (await current()).version,
      });
    const blocked = await publish(1);
    expect(blocked.statusCode).toBe(422);
    expect(fields(blocked)).toEqual([
      { path: 'source', rule: 'not_verified' },
      { path: 'licenseStatus', rule: 'not_publishable' },
    ]);
    await migrator.query(
      `UPDATE sources SET license_status = 'open', status = 'verified' WHERE id = $1`,
      [sourceId],
    );
    expect(fields(await publish(1))).toEqual([{ path: 'licenseStatus', rule: 'not_publishable' }]);
    // permission_required needs the permission written down.
    const update = (changes: Record<string, unknown>) =>
      current().then(({ version: expectedVersion }) =>
        send('PUT', `/datasets/${datasetId}`, {
          ...Object.fromEntries(Object.entries(dataset).filter(([key]) => key !== 'slug')),
          ...changes,
          expectedVersion,
        }),
      );
    const perm = await update({ licenseStatus: 'permission_required' });
    expect(perm.statusCode, perm.body).toBe(200);
    expect(fields(await publish(1))).toEqual([{ path: 'licenseStatus', rule: 'not_publishable' }]);
    expect((await update({ licenseStatus: 'open', licenseNote: null })).statusCode).toBe(200);
    expect((await publish(9)).statusCode).toBe(404);
    const done = await publish(1);
    expect(done.statusCode, done.body).toBe(200);
    expect(await current()).toMatchObject({ status: 'published', publishedVersion: 1 });
    // Once published, the licence cannot be made unpublishable.
    expect(fields(await update({ licenseStatus: 'unknown' }))).toEqual([
      { path: 'licenseStatus', rule: 'not_publishable' },
    ]);
  });

  it('adds a revised version without changing what is published until republished', async () => {
    const second = await send(
      'POST',
      `/datasets/${datasetId}/versions`,
      version({ file: b64(CSV_V2), revisionNote: 'Revisi angka September oleh penerbit.' }),
    );
    expect(parse<{ version: number }>(second).version).toBe(2);
    expect((await current()).publishedVersion).toBe(1);
    const detail = parse<{
      versions: { version: number; revisionNote: string; observationsSha256: string }[];
    }>(await send('GET', `/datasets/${datasetId}`));
    expect(detail.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(detail.versions[0]?.observationsSha256).not.toBe(detail.versions[1]?.observationsSha256);
    const republished = await send('POST', `/datasets/${datasetId}/publish`, {
      version: 2,
      expectedVersion: (await current()).version,
    });
    expect(republished.statusCode).toBe(200);
    expect((await current()).publishedVersion).toBe(2);
  });

  it('retracts, after which no new version can be added; all of it audited', async () => {
    const stale = await send('POST', `/datasets/${datasetId}/retract`, { expectedVersion: 1 });
    expect(stale.statusCode).toBe(409);
    const retracted = await send('POST', `/datasets/${datasetId}/retract`, {
      expectedVersion: (await current()).version,
    });
    expect(retracted.statusCode).toBe(200);
    expect((await current()).status).toBe('retracted');
    expect((await send('POST', `/datasets/${datasetId}/versions`, version())).statusCode).toBe(409);
    const audit = await migrator.query<{ action: string }>(
      `SELECT action FROM audit_events WHERE resource_type = 'dataset' ORDER BY created_at, id`,
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      'dataset.create',
      'dataset.version',
      'dataset.update',
      'dataset.update',
      'dataset.publish',
      'dataset.version',
      'dataset.publish',
      'dataset.retract',
    ]);
  });

  it('needs a founder session and CSRF', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/os/datasets' })).statusCode).toBe(401);
    expect(
      (await send('POST', '/datasets', { ...dataset, slug: 'tanpa-csrf', sourceId }, false))
        .statusCode,
    ).toBe(403);
    expect((await send('GET', '/datasets/not-a-uuid')).statusCode).toBe(404);
    expect((await send('GET', `/datasets/${datasetId}/versions/abc/raw`)).statusCode).toBe(404);
  });
});
