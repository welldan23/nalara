// P1-07 corrections of published articles (PRD v4 §7, §10.1 P1-07; AC-MEDIA-05).
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

const CITE = '01900000-0000-7000-8000-00000000000a';
const citation = (overrides: Record<string, unknown> = {}) => ({
  id: CITE,
  url: 'https://www.bps.go.id/id/pressrelease/2026/11/01/inflasi.html',
  publisher: 'Badan Pusat Statistik',
  title: 'Inflasi Oktober 2026',
  accessedAt: '2026-11-03',
  claimNote: '',
  primary: true,
  verified: true,
  ...overrides,
});
const STAT = [
  '## Data dan angka',
  '',
  ':::angka',
  'nilai: 2,8',
  'satuan: persen (yoy)',
  'periode: Oktober 2026',
  'label: Inflasi tahunan',
  'sumber: 1',
  ':::',
].join('\n');

describe.skipIf(!databaseAvailable)('corrections', { timeout: 60_000 }, () => {
  let testDb: TestDatabase;
  let database: Database;
  let migrator: pg.Client;
  let app: FastifyInstance;
  let token = '';
  let csrf = '';
  let categoryId = '';

  beforeAll(async () => {
    testDb = await createTestDatabase();
    migrator = await connect(testDb.migratorUrl);
    await migrate(migrator, MIGRATIONS_DIR);
    const user = await migrator.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, role, mfa_enabled, totp_secret_enc)
       VALUES ('founder@example.invalid', 'x', 'founder', true, '\\x00') RETURNING id`,
    );
    categoryId =
      (await migrator.query<{ id: string }>(`SELECT id FROM categories WHERE slug = 'ekonomi'`))
        .rows[0]?.id ?? '';
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

  const post = (url: string, payload: unknown) =>
    app.inject({
      method: url.startsWith('PATCH ') ? 'PATCH' : 'POST',
      url: url.replace(/^PATCH /, ''),
      payload: payload as Record<string, unknown>,
      headers: { origin: ORIGIN, cookie: `${COOKIE}=${token}`, 'x-csrf-token': csrf },
    });
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed JSON helper for tests
  const parse = <T>(response: LightMyRequestResponse): T => response.json();
  const content = (overrides: Record<string, unknown> = {}) => ({
    title: 'Inflasi Oktober',
    dek: 'TEST fixture, bukan artikel nyata.',
    articleType: 'explainer',
    categoryId,
    methodNote: null,
    bodySource: STAT,
    citations: [citation()],
    ...overrides,
  });
  const createArticle = async (overrides: Record<string, unknown> = {}) => {
    const response = await post('/api/v1/os/articles', content(overrides));
    expect(response.statusCode).toBe(201);
    return parse<{ articleId: string }>(response).articleId;
  };
  const act = (id: string, action: string, body: Record<string, unknown> = {}) =>
    post(`/api/v1/os/articles/${id}/${action}`, { expectedVersion: 1, ...body });
  const status = async (id: string) =>
    (await migrator.query<{ status: string }>('SELECT status FROM articles WHERE id = $1', [id]))
      .rows[0]?.status;
  const errorOf = (response: LightMyRequestResponse) =>
    parse<{ error: { code: string; fields?: { path: string; rule: string }[] } }>(response).error;

  const publishNew = async (title: string) => {
    const id = await createArticle({ title });
    for (const action of ['submit', 'approve', 'publish']) {
      expect((await act(id, action)).statusCode, action).toBe(200);
    }
    return id;
  };
  const correct = (id: string, overrides: Record<string, unknown> = {}) =>
    post(`/api/v1/os/articles/${id}/correct`, {
      ...content({ title: 'Judul setelah koreksi' }),
      expectedVersion: 1,
      changeNote: 'Koreksi angka',
      description: 'Sebelumnya tertulis 3,1 persen; angka resmi 2,8 persen.',
      substantial: true,
      ...overrides,
    });
  const publicGet = (url: string) => app.inject({ method: 'GET', url });

  it('publishes the corrected revision in one step and keeps the old one', async () => {
    const id = await publishNew('Koreksi substansial');
    const response = await correct(id);
    expect(response.statusCode).toBe(200);
    expect(parse<{ version: number; substantial: boolean }>(response)).toMatchObject({
      version: 2,
      substantial: true,
    });
    expect(await status(id)).toBe('published');
    const revisions = await migrator.query<{ version: number; title: string }>(
      'SELECT version, title FROM article_revisions WHERE article_id = $1 ORDER BY version',
      [id],
    );
    expect(revisions.rows).toEqual([
      { version: 1, title: 'Koreksi substansial' },
      { version: 2, title: 'Judul setelah koreksi' },
    ]);
    const approved = await migrator.query<{ ok: boolean }>(
      `SELECT a.approved_revision_id = a.current_revision_id
              AND a.approved_content_sha256 = r.content_sha256 AS ok
       FROM articles a JOIN article_revisions r ON r.id = a.current_revision_id WHERE a.id = $1`,
      [id],
    );
    expect(approved.rows[0]?.ok).toBe(true);
    const events = await migrator.query<{ action: string }>(
      'SELECT action FROM publication_events WHERE article_id = $1 ORDER BY created_at',
      [id],
    );
    expect(events.rows.map((row) => row.action)).toEqual([
      'submit',
      'approve',
      'publish',
      'correct',
    ]);
  });

  it('shows substantial corrections to readers and keeps minor ones internal', async () => {
    const id = await publishNew('Koreksi publik');
    const slug = (
      await migrator.query<{ slug: string }>('SELECT slug FROM articles WHERE id = $1', [id])
    ).rows[0]?.slug;
    expect(
      (
        await correct(id, {
          title: 'Koreksi publik',
          dek: 'Typo diperbaiki.',
          substantial: false,
          description: 'Perbaikan salah ketik di ringkasan.',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await correct(id, {
          title: 'Koreksi publik',
          expectedVersion: 2,
          description: 'Angka inflasi diperbarui sesuai rilis resmi terbaru.',
        })
      ).statusCode,
    ).toBe(200);

    // Public API needs the launch flag; this suite's app runs with the default (off).
    expect((await publicGet(`/api/v1/public/articles/${slug ?? ''}`)).statusCode).toBe(404);
    const launched = await buildApp(
      { ...config, publicSiteEnabled: true },
      { readiness: () => Promise.resolve(true), database: database.db },
    );
    try {
      const article = (
        await launched.inject({ method: 'GET', url: `/api/v1/public/articles/${slug ?? ''}` })
      ).json<{ article: { corrections: { description: string }[] } }>().article;
      expect(article.corrections.map((c) => c.description)).toEqual([
        'Angka inflasi diperbarui sesuai rilis resmi terbaru.',
      ]);
      const list = (
        await launched.inject({ method: 'GET', url: '/api/v1/public/corrections' })
      ).json<{ corrections: { description: string; article: { slug: string } }[] }>().corrections;
      expect(list.filter((entry) => entry.article.slug === slug).map((e) => e.description)).toEqual(
        ['Angka inflasi diperbarui sesuai rilis resmi terbaru.'],
      );
      expect(JSON.stringify(list)).not.toContain('salah ketik');
    } finally {
      await launched.close();
    }

    const internal = await migrator.query<{ substantial: boolean; visible: boolean }>(
      'SELECT substantial, visible_at IS NOT NULL AS visible FROM corrections WHERE article_id = $1 ORDER BY created_at',
      [id],
    );
    expect(internal.rows).toEqual([
      { substantial: false, visible: false },
      { substantial: true, visible: true },
    ]);
  });

  it('only corrects published articles, with a fresh version and real changes', async () => {
    const draft = await createArticle({ title: 'Masih draft' });
    expect(errorOf(await correct(draft)).code).toBe('INVALID_TRANSITION');

    const id = await publishNew('Syarat koreksi');
    expect((await correct(id, { title: 'Syarat koreksi' })).statusCode).toBe(400);
    expect((await correct(id, { description: 'pendek' })).statusCode).toBe(400);
    expect((await correct(id)).statusCode).toBe(200);
    expect(errorOf(await correct(id, { title: 'Lagi' })).code).toBe('VERSION_CONFLICT');

    await post(`/api/v1/os/articles/${id}/archive`, { expectedVersion: 2 });
    expect(errorOf(await correct(id, { expectedVersion: 2, title: 'Setelah arsip' })).code).toBe(
      'INVALID_TRANSITION',
    );
  });

  it('runs the publish gate on the correction (no unchecked numbers)', async () => {
    const id = await publishNew('Gate koreksi');
    const response = await correct(id, { citations: [citation({ verified: false })] });
    expect(response.statusCode).toBe(422);
    expect(errorOf(response).fields).toEqual([
      { path: 'gate', rule: 'no_verified_source' },
      { path: 'gate', rule: 'stat_source_unverified' },
    ]);
    // Nothing changed: still version 1, still the original content live.
    const row = await migrator.query<{ current_version: number }>(
      'SELECT current_version FROM articles WHERE id = $1',
      [id],
    );
    expect(row.rows[0]?.current_version).toBe(1);
  });

  it('corrections are immutable and listed on the article detail', async () => {
    const id = await publishNew('Detail koreksi');
    await correct(id);
    expect(
      await sqlState(
        migrator.query(`UPDATE corrections SET description = 'x' WHERE article_id = $1`, [id]),
      ),
    ).toBe('42501');
    expect(
      await sqlState(migrator.query(`DELETE FROM corrections WHERE article_id = $1`, [id])),
    ).toBe('42501');
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/os/articles/${id}`,
      headers: { cookie: `${COOKIE}=${token}` },
    });
    expect(parse<{ corrections: { substantial: boolean }[] }>(detail).corrections).toEqual([
      expect.objectContaining({ substantial: true }),
    ]);
  });
});
