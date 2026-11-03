// P1-03 editorial state machine + publish gate over HTTP and in the database (PRD v4 §6.2, §7,
// §10.2; T-03, T-04, T-11).
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

describe.skipIf(!databaseAvailable)('editorial workflow', { timeout: 60_000 }, () => {
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

  it('runs draft → in_review → approved → published with events, audit and dates', async () => {
    const id = await createArticle();
    for (const [action, expected] of [
      ['submit', 'in_review'],
      ['approve', 'approved'],
      ['publish', 'published'],
    ] as const) {
      const response = await act(id, action);
      expect(response.statusCode, action).toBe(200);
      expect(parse<{ status: string; verification: string }>(response)).toEqual({
        status: expected,
        verification: 'TERVERIFIKASI',
      });
    }
    const row = await migrator.query<{
      approved_by: string | null;
      published_at: Date | null;
      first_published_at: Date | null;
      approved_ok: boolean;
    }>(
      `SELECT a.approved_by, a.published_at, a.first_published_at,
              a.approved_content_sha256 = r.content_sha256 AND a.approved_revision_id = r.id AS approved_ok
       FROM articles a JOIN article_revisions r ON r.id = a.current_revision_id WHERE a.id = $1`,
      [id],
    );
    expect(row.rows[0]?.approved_ok).toBe(true);
    expect(row.rows[0]?.approved_by).not.toBeNull();
    expect(row.rows[0]?.published_at).not.toBeNull();
    expect(row.rows[0]?.first_published_at).toEqual(row.rows[0]?.published_at);

    const events = await migrator.query<{ action: string; from_status: string; to_status: string }>(
      'SELECT action, from_status, to_status FROM publication_events WHERE article_id = $1 ORDER BY created_at',
      [id],
    );
    expect(events.rows).toEqual([
      { action: 'submit', from_status: 'draft', to_status: 'in_review' },
      { action: 'approve', from_status: 'in_review', to_status: 'approved' },
      { action: 'publish', from_status: 'approved', to_status: 'published' },
    ]);
    const audit = await migrator.query<{ action: string }>(
      `SELECT action FROM audit_events WHERE resource_id = $1 ORDER BY created_at`,
      [id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'article.create',
      'article.submit',
      'article.approve',
      'article.publish',
    ]);
  });

  it('refuses transitions out of order (no publish without approval, T-04)', async () => {
    const id = await createArticle({ title: 'Urutan salah' });
    for (const action of ['approve', 'publish', 'return']) {
      const response = await act(id, action, { note: 'alasan cukup panjang' });
      expect(response.statusCode, action).toBe(409);
      expect(errorOf(response).code).toBe('INVALID_TRANSITION');
    }
    expect(await status(id)).toBe('draft');
    // The client can never set the status through an edit either.
    const sneaky = await post(`PATCH /api/v1/os/articles/${id}`, {
      ...content({ title: 'Urutan salah' }),
      expectedVersion: 1,
      changeNote: 'x',
      status: 'published',
    });
    expect(sneaky.statusCode).toBe(400);
  });

  it('an edit after approval voids it and returns to draft (T-03)', async () => {
    const id = await createArticle({ title: 'Edit setelah approve' });
    await act(id, 'submit');
    await act(id, 'approve');
    const edit = await post(`PATCH /api/v1/os/articles/${id}`, {
      ...content({ title: 'Edit setelah approve (diubah)' }),
      expectedVersion: 1,
      changeNote: 'Ubah judul',
    });
    expect(edit.statusCode).toBe(200);
    expect(parse<{ returnedToDraft: boolean }>(edit).returnedToDraft).toBe(true);
    expect(await status(id)).toBe('draft');
    const row = await migrator.query<{ approved_revision_id: string | null }>(
      'SELECT approved_revision_id FROM articles WHERE id = $1',
      [id],
    );
    expect(row.rows[0]?.approved_revision_id).toBeNull();
    const publish = await post(`/api/v1/os/articles/${id}/publish`, { expectedVersion: 2 });
    expect(errorOf(publish).code).toBe('INVALID_TRANSITION');
  });

  it('publish refuses bytes that differ from the approved ones even if status says approved', async () => {
    const id = await createArticle({ title: 'Hash berbeda' });
    await act(id, 'submit');
    await act(id, 'approve');
    // Simulate a bug or tampering that points the approval at a different hash.
    await migrator.query(
      `UPDATE articles SET approved_content_sha256 = '\\x${'00'.repeat(32)}'::bytea WHERE id = $1`,
      [id],
    );
    const response = await act(id, 'publish');
    expect(response.statusCode).toBe(422);
    expect(errorOf(response).fields).toEqual([
      { path: 'gate', rule: 'revision_changed_after_approval' },
    ]);
    expect(await status(id)).toBe('approved');
  });

  it('the gate blocks no verified source unless a written exception is given', async () => {
    const id = await createArticle({
      title: 'Tanpa sumber',
      bodySource: '## Konteks\n\nOpini founder, TEST fixture.',
      citations: [],
    });
    await act(id, 'submit');
    const blocked = await act(id, 'approve');
    expect(blocked.statusCode).toBe(422);
    expect(errorOf(blocked).fields).toEqual([{ path: 'gate', rule: 'no_verified_source' }]);
    expect((await act(id, 'approve', { sourceException: 'terlalu pendek' })).statusCode).toBe(400);
    const approved = await act(id, 'approve', {
      sourceException: 'Tulisan opini founder; klaim faktual tidak ada.',
    });
    expect(approved.statusCode).toBe(200);
    expect((await act(id, 'publish')).statusCode).toBe(200);
    const row = await migrator.query<{ source_exception: string }>(
      'SELECT source_exception FROM articles WHERE id = $1',
      [id],
    );
    expect(row.rows[0]?.source_exception).toBe('Tulisan opini founder; klaim faktual tidak ada.');
  });

  it('the gate blocks a number whose source is unchecked, even with an exception', async () => {
    const id = await createArticle({
      title: 'Angka belum dicek',
      citations: [citation({ verified: false })],
    });
    await act(id, 'submit');
    const response = await act(id, 'approve', {
      sourceException: 'Alasan panjang yang tidak boleh menolong angka.',
    });
    expect(errorOf(response).fields).toEqual([{ path: 'gate', rule: 'stat_source_unverified' }]);
  });

  it('return needs a reason, voids nothing permanent, and archive works from published', async () => {
    const id = await createArticle({ title: 'Dikembalikan' });
    await act(id, 'submit');
    expect((await act(id, 'return', { note: 'x' })).statusCode).toBe(400);
    expect((await act(id, 'return', { note: 'Tambah konteks harga' })).statusCode).toBe(200);
    expect(await status(id)).toBe('draft');
    const note = await migrator.query<{ note: string }>(
      `SELECT note FROM publication_events WHERE article_id = $1 AND action = 'return'`,
      [id],
    );
    expect(note.rows[0]?.note).toBe('Tambah konteks harga');

    await act(id, 'submit');
    await act(id, 'approve');
    await act(id, 'publish');
    expect((await act(id, 'archive')).statusCode).toBe(200);
    expect(await status(id)).toBe('archived');
    expect((await act(id, 'publish')).statusCode).toBe(409);
  });

  it('refuses a stale expectedVersion on transitions', async () => {
    const id = await createArticle({ title: 'Versi transisi' });
    await post(`PATCH /api/v1/os/articles/${id}`, {
      ...content({ title: 'Versi transisi 2' }),
      expectedVersion: 1,
      changeNote: 'v2',
    });
    expect(errorOf(await act(id, 'submit')).code).toBe('VERSION_CONFLICT');
  });

  it('two concurrent publishes of one approval produce exactly one publish event', async () => {
    const id = await createArticle({ title: 'Publish ganda' });
    await act(id, 'submit');
    await act(id, 'approve');
    const results = await Promise.all([act(id, 'publish'), act(id, 'publish'), act(id, 'publish')]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409, 409]);
    const count = await migrator.query<{ n: string }>(
      `SELECT count(*) AS n FROM publication_events WHERE article_id = $1 AND action = 'publish'`,
      [id],
    );
    expect(count.rows[0]?.n).toBe('1');
  });

  it('publication events are immutable', async () => {
    const app2 = await connect(testDb.appUrl);
    try {
      expect(await sqlState(app2.query(`UPDATE publication_events SET note = 'x'`))).toBe('42501');
      expect(await sqlState(app2.query('DELETE FROM publication_events'))).toBe('42501');
      expect(await sqlState(migrator.query(`UPDATE publication_events SET note = 'x'`))).toBe(
        '42501',
      );
    } finally {
      await app2.end();
    }
  });

  it('shows gate blockers and the event history on the article detail', async () => {
    const id = await createArticle({
      title: 'Detail gate',
      citations: [citation({ verified: false })],
    });
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/os/articles/${id}`,
      headers: { cookie: `${COOKIE}=${token}` },
    });
    const body = parse<{ gate: string[]; events: unknown[] }>(detail);
    expect(body.gate).toEqual(['no_verified_source', 'stat_source_unverified']);
    expect(body.events).toEqual([]);
  });
});
