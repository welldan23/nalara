// Kartu NALARA over HTTP: founder only, published articles only, real PNGs. TEST data only.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import type { AppConfig } from '../../src/app.ts';
import { createDatabase } from '../../src/db/client.ts';
import type { Database } from '../../src/db/client.ts';
import { migrate } from '../../src/db/migrate.ts';
import { MIGRATIONS_DIR } from '../../src/db/migrations-dir.ts';
import { createDraft } from '../../src/modules/articles/articles.ts';
import { parseMarkdown } from '../../src/modules/articles/markdown.ts';
import { transition } from '../../src/modules/articles/workflow.ts';
import type { TransitionAction } from '../../src/modules/articles/workflow.ts';
import { createSession } from '../../src/modules/auth/session.ts';
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
};
const CITE = '01900000-0000-7000-8000-00000000000a';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe.skipIf(!databaseAvailable)('Kartu NALARA routes', { timeout: 120_000 }, () => {
  let testDb: TestDatabase;
  let database: Database;
  let app: FastifyInstance;
  let token = '';
  const slugs: Record<string, string> = {};

  const make = async (
    title: string,
    categoryId: string,
    founderId: string,
    steps: TransitionAction[],
  ) => {
    const bodySource = [
      ':::angka',
      'nilai: 2,8',
      'satuan: persen',
      'periode: Oktober 2026',
      'label: Inflasi TEST',
      'sumber: 1',
      ':::',
      '',
      '## Konteks',
      '',
      `Isi ${title}. TEST fixture.`,
    ].join('\n');
    const saved = await createDraft(
      database.db,
      { userId: founderId },
      {
        content: {
          title,
          dek: `Ringkasan ${title}`,
          articleType: 'explainer',
          categoryId,
          body: parseMarkdown(bodySource, { citationIds: [CITE] }).blocks,
          bodySource,
          methodNote: null,
          citations: [
            {
              id: CITE,
              url: 'https://www.bps.go.id/id/pressrelease/x.html',
              publisher: 'Badan Pusat Statistik',
              title: 'Rilis TEST',
              accessedAt: '2026-11-03',
              claimNote: 'CATATAN-INTERNAL',
              primary: true,
              verified: true,
            },
          ],
        },
      },
    );
    for (const step of steps) {
      await transition(database.db, { userId: founderId }, saved.articleId, step, {
        expectedVersion: 1,
      });
    }
    return saved.slug;
  };

  beforeAll(async () => {
    testDb = await createTestDatabase();
    const migrator = await connect(testDb.migratorUrl);
    await migrate(migrator, MIGRATIONS_DIR);
    const founderId =
      (
        await migrator.query<{ id: string }>(
          `INSERT INTO users (email, password_hash, role, mfa_enabled, totp_secret_enc)
           VALUES ('founder@example.invalid', 'x', 'founder', true, '\\x00') RETURNING id`,
        )
      ).rows[0]?.id ?? '';
    const categoryId =
      (await migrator.query<{ id: string }>(`SELECT id FROM categories WHERE slug = 'ekonomi'`))
        .rows[0]?.id ?? '';
    await migrator.end();
    database = createDatabase(testDb.appUrl, { max: 5 });
    slugs['draft'] = await make('Masih draft', categoryId, founderId, []);
    slugs['published'] = await make('Sudah terbit', categoryId, founderId, [
      'submit',
      'approve',
      'publish',
    ]);
    token = (await createSession(database.db, founderId)).token;
    app = await buildApp(config, { readiness: () => Promise.resolve(true), database: database.db });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await database.close();
    await testDb.drop();
  });

  const get = (url: string, withSession = true) =>
    app.inject({
      method: 'GET',
      url,
      ...(withSession ? { cookies: { [COOKIE]: token } } : {}),
    });

  it('needs a founder session', async () => {
    expect((await get(`/api/v1/os/cards/${slugs['published'] ?? ''}`, false)).statusCode).toBe(401);
  });

  it('describes the deck and the caption of a published article, without editor notes', async () => {
    const response = await get(`/api/v1/os/cards/${slugs['published'] ?? ''}`);
    expect(response.statusCode).toBe(200);
    const body = response.json<{ slides: { kind: string }[]; caption: string }>();
    expect(body.slides.map((slide) => slide.kind)).toEqual(['cover', 'stat', 'point', 'evidence']);
    expect(body.caption).toContain('https://www.bps.go.id/id/pressrelease/x.html');
    expect(response.body).not.toContain('CATATAN-INTERNAL');
  });

  it('draws each slide as a 1080×1350 PNG', async () => {
    const response = await get(`/api/v1/os/cards/${slugs['published'] ?? ''}/1.png`);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['cache-control']).toBe('private, no-store');
    const png = response.rawPayload;
    expect(png.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    expect(png.readUInt32BE(16)).toBe(1080);
    expect(png.readUInt32BE(20)).toBe(1350);
    expect((await get(`/api/v1/os/cards/${slugs['published'] ?? ''}/4.png`)).statusCode).toBe(200);
  });

  it('has no cards for drafts, unknown slides or odd paths', async () => {
    for (const url of [
      `/api/v1/os/cards/${slugs['draft'] ?? ''}`,
      `/api/v1/os/cards/${slugs['draft'] ?? ''}/1.png`,
      `/api/v1/os/cards/${slugs['published'] ?? ''}/9.png`,
      `/api/v1/os/cards/${slugs['published'] ?? ''}/0.png`,
      `/api/v1/os/cards/${slugs['published'] ?? ''}/1.svg`,
      '/api/v1/os/cards/..%2Fetc',
    ]) {
      expect((await get(url)).statusCode, url).toBe(404);
    }
  });
});
