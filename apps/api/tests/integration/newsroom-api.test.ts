// P1-02 newsroom API over HTTP: auth, CSRF, policy, validation, versions (PRD v4 §10.1).
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
import type { AppConfig } from '../../src/app.ts';
import { createDatabase } from '../../src/db/client.ts';
import type { Database } from '../../src/db/client.ts';
import { migrate } from '../../src/db/migrate.ts';
import { MIGRATIONS_DIR } from '../../src/db/migrations-dir.ts';
import { csrfTokenFor } from '../../src/modules/auth/csrf.ts';
import { createSession } from '../../src/modules/auth/session.ts';
import { EDITOR_BODY_LIMIT_BYTES } from '../../src/routes/articles.ts';
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

describe.skipIf(!databaseAvailable)('newsroom API', { timeout: 60_000 }, () => {
  let testDb: TestDatabase;
  let database: Database;
  let app: FastifyInstance;
  let token = '';
  let csrf = '';
  let categoryId = '';

  beforeAll(async () => {
    testDb = await createTestDatabase();
    const migrator = await connect(testDb.migratorUrl);
    await migrate(migrator, MIGRATIONS_DIR);
    const user = await migrator.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, role, mfa_enabled, totp_secret_enc)
       VALUES ('founder@example.invalid', 'x', 'founder', true, '\\x00') RETURNING id`,
    );
    await migrator.end();
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
    await testDb.drop();
  });

  const send = (
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    payload?: unknown,
    options: { cookie?: boolean; csrf?: string | null; origin?: string } = {},
  ) =>
    app.inject({
      method,
      url,
      ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
      headers: {
        origin: options.origin ?? ORIGIN,
        ...((options.cookie ?? true) ? { cookie: `${COOKIE}=${token}` } : {}),
        ...(options.csrf === null ? {} : { 'x-csrf-token': options.csrf ?? csrf }),
      },
    });
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed JSON helper for tests
  const parse = <T>(response: LightMyRequestResponse): T => response.json();
  const draft = (overrides: Record<string, unknown> = {}) => ({
    title: 'Kenapa Harga Beras Naik',
    dek: 'Ringkasan satu kalimat.',
    articleType: 'explainer',
    categoryId,
    methodNote: null,
    bodySource: '## Apa yang terjadi\n\nTEST fixture, bukan artikel nyata.',
    ...overrides,
  });

  it('lists the topics for the editor', async () => {
    const response = await send('GET', '/api/v1/os/categories');
    expect(response.statusCode).toBe(200);
    const { categories } = parse<{ categories: { id: string; slug: string }[] }>(response);
    expect(categories.map((category) => category.slug).sort()).toEqual([
      'ekonomi',
      'kebijakan',
      'teknologi',
    ]);
    categoryId = categories.find((category) => category.slug === 'ekonomi')?.id ?? '';
  });

  it('denies every newsroom route to anonymous callers (T-02)', async () => {
    for (const [method, url] of [
      ['GET', '/api/v1/os/categories'],
      ['GET', '/api/v1/os/articles'],
      ['GET', '/api/v1/os/articles/01900000-0000-7000-8000-000000000000'],
      ['POST', '/api/v1/os/articles'],
      ['PATCH', '/api/v1/os/articles/01900000-0000-7000-8000-000000000000'],
      ['POST', '/api/v1/os/articles/preview'],
    ] as const) {
      const response = await send(method, url, method === 'GET' ? undefined : draft(), {
        cookie: false,
      });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('requires a CSRF token and same-origin for every mutation', async () => {
    expect((await send('POST', '/api/v1/os/articles', draft(), { csrf: null })).statusCode).toBe(
      403,
    );
    expect(
      (await send('POST', '/api/v1/os/articles', draft(), { csrf: 'x'.repeat(43) })).statusCode,
    ).toBe(403);
    expect(
      (await send('POST', '/api/v1/os/articles', draft(), { origin: 'https://evil.example' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await send('POST', '/api/v1/os/articles/preview', { bodySource: 'x' }, { csrf: null }))
        .statusCode,
    ).toBe(403);
  });

  it('creates, reads, revises and lists a draft', async () => {
    const created = await send('POST', '/api/v1/os/articles', draft());
    expect(created.statusCode).toBe(201);
    const { articleId, version, slug, warnings } = parse<{
      articleId: string;
      version: number;
      slug: string;
      warnings: unknown[];
    }>(created);
    expect([version, slug, warnings]).toEqual([1, 'kenapa-harga-beras-naik', []]);

    const updated = await send('PATCH', `/api/v1/os/articles/${articleId}`, {
      ...draft({ title: 'Kenapa Harga Beras Naik di 2026' }),
      expectedVersion: 1,
      changeNote: 'Perjelas judul',
    });
    expect(updated.statusCode).toBe(200);
    expect(parse<{ version: number }>(updated).version).toBe(2);

    const read = await send('GET', `/api/v1/os/articles/${articleId}`);
    const body = parse<{
      article: { current: { title: string; body: unknown[] }; currentVersion: number };
      revisions: { version: number; changeNote: string }[];
    }>(read);
    expect(body.article.currentVersion).toBe(2);
    expect(body.article.current.body).toEqual([
      { type: 'heading', level: 2, content: [{ type: 'text', text: 'Apa yang terjadi' }] },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'TEST fixture, bukan artikel nyata.' }],
      },
    ]);
    expect(body.revisions.map((revision) => [revision.version, revision.changeNote])).toEqual([
      [1, 'Draft pertama'],
      [2, 'Perjelas judul'],
    ]);

    const list = await send('GET', '/api/v1/os/articles?status=draft');
    const { articles } = parse<{ articles: { id: string; title: string }[] }>(list);
    expect(articles[0]).toMatchObject({ id: articleId, title: 'Kenapa Harga Beras Naik di 2026' });
  });

  it('answers 409 to a stale editor and 404 to unknown or malformed ids', async () => {
    const { articleId } = parse<{ articleId: string }>(
      await send('POST', '/api/v1/os/articles', draft({ title: 'Konflik versi' })),
    );
    const edit = (title: string) =>
      send('PATCH', `/api/v1/os/articles/${articleId}`, {
        ...draft({ title }),
        expectedVersion: 1,
        changeNote: 'edit',
      });
    expect((await edit('Konflik versi A')).statusCode).toBe(200);
    const stale = await edit('Konflik versi B');
    expect(stale.statusCode).toBe(409);
    expect(parse<{ error: { code: string } }>(stale).error.code).toBe('VERSION_CONFLICT');

    for (const id of ['01900000-0000-7000-8000-000000000000', 'not-a-uuid', "1' OR '1'='1"]) {
      expect((await send('GET', `/api/v1/os/articles/${encodeURIComponent(id)}`)).statusCode).toBe(
        404,
      );
    }
  });

  it('refuses markup in the body with line numbers, and never stores HTML (T-05)', async () => {
    const response = await send(
      'POST',
      '/api/v1/os/articles',
      draft({ bodySource: 'Paragraf.\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))' }),
    );
    expect(response.statusCode).toBe(400);
    expect(parse<{ error: { fields: unknown[] } }>(response).error.fields).toEqual([
      { path: 'bodySource.line.3', rule: 'html_not_supported' },
      { path: 'bodySource.line.5', rule: 'link_must_be_https' },
    ]);

    // A title is plain text: stored as-is and rendered escaped by React, never parsed.
    const title = '<img src=x onerror=alert(1)>';
    const created = await send('POST', '/api/v1/os/articles', draft({ title }));
    expect(created.statusCode).toBe(201);
    const { articleId } = parse<{ articleId: string }>(created);
    const read = parse<{ article: { current: { title: string } } }>(
      await send('GET', `/api/v1/os/articles/${articleId}`),
    );
    expect(read.article.current.title).toBe(title);
  });

  it('rejects unknown fields and a client-chosen status', async () => {
    const response = await send('POST', '/api/v1/os/articles', { ...draft(), status: 'published' });
    expect(response.statusCode).toBe(400);
  });

  it('previews exactly the blocks a save would store, plus style warnings', async () => {
    const response = await send('POST', '/api/v1/os/articles/preview', {
      title: 'HARGA NAIK LAGI!!',
      bodySource: '## Konteks\n\nTernyata **naik**.\n\n<b>x</b>',
    });
    expect(response.statusCode).toBe(200);
    const preview = parse<{
      blocks: { type: string }[];
      issues: unknown[];
      warnings: { code: string }[];
    }>(response);
    expect(preview.blocks.map((block) => block.type)).toEqual(['heading', 'paragraph']);
    expect(preview.issues).toEqual([{ line: 5, rule: 'html_not_supported' }]);
    expect(preview.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(['title_all_caps', 'title_excess_punctuation', 'cliche']),
    );
  });

  it('accepts drafts above the global 16 KiB limit but caps them at the editor limit', async () => {
    const paragraph = 'Kalimat panjang untuk menguji batas ukuran draft. '.repeat(20);
    const big = Array.from({ length: 40 }, () => paragraph).join('\n\n');
    expect(Buffer.byteLength(big)).toBeGreaterThan(16 * 1024);
    expect((await send('POST', '/api/v1/os/articles', draft({ bodySource: big }))).statusCode).toBe(
      201,
    );

    const huge = 'x'.repeat(EDITOR_BODY_LIMIT_BYTES + 1024);
    expect(
      (await send('POST', '/api/v1/os/articles', draft({ bodySource: huge }))).statusCode,
    ).toBe(413);
  });
});
