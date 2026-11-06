// P4-04 NALARA Data for readers: only published datasets, only versions up to the published
// one, never the raw file or internal ids; CSV of the normalised data only under a reusable
// licence, with spreadsheet formulas neutralised. TEST data only.
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import type { AppConfig } from '../../src/app.ts';
import { createDatabase } from '../../src/db/client.ts';
import type { Database } from '../../src/db/client.ts';
import { migrate } from '../../src/db/migrate.ts';
import { MIGRATIONS_DIR } from '../../src/db/migrations-dir.ts';
import { addVersion, createDataset, publishDataset } from '../../src/modules/data/datasets.ts';
import {
  connect,
  createTestDatabase,
  databaseAvailable,
  type TestDatabase,
} from '../support/database.ts';

const base: AppConfig = {
  logLevel: 'fatal',
  nodeEnv: 'test',
  appOrigin: 'http://localhost:3000',
  session: { cookieName: '__Host-nalara_session', secret: 'test-session-secret-'.padEnd(40, 'a') },
  mfaEncryptionKey: Buffer.alloc(32, 7),
};
const SPEC = {
  format: 'csv',
  delimiter: ',',
  decimal: '.',
  thousands: '',
  periodColumn: 'Tahun',
  periodFormat: 'year',
  valueColumn: 'Nilai',
  seriesColumn: 'Seri',
};

describe.skipIf(!databaseAvailable)('public data', { timeout: 60_000 }, () => {
  let testDb: TestDatabase;
  let database: Database;
  let migrator: pg.Client;
  let app: FastifyInstance;
  let closed: FastifyInstance;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    migrator = await connect(testDb.migratorUrl);
    await migrate(migrator, MIGRATIONS_DIR);
    const userId =
      (
        await migrator.query<{ id: string }>(
          `INSERT INTO users (email, password_hash, role, mfa_enabled, totp_secret_enc)
           VALUES ('founder@example.invalid', 'x', 'founder', true, '\\x00') RETURNING id`,
        )
      ).rows[0]?.id ?? '';
    const sourceId =
      (
        await migrator.query<{ id: string }>(
          `INSERT INTO sources (name, organization, type, official_url, license_status, status, created_by)
           VALUES ('Statistik', 'Badan Pusat Statistik', 'statistics', 'https://www.bps.go.id/', 'open', 'verified', $1)
           RETURNING id`,
          [userId],
        )
      ).rows[0]?.id ?? '';
    database = createDatabase(testDb.appUrl, { max: 5 });
    const actor = { userId };
    const make = async (
      slug: string,
      license: Record<string, unknown>,
      versions: string[],
      publish?: number,
    ) => {
      const { id } = await createDataset(database.db, actor, {
        slug,
        sourceId,
        title: `Dataset ${slug} (TEST)`,
        sourcePageUrl: 'https://www.bps.go.id/id/statistics-table',
        unit: 'juta jiwa',
        frequency: 'annual',
        methodology: 'Contoh untuk tes.',
        ...license,
      });
      for (const [index, csv] of versions.entries()) {
        await addVersion(database.db, actor, id, {
          file: Buffer.from(csv).toString('base64'),
          filename: 'data.csv',
          fileUrl: 'https://www.bps.go.id/data.csv',
          retrievedOn: '2026-11-01',
          spec: SPEC,
          revisionNote: `Versi ${String(index + 1)}.`,
        });
      }
      if (publish !== undefined) {
        const version =
          (
            await migrator.query<{ version: number }>(
              'SELECT version FROM datasets WHERE id = $1',
              [id],
            )
          ).rows[0]?.version ?? 0;
        await publishDataset(database.db, actor, id, {
          version: publish,
          expectedVersion: version,
        });
      }
    };
    await make(
      'penduduk-test',
      { licenseStatus: 'attribution_required', attribution: 'Sumber: BPS' },
      [
        'Tahun,Seri,Nilai\n2024,Laki-laki,141\n2024,=HYPERLINK(1),1\n',
        'Tahun,Seri,Nilai\n2024,Laki-laki,141.5\n2024,=HYPERLINK(1),1\n',
        'Tahun,Seri,Nilai\n2024,Laki-laki,999\n',
      ],
      2,
    );
    await make(
      'izin-test',
      {
        licenseStatus: 'permission_required',
        licenseNote: 'Izin tertulis 2026-10-01, tanpa redistribusi.',
      },
      ['Tahun,Seri,Nilai\n2024,A,1\n'],
      1,
    );
    await make('draft-test', { licenseStatus: 'open' }, ['Tahun,Seri,Nilai\n2024,A,1\n']);
    app = await buildApp(
      { ...base, publicSiteEnabled: true },
      {
        readiness: () => Promise.resolve(true),
        database: database.db,
      },
    );
    closed = await buildApp(base, {
      readiness: () => Promise.resolve(true),
      database: database.db,
    });
    await Promise.all([app.ready(), closed.ready()]);
  });

  afterAll(async () => {
    await Promise.all([app.close(), closed.close()]);
    await database.close();
    await migrator.end();
    await testDb.drop();
  });

  const get = (url: string, on = app) => on.inject({ method: 'GET', url: `/api/v1/public${url}` });
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed JSON helper for tests
  const parse = <T>(response: LightMyRequestResponse): T => response.json();

  it('lists published datasets only', async () => {
    const list = parse<{ datasets: { slug: string }[] }>(await get('/datasets'));
    expect(list.datasets.map((d) => d.slug)).toEqual(['izin-test', 'penduduk-test']);
    expect((await get('/datasets', closed)).statusCode).toBe(404);
  });

  it('shows versions up to the published one, with hashes and rules, never raw files or ids', async () => {
    const response = await get('/datasets/penduduk-test');
    const found = parse<{
      dataset: Record<string, unknown>;
      versions: { version: number; spec: Record<string, unknown>; observationsSha256: string }[];
      observations: { series: string; value: number }[];
    }>(response);
    expect(found.dataset).toMatchObject({
      title: 'Dataset penduduk-test (TEST)',
      publishedVersion: 2,
      attribution: 'Sumber: BPS',
      downloadable: true,
    });
    expect(found.dataset).not.toHaveProperty('id');
    expect(found.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(found.versions[0]?.spec).toMatchObject({ periodColumn: 'Tahun', valueColumn: 'Nilai' });
    expect(found.versions[0]?.observationsSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(found.observations.find((o) => o.series === 'Laki-laki')?.value).toBe(141.5);
    expect(response.body).not.toMatch(/"raw"|"id"|created_by|createdBy/);
    for (const slug of ['draft-test', 'tidak-ada', 'BAD..slug']) {
      expect((await get(`/datasets/${slug}`)).statusCode, slug).toBe(404);
    }
  });

  it('downloads normalised CSV under a reusable licence, formulas neutralised', async () => {
    const csv = await get('/datasets/penduduk-test/data.csv');
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(csv.headers['content-disposition']).toBe('attachment; filename="penduduk-test-v2.csv"');
    expect(csv.body).toBe(
      "series,period,value\r\n'=HYPERLINK(1),2024,1\r\nLaki-laki,2024,141.5\r\n",
    );
    expect((await get('/datasets/penduduk-test/data.csv?versi=1')).body).toContain(
      'Laki-laki,2024,141\r\n',
    );
    // Not yet published, licence that forbids redistribution, draft, bad query: all 404.
    for (const url of [
      '/datasets/penduduk-test/data.csv?versi=3',
      '/datasets/izin-test/data.csv',
      '/datasets/draft-test/data.csv',
      '/datasets/penduduk-test/data.csv?versi=abc',
      '/datasets/penduduk-test/data.csv?raw=1',
    ]) {
      expect((await get(url)).statusCode, url).toBe(404);
    }
    expect(
      parse<{ dataset: { downloadable: boolean } }>(await get('/datasets/izin-test')).dataset
        .downloadable,
    ).toBe(false);
  });
});
