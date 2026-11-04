// P2-04 ingestion: the scheduler queues only due, fetchable feeds; feed_fetch stores new items once
// (dedup by canonical URL), honours ETag (304), backs off on failure, and the inbox state stays the
// founder's (the worker cannot change it).
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
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
import { onlyAddresses } from '../../src/modules/fetch/address-policy.ts';
import { feedCheckHandler } from '../../src/worker/handlers/feed-check.ts';
import {
  feedFetchHandler,
  scheduleDueFeeds,
  titleFingerprint,
} from '../../src/worker/handlers/feed-fetch.ts';
import { claim, finish } from '../../src/worker/queue.ts';
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

const ITEM = (n: number, extra = '') =>
  `<item><title>Rilis ${String(n)}</title><link>https://www.bps.go.id/id/brs/${String(n)}${extra}</link>` +
  `<description><![CDATA[<p>Ringkasan <script>x()</script>${String(n)}</p>]]></description></item>`;

describe.skipIf(!databaseAvailable)('ingestion', { timeout: 60_000 }, () => {
  let testDb: TestDatabase;
  let database: Database;
  let workerDb: Database;
  let migrator: pg.Client;
  let app: FastifyInstance;
  let feedServer: Server;
  let port = 0;
  let requests = 0;
  let body = '';
  let failNext = false;
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
    workerDb = createDatabase(testDb.workerUrl, { max: 2 });
    const session = await createSession(database.db, user.rows[0]?.id ?? '');
    token = session.token;
    csrf = csrfTokenFor(SECRET, session.sessionId);
    app = await buildApp(config, { readiness: () => Promise.resolve(true), database: database.db });
    await app.ready();
    feedServer = createServer((req, res) => {
      requests += 1;
      if (failNext) {
        failNext = false;
        res.writeHead(503);
        res.end();
        return;
      }
      // A real-world ETag: same body, same tag → 304.
      const etag = `"${String(body.length)}"`;
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { etag });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/rss+xml', etag });
      res.end(body);
    });
    await new Promise<void>((resolve) => feedServer.listen(0, '127.0.0.1', resolve));
    port = (feedServer.address() as AddressInfo).port;
  });

  afterAll(async () => {
    feedServer.closeAllConnections();
    await new Promise((resolve) => feedServer.close(resolve));
    await app.close();
    await Promise.all([database.close(), workerDb.close()]);
    await migrator.end();
    await testDb.drop();
  });

  const send = (method: 'POST' | 'PATCH' | 'GET', url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
      headers: { origin: ORIGIN, cookie: `${COOKIE}=${token}`, 'x-csrf-token': csrf },
    });
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed JSON helper for tests
  const parse = <T>(response: LightMyRequestResponse): T => response.json();
  const signal = new AbortController().signal;
  const options = () => ({
    policy: onlyAddresses(['127.0.0.1']),
    ports: { 'http:': [port], 'https:': [443] },
    timeoutMs: 3_000,
  });
  let counter = 0;
  const source = async (overrides: Record<string, unknown> = {}) => {
    counter += 1;
    const response = await send('POST', '/api/v1/os/sources', {
      name: `Sumber ${String(counter)}`,
      organization: 'Badan Pusat Statistik',
      type: 'statistics',
      officialUrl: `https://www.bps.go.id/id/${String(counter)}`,
      licenseStatus: 'open',
      status: 'verified',
      feedUrl: `http://127.0.0.1:${String(port)}/rss?n=${String(counter)}`,
      ...overrides,
    });
    expect(response.statusCode, response.body).toBe(201);
    return parse<{ source: { id: string } }>(response).source.id;
  };
  const checked = async (id: string) => {
    await send('POST', `/api/v1/os/sources/${id}/check-feed`);
    const job = await claim(workerDb.db, 'w', 60, ['feed_check']);
    const outcome = await feedCheckHandler(workerDb.db, options())(job ?? (null as never), {
      signal,
    });
    await finish(workerDb.db, job ?? (null as never), 'w', outcome);
  };
  const fetchDue = async () => {
    await scheduleDueFeeds(workerDb.db);
    const outcomes = [];
    for (;;) {
      const job = await claim(workerDb.db, 'w', 60, ['feed_fetch']);
      if (job === null) break;
      const outcome = await feedFetchHandler(workerDb.db, options())(job, { signal });
      // Close the job like the runner does, or the queue keeps it active.
      await finish(workerDb.db, job, 'w', outcome);
      outcomes.push(outcome);
    }
    return outcomes;
  };
  const makeDue = (id: string) =>
    migrator.query('UPDATE sources SET next_fetch_at = now() WHERE id = $1', [id]);
  const items = async (id: string) =>
    (
      await migrator.query<{ canonical_url: string; summary: string; status: string }>(
        'SELECT canonical_url, summary, status FROM discovered_items WHERE source_id = $1 ORDER BY canonical_url',
        [id],
      )
    ).rows;
  const runs = async (id: string) =>
    (
      await migrator.query<{
        http_status: number | null;
        not_modified: boolean;
        items_seen: number;
        items_new: number;
        error: string | null;
      }>(
        'SELECT http_status, not_modified, items_seen, items_new, error FROM ingestion_runs WHERE source_id = $1 ORDER BY started_at',
        [id],
      )
    ).rows;

  it('stores new items once, honours ETag, and catches the same story behind tracking links', async () => {
    body = `<rss><channel><title>BPS</title>${ITEM(1)}${ITEM(2)}</channel></rss>`;
    const id = await source();
    await checked(id);
    expect(await fetchDue()).toEqual([{ ok: true }]);
    expect((await items(id)).map((row) => row.canonical_url)).toEqual([
      'https://www.bps.go.id/id/brs/1',
      'https://www.bps.go.id/id/brs/2',
    ]);
    expect((await items(id))[0]).toMatchObject({ summary: 'Ringkasan 1', status: 'new' });

    // Not due yet: nothing is fetched.
    const before = requests;
    expect(await fetchDue()).toEqual([]);
    expect(requests).toBe(before);

    // Due again, unchanged feed: one 304, no parsing, no items.
    await makeDue(id);
    expect(await fetchDue()).toEqual([{ ok: true }]);
    // Changed feed: an old item behind a tracking link, and one new item.
    body = `<rss><channel><title>BPS</title>${ITEM(1, '?utm_source=rss#x')}${ITEM(2)}${ITEM(3)}</channel></rss>`;
    await makeDue(id);
    await fetchDue();
    expect((await items(id)).map((row) => row.canonical_url)).toHaveLength(3);
    expect(await runs(id)).toEqual([
      { http_status: 200, not_modified: false, items_seen: 2, items_new: 2, error: null },
      { http_status: 304, not_modified: true, items_seen: 0, items_new: 0, error: null },
      { http_status: 200, not_modified: false, items_seen: 3, items_new: 1, error: null },
    ]);
  });

  it('backs off after a failure and recovers', async () => {
    body = `<rss><channel><title>BPS</title>${ITEM(10)}</channel></rss>`;
    const id = await source();
    await checked(id);
    failNext = true;
    expect(await fetchDue()).toEqual([{ ok: false, error: 'http:server_error' }]);
    const failed = (
      await migrator.query<{ feed_status: string; consecutive_failures: number; later: boolean }>(
        `SELECT feed_status, consecutive_failures, next_fetch_at > now() + interval '5 minutes' AS later FROM sources WHERE id = $1`,
        [id],
      )
    ).rows[0];
    expect(failed).toEqual({ feed_status: 'failing', consecutive_failures: 1, later: true });
    await makeDue(id);
    expect(await fetchDue()).toEqual([{ ok: true }]);
    const recovered = (
      await migrator.query<{ feed_status: string; consecutive_failures: number }>(
        'SELECT feed_status, consecutive_failures FROM sources WHERE id = $1',
        [id],
      )
    ).rows[0];
    expect(recovered).toEqual({ feed_status: 'ok', consecutive_failures: 0 });
  });

  it('never schedules or fetches unchecked, quarantined, paused or unverified feeds', async () => {
    const unchecked = await source();
    const quarantined = await source();
    await checked(quarantined);
    await migrator.query(
      `UPDATE sources SET feed_status = 'quarantined', feed_quarantined_at = now() WHERE id = $1`,
      [quarantined],
    );
    const paused = await source();
    await checked(paused);
    await migrator.query(`UPDATE sources SET status = 'paused' WHERE id = $1`, [paused]);
    for (const id of [unchecked, quarantined, paused]) await makeDue(id);
    const before = requests;
    expect(await fetchDue()).toEqual([]);
    expect(requests).toBe(before);
    // A job queued while fetchable, then paused before it ran: no request.
    const late = await source();
    await checked(late);
    await scheduleDueFeeds(workerDb.db);
    await migrator.query(`UPDATE sources SET status = 'paused' WHERE id = $1`, [late]);
    const job = await claim(workerDb.db, 'w', 60, ['feed_fetch']);
    expect(
      await feedFetchHandler(workerDb.db, options())(job ?? (null as never), { signal }),
    ).toEqual({
      ok: false,
      error: 'source:not_fetchable',
    });
    expect(requests).toBe(before + 1); // only the feed_check above
  });

  it("keeps the inbox state the founder's: the worker cannot change it; nothing is deleted", async () => {
    const worker = await connect(testDb.workerUrl);
    const appClient = await connect(testDb.appUrl);
    try {
      expect(await sqlState(worker.query(`UPDATE discovered_items SET status = 'used'`))).toBe(
        '42501',
      );
      expect(await sqlState(worker.query('DELETE FROM discovered_items'))).toBe('42501');
      expect(await sqlState(appClient.query(`UPDATE discovered_items SET title = 'x'`))).toBe(
        '42501',
      );
      await appClient.query(
        `UPDATE discovered_items SET status = 'seen', status_changed_at = now()`,
      );
      expect(await sqlState(migrator.query('DELETE FROM discovered_items'))).toBe('42501');
      expect(await sqlState(migrator.query('UPDATE ingestion_runs SET items_new = 0'))).toBe(
        '42501',
      );
    } finally {
      await worker.end();
      await appClient.end();
    }
  });

  it('fingerprints the same story across sources', () => {
    expect(titleFingerprint('Inflasi Oktober 2026: 2,8%!')).toEqual(
      titleFingerprint('  inflasi   oktober 2026 — 2 8 '),
    );
    expect(titleFingerprint('Inflasi Oktober')).not.toEqual(titleFingerprint('Inflasi November'));
  });
});
