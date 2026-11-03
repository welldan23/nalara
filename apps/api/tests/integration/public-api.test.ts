// P1-06 public reading API (PRD v4 §10.2: anonymous reads published → 200; draft via slug/API →
// 404 without leaking content; T-01, T-02, S1-02, S1-03).
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
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
const base: AppConfig = {
  logLevel: 'fatal',
  nodeEnv: 'test',
  appOrigin: ORIGIN,
  session: { cookieName: COOKIE, secret: SECRET },
  mfaEncryptionKey: Buffer.alloc(32, 7),
};
const CITE = '01900000-0000-7000-8000-00000000000a';

describe.skipIf(!databaseAvailable)('public reading API', { timeout: 60_000 }, () => {
  let testDb: TestDatabase;
  let database: Database;
  let app: FastifyInstance;
  let closed: FastifyInstance;
  let founderCookie = '';
  const categoryIds: Record<string, string> = {};

  const SECRET_NOTE = 'CATATAN-INTERNAL-RAHASIA';
  const make = async (title: string, category: string, steps: TransitionAction[]) => {
    const bodySource = `## Konteks\n\nIsi ${title}. TEST fixture.`;
    const saved = await createDraft(
      database.db,
      { userId: founderId },
      {
        content: {
          title,
          dek: `Ringkasan ${title}`,
          articleType: 'explainer',
          categoryId: categoryIds[category] ?? '',
          body: parseMarkdown(bodySource).blocks,
          bodySource,
          methodNote: null,
          citations: [
            {
              id: CITE,
              url: 'https://www.bps.go.id/id/pressrelease/x.html',
              publisher: 'Badan Pusat Statistik',
              title: 'Rilis',
              accessedAt: '2026-11-03',
              claimNote: SECRET_NOTE,
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
  let founderId = '';
  const slugs: Record<string, string> = {};

  beforeAll(async () => {
    testDb = await createTestDatabase();
    const migrator = await connect(testDb.migratorUrl);
    await migrate(migrator, MIGRATIONS_DIR);
    const user = await migrator.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, role, mfa_enabled, totp_secret_enc)
       VALUES ('founder@example.invalid', 'x', 'founder', true, '\\x00') RETURNING id`,
    );
    founderId = user.rows[0]?.id ?? '';
    for (const row of (
      await migrator.query<{ id: string; slug: string }>('SELECT id, slug FROM categories')
    ).rows) {
      categoryIds[row.slug] = row.id;
    }
    await migrator.end();
    database = createDatabase(testDb.appUrl, { max: 5 });

    slugs['draft'] = await make('Masih draft', 'ekonomi', []);
    slugs['review'] = await make('Sedang ditinjau', 'ekonomi', ['submit']);
    slugs['approved'] = await make('Disetujui belum terbit', 'ekonomi', ['submit', 'approve']);
    slugs['archived'] = await make('Sudah diarsip', 'ekonomi', [
      'submit',
      'approve',
      'publish',
      'archive',
    ]);
    slugs['first'] = await make('Terbit pertama', 'ekonomi', ['submit', 'approve', 'publish']);
    slugs['second'] = await make('Terbit kedua', 'teknologi', ['submit', 'approve', 'publish']);
    slugs['third'] = await make('Terbit ketiga', 'ekonomi', ['submit', 'approve', 'publish']);

    const session = await createSession(database.db, founderId);
    founderCookie = `${COOKIE}=${session.token}`;
    app = await buildApp(
      { ...base, publicSiteEnabled: true },
      { readiness: () => Promise.resolve(true), database: database.db },
    );
    closed = await buildApp(
      { ...base, publicSiteEnabled: false },
      { readiness: () => Promise.resolve(true), database: database.db },
    );
    await Promise.all([app.ready(), closed.ready()]);
  });

  afterAll(async () => {
    await Promise.all([app.close(), closed.close()]);
    await database.close();
    await testDb.drop();
  });

  const get = (url: string, target = app, cookie?: string) =>
    target.inject({ method: 'GET', url, headers: cookie === undefined ? {} : { cookie } });
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed JSON helper for tests
  const parse = <T>(response: LightMyRequestResponse): T => response.json();
  const withoutRequestId = (response: LightMyRequestResponse) =>
    Object.fromEntries(
      Object.entries(parse<{ error: Record<string, unknown> }>(response).error).filter(
        ([key]) => key !== 'requestId',
      ),
    );

  it('lists only published articles, newest first, with no editor-only fields (T-01)', async () => {
    const response = await get('/api/v1/public/articles');
    expect(response.statusCode).toBe(200);
    const body = parse<{ articles: { slug: string }[]; nextCursor: string | null }>(response);
    expect(body.articles.map((article) => article.slug)).toEqual([
      slugs['third'],
      slugs['second'],
      slugs['first'],
    ]);
    expect(body.nextCursor).toBeNull();
    const raw = response.body;
    for (const leak of [
      SECRET_NOTE,
      'Masih draft',
      'Sedang ditinjau',
      'Disetujui belum terbit',
      'Sudah diarsip',
      founderId,
      'bodySource',
      'contentSha256',
      'approvedBy',
      'createdBy',
      'founder@example.invalid',
    ]) {
      expect(raw, leak).not.toContain(leak);
    }
  });

  it('filters by topic and pages with an opaque cursor', async () => {
    const ekonomi = parse<{ articles: { slug: string }[] }>(
      await get('/api/v1/public/articles?category=ekonomi'),
    );
    expect(ekonomi.articles.map((article) => article.slug)).toEqual([
      slugs['third'],
      slugs['first'],
    ]);

    const first = parse<{ articles: { slug: string }[]; nextCursor: string }>(
      await get('/api/v1/public/articles?limit=2'),
    );
    expect(first.articles).toHaveLength(2);
    const second = parse<{ articles: { slug: string }[]; nextCursor: string | null }>(
      await get(`/api/v1/public/articles?limit=2&cursor=${first.nextCursor}`),
    );
    expect(second.articles.map((article) => article.slug)).toEqual([slugs['first']]);
    expect(second.nextCursor).toBeNull();

    for (const bad of ['not-a-cursor', Buffer.from('{"p":"x","i":"y"}').toString('base64url')]) {
      expect((await get(`/api/v1/public/articles?cursor=${bad}`)).statusCode).toBe(400);
    }
    expect((await get('/api/v1/public/articles?limit=1000')).statusCode).toBe(400);
    expect((await get("/api/v1/public/articles?category=Bad'Slug")).statusCode).toBe(400);
  });

  it('serves a published article with its sources but without editor notes', async () => {
    const response = await get(`/api/v1/public/articles/${slugs['first'] ?? ''}`);
    expect(response.statusCode).toBe(200);
    const { article } = parse<{
      article: {
        title: string;
        verification: string;
        category: { slug: string };
        citations: Record<string, unknown>[];
        body: unknown[];
      };
    }>(response);
    expect(article).toMatchObject({
      title: 'Terbit pertama',
      verification: 'TERVERIFIKASI',
      category: { slug: 'ekonomi' },
    });
    expect(Object.keys(article.citations[0] ?? {}).sort()).toEqual([
      'accessedAt',
      'id',
      'primary',
      'publisher',
      'title',
      'url',
    ]);
    expect(response.body).not.toContain(SECRET_NOTE);
  });

  it('answers every non-published slug exactly like an unknown one (T-02, S1-03)', async () => {
    const unknown = await get('/api/v1/public/articles/tidak-ada-artikel-ini');
    expect(unknown.statusCode).toBe(404);
    for (const key of ['draft', 'review', 'approved', 'archived']) {
      const response = await get(`/api/v1/public/articles/${slugs[key] ?? ''}`);
      expect(response.statusCode, key).toBe(404);
      expect(withoutRequestId(response), key).toEqual(withoutRequestId(unknown));
      // A founder session changes nothing on the public API: it never reads cookies.
      const signedIn = await get(`/api/v1/public/articles/${slugs[key] ?? ''}`, app, founderCookie);
      expect(signedIn.statusCode, `${key} with session`).toBe(404);
    }
    for (const weird of ['..%2Fos', '%3Cscript%3E']) {
      expect((await get(`/api/v1/public/articles/${weird}`)).statusCode).toBe(404);
    }
    // Over-long path parameters are refused by Fastify before routing (414): no content either.
    const long = await get(`/api/v1/public/articles/${'a'.repeat(200)}`);
    expect([404, 414]).toContain(long.statusCode);
  });

  it('keeps everything off the public API while the launch flag is off (ADR-015)', async () => {
    for (const url of [
      '/api/v1/public/categories',
      '/api/v1/public/articles',
      `/api/v1/public/articles/${slugs['first'] ?? ''}`,
    ]) {
      const response = await get(url, closed);
      expect(response.statusCode, url).toBe(404);
      expect(response.body).not.toContain('Terbit pertama');
    }
  });

  it('lists the topics', async () => {
    const { categories } = parse<{ categories: { slug: string }[] }>(
      await get('/api/v1/public/categories'),
    );
    expect(categories.map((category) => category.slug).sort()).toEqual([
      'ekonomi',
      'kebijakan',
      'teknologi',
    ]);
  });
});
