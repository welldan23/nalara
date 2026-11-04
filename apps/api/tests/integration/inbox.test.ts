// P2-06 inbox: list and page discovered items, mark them, and start a draft that cites the original
// without copying its text; the citation is left unchecked for the founder.
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

const SUMMARY = 'RINGKASAN-MILIK-PENERBIT-TIDAK-BOLEH-DISALIN';

describe.skipIf(!databaseAvailable)('inbox', { timeout: 60_000 }, () => {
  let testDb: TestDatabase;
  let database: Database;
  let migrator: pg.Client;
  let app: FastifyInstance;
  let token = '';
  let csrf = '';
  let categoryId = '';
  const sourceIds: string[] = [];

  beforeAll(async () => {
    testDb = await createTestDatabase();
    migrator = await connect(testDb.migratorUrl);
    await migrate(migrator, MIGRATIONS_DIR);
    const user = await migrator.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, role, mfa_enabled, totp_secret_enc)
       VALUES ('founder@example.invalid', 'x', 'founder', true, '\\x00') RETURNING id`,
    );
    const userId = user.rows[0]?.id ?? '';
    categoryId =
      (await migrator.query<{ id: string }>(`SELECT id FROM categories WHERE slug = 'ekonomi'`))
        .rows[0]?.id ?? '';
    for (const [name, organization] of [
      ['Berita Resmi Statistik', 'Badan Pusat Statistik'],
      ['Siaran Pers BI', 'Bank Indonesia'],
    ] as const) {
      const row = await migrator.query<{ id: string }>(
        `INSERT INTO sources (name, organization, type, official_url, license_status, status, feed_url, feed_status, created_by)
         VALUES ($1, $2, 'statistics', $3, 'open', 'verified', $4, 'ok', $5) RETURNING id`,
        [
          name,
          organization,
          `https://${name.length.toString()}.example/`,
          `https://${name.length.toString()}.example/rss`,
          userId,
        ],
      );
      sourceIds.push(row.rows[0]?.id ?? '');
    }
    // 52 items from source A; one story also carried by source B (same title fingerprint).
    for (const [index, sourceId] of sourceIds.entries()) {
      const run = await migrator.query<{ id: string }>(
        'INSERT INTO ingestion_runs (source_id, http_status) VALUES ($1, 200) RETURNING id',
        [sourceId],
      );
      const count = index === 0 ? 52 : 1;
      for (let n = 0; n < count; n += 1) {
        const title = n === 0 ? 'Inflasi Oktober 2026' : `Rilis ${String(index)}-${String(n)}`;
        await migrator.query(
          `INSERT INTO discovered_items (source_id, run_id, canonical_url, guid, title, summary, fingerprint, first_seen_at)
           VALUES ($1, $2, $3, $3, $4, $5, sha256(convert_to(lower($4), 'UTF8')), now() - make_interval(secs => $6))`,
          [
            sourceId,
            run.rows[0]?.id,
            `https://s${String(index)}.example/brs/${String(n)}`,
            title,
            SUMMARY,
            n,
          ],
        );
      }
    }
    database = createDatabase(testDb.appUrl, { max: 5 });
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

  const send = (
    method: 'POST' | 'PATCH' | 'GET',
    url: string,
    payload?: unknown,
    withCsrf = true,
  ) =>
    app.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
      headers: {
        origin: ORIGIN,
        cookie: `${COOKIE}=${token}`,
        ...(withCsrf ? { 'x-csrf-token': csrf } : {}),
      },
    });
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed JSON helper for tests
  const parse = <T>(response: LightMyRequestResponse): T => response.json();
  interface Item {
    id: string;
    title: string;
    url: string;
    status: string;
    alsoIn: number;
    source: { name: string };
  }
  interface Page {
    items: Item[];
    nextCursor: string | null;
    newCount: number;
  }
  const page = async (query = '') => parse<Page>(await send('GET', `/api/v1/os/inbox${query}`));

  it('lists new items newest first, pages them, and marks stories carried by other sources', async () => {
    const first = await page();
    expect(first.newCount).toBe(53);
    expect(first.items).toHaveLength(50);
    expect(
      first.items
        .filter((item) => item.title === 'Inflasi Oktober 2026')
        .map((item) => item.alsoIn),
    ).toEqual([1, 1]);
    expect(first.nextCursor).not.toBeNull();
    const second = await page(`?cursor=${first.nextCursor ?? ''}`);
    expect(second.items).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    const ids = new Set([...first.items, ...second.items].map((item) => item.id));
    expect(ids.size).toBe(53);
    const bySource = await page(`?source=${sourceIds[1] ?? ''}`);
    expect(bySource.items.map((item) => item.source.name)).toEqual(['Siaran Pers BI']);
    expect((await send('GET', '/api/v1/os/inbox?cursor=broken')).statusCode).toBe(400);
    expect((await send('GET', '/api/v1/os/inbox?status=everything')).statusCode).toBe(400);
  });

  it('marks items seen or dismissed (audited); "used" is reserved for drafts', async () => {
    const [item] = (await page()).items;
    const id = item?.id ?? '';
    expect(
      (await send('PATCH', `/api/v1/os/inbox/${id}`, { status: 'dismissed' })).statusCode,
    ).toBe(200);
    expect((await page('?status=dismissed')).items.map((entry) => entry.id)).toEqual([id]);
    expect((await send('PATCH', `/api/v1/os/inbox/${id}`, { status: 'used' })).statusCode).toBe(
      400,
    );
    expect(
      (await send('PATCH', '/api/v1/os/inbox/not-a-uuid', { status: 'seen' })).statusCode,
    ).toBe(404);
    expect(
      (
        await send('PATCH', '/api/v1/os/inbox/01900000-0000-7000-8000-0000000000ff', {
          status: 'seen',
        })
      ).statusCode,
    ).toBe(404);
    const audit = await migrator.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM audit_events WHERE action = 'inbox.status' AND resource_id = $1`,
      [id],
    );
    expect(audit.rows[0]?.metadata).toEqual({ status: 'dismissed' });
  });

  it('starts a draft that cites the original, copies none of its text, and leaves the citation unchecked', async () => {
    // The previous test may have dismissed it; a draft can start from a dismissed item too.
    const candidates = [...(await page()).items, ...(await page('?status=dismissed')).items];
    const item = candidates.find((entry) => entry.source.name === 'Siaran Pers BI');
    expect(item).toBeDefined();
    const response = await send('POST', `/api/v1/os/inbox/${item?.id ?? ''}/draft`, { categoryId });
    expect(response.statusCode, response.body).toBe(201);
    const { articleId } = parse<{ articleId: string }>(response);
    const revision = (
      await migrator.query<{
        title: string;
        body_source: string;
        citations: Record<string, unknown>[];
        body: unknown;
      }>(
        `SELECT r.title, r.body_source, r.citations, r.body FROM article_revisions r
         JOIN articles a ON a.current_revision_id = r.id WHERE a.id = $1`,
        [articleId],
      )
    ).rows[0];
    expect(revision?.citations).toEqual([
      expect.objectContaining({
        url: item?.url,
        publisher: 'Bank Indonesia',
        title: 'Inflasi Oktober 2026',
        primary: false,
        verified: false,
      }),
    ]);
    expect(JSON.stringify(revision)).not.toContain(SUMMARY);
    expect((await page('?status=used')).items.map((entry) => entry.id)).toEqual([item?.id]);
    // The citation is unchecked, so the publish gate holds the article until the founder checks.
    const detail = parse<{ gate: string[] }>(await send('GET', `/api/v1/os/articles/${articleId}`));
    expect(detail.gate).toContain('no_verified_source');
    expect(
      (await send('POST', `/api/v1/os/inbox/${item?.id ?? ''}/draft`, { categoryId: 'x' }))
        .statusCode,
    ).toBe(400);
  });

  it('needs a founder session and CSRF', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/os/inbox' })).statusCode).toBe(401);
    const [item] = (await page()).items;
    expect(
      (await send('PATCH', `/api/v1/os/inbox/${item?.id ?? ''}`, { status: 'seen' }, false))
        .statusCode,
    ).toBe(403);
  });
});
