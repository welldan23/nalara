// P4-03 charts in articles: the editor preview draws any dataset version (and says whether it is
// published); approve and publish are held until the charted version is published; readers get
// exactly the pinned version, and nothing once the dataset is retracted. TEST data only.
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
  addVersion,
  createDataset,
  publishDataset,
  retractDataset,
} from '../../src/modules/data/datasets.ts';
import {
  connect,
  createTestDatabase,
  databaseAvailable,
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
  publicSiteEnabled: true,
};

const SPEC = {
  format: 'csv',
  delimiter: ';',
  decimal: ',',
  thousands: '.',
  periodColumn: 'Bulan',
  periodFormat: 'month',
  valueColumn: 'Kurs',
};
const CITATION = {
  id: '01900000-0000-7000-8000-00000000000a',
  url: 'https://www.bi.go.id/id/statistik/kurs.aspx',
  publisher: 'Bank Indonesia',
  title: 'Kurs referensi',
  accessedAt: '2026-11-03',
  claimNote: '',
  primary: true,
  verified: true,
};
const BODY = [
  'Kurs rupiah melemah tipis sepanjang Oktober.',
  '',
  ':::grafik',
  'data: kurs-test@1',
  'jenis: garis',
  'judul: Kurs rupiah per dolar AS (TEST)',
  ':::',
].join('\n');

describe.skipIf(!databaseAvailable)('charts in articles', { timeout: 60_000 }, () => {
  let testDb: TestDatabase;
  let database: Database;
  let migrator: pg.Client;
  let app: FastifyInstance;
  let token = '';
  let csrf = '';
  let userId = '';
  let categoryId = '';
  let datasetId = '';
  let articleId = '';

  beforeAll(async () => {
    testDb = await createTestDatabase();
    migrator = await connect(testDb.migratorUrl);
    await migrate(migrator, MIGRATIONS_DIR);
    userId =
      (
        await migrator.query<{ id: string }>(
          `INSERT INTO users (email, password_hash, role, mfa_enabled, totp_secret_enc)
           VALUES ('founder@example.invalid', 'x', 'founder', true, '\\x00') RETURNING id`,
        )
      ).rows[0]?.id ?? '';
    categoryId =
      (await migrator.query<{ id: string }>(`SELECT id FROM categories WHERE slug = 'ekonomi'`))
        .rows[0]?.id ?? '';
    const sourceId =
      (
        await migrator.query<{ id: string }>(
          `INSERT INTO sources (name, organization, type, official_url, license_status, status, created_by)
           VALUES ('Statistik', 'Bank Indonesia', 'central_bank', 'https://www.bi.go.id/', 'open', 'verified', $1)
           RETURNING id`,
          [userId],
        )
      ).rows[0]?.id ?? '';
    database = createDatabase(testDb.appUrl, { max: 5 });
    const actor = { userId };
    datasetId = (
      await createDataset(database.db, actor, {
        slug: 'kurs-test',
        sourceId,
        title: 'Kurs rupiah bulanan (TEST)',
        sourcePageUrl: 'https://www.bi.go.id/id/statistik/kurs.aspx',
        unit: 'rupiah per USD',
        frequency: 'monthly',
        licenseStatus: 'attribution_required',
        attribution: 'Sumber data: Bank Indonesia',
      })
    ).id;
    for (const [csv, note] of [
      ['Bulan;Kurs\nSeptember 2026;16.250,5\nOktober 2026;16.310\n', 'Versi pertama.'],
      ['Bulan;Kurs\nSeptember 2026;16.250,5\nOktober 2026;16.400\n', 'Revisi Oktober.'],
    ] as const) {
      await addVersion(database.db, actor, datasetId, {
        file: Buffer.from(csv).toString('base64'),
        filename: 'kurs.csv',
        fileUrl: 'https://www.bi.go.id/id/statistik/kurs.csv',
        retrievedOn: '2026-11-03',
        spec: SPEC,
        revisionNote: note,
      });
    }
    const session = await createSession(database.db, userId);
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

  const post = (url: string, payload: unknown) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/os${url}`,
      payload: payload as Record<string, unknown>,
      headers: { origin: ORIGIN, cookie: `${COOKIE}=${token}`, 'x-csrf-token': csrf },
    });
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed JSON helper for tests
  const parse = <T>(response: LightMyRequestResponse): T => response.json();
  const datasetVersion = async () =>
    (await migrator.query<{ version: number }>('SELECT version FROM datasets')).rows[0]?.version ??
    0;
  interface Chart {
    unit: string;
    observations: { period: string; value: number }[];
    published?: boolean;
    attribution: string | null;
  }

  it('previews any version, saying whether it is published', async () => {
    const preview = parse<{ blocks: unknown[]; issues: unknown[]; charts: Record<string, Chart> }>(
      await post('/articles/preview', {
        title: 'Kurs Oktober',
        dek: 'TEST',
        bodySource: BODY,
        citations: [CITATION],
      }),
    );
    expect(preview.issues).toEqual([]);
    expect(preview.charts['kurs-test@1']).toMatchObject({
      unit: 'rupiah per USD',
      published: false,
      observations: [
        { series: null, period: '2026-09', value: 16250.5 },
        { series: null, period: '2026-10', value: 16310 },
      ],
    });
  });

  it('holds the article until the charted version is published', async () => {
    const created = await post('/articles', {
      title: 'Kurs rupiah Oktober',
      dek: 'TEST fixture, bukan artikel nyata.',
      articleType: 'explainer',
      categoryId,
      methodNote: null,
      bodySource: BODY,
      citations: [CITATION],
    });
    expect(created.statusCode, created.body).toBe(201);
    articleId = parse<{ articleId: string }>(created).articleId;
    expect((await post(`/articles/${articleId}/submit`, { expectedVersion: 1 })).statusCode).toBe(
      200,
    );
    const blocked = await post(`/articles/${articleId}/approve`, { expectedVersion: 1 });
    expect(blocked.statusCode).toBe(422);
    expect(parse<{ error: { fields: { rule: string }[] } }>(blocked).error.fields).toEqual([
      { path: 'gate', rule: 'chart_dataset_unpublished' },
    ]);

    await publishDataset(database.db, { userId }, datasetId, {
      version: 1,
      expectedVersion: await datasetVersion(),
    });
    for (const action of ['approve', 'publish']) {
      const response = await post(`/articles/${articleId}/${action}`, { expectedVersion: 1 });
      expect(response.statusCode, `${action}: ${response.body}`).toBe(200);
    }
  });

  it('shows readers the pinned version only, with its source and licence', async () => {
    const slug =
      (
        await migrator.query<{ slug: string }>('SELECT slug FROM articles WHERE id = $1', [
          articleId,
        ])
      ).rows[0]?.slug ?? '';
    const read = async () =>
      parse<{ article: { charts: Record<string, Chart> } }>(
        await app.inject({ method: 'GET', url: `/api/v1/public/articles/${slug}` }),
      ).article.charts;
    const charts = await read();
    expect(Object.keys(charts)).toEqual(['kurs-test@1']);
    expect(charts['kurs-test@1']).toMatchObject({
      attribution: 'Sumber data: Bank Indonesia',
      observations: [
        { period: '2026-09', value: 16250.5 },
        { period: '2026-10', value: 16310 },
      ],
    });
    expect(charts['kurs-test@1']).not.toHaveProperty('published');

    // A newer published version does not change the article: it stays pinned to v1.
    await publishDataset(database.db, { userId }, datasetId, {
      version: 2,
      expectedVersion: await datasetVersion(),
    });
    expect((await read())['kurs-test@1']?.observations.at(-1)?.value).toBe(16310);

    // Retracted data is no longer drawn for readers.
    await retractDataset(database.db, { userId }, datasetId, {
      expectedVersion: await datasetVersion(),
    });
    expect(await read()).toEqual({});
  });
});
