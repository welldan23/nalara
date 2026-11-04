// P2-05 retry + quarantine: a feed that keeps failing is quarantined after QUARANTINE_AFTER
// failures (an internal address at once) without affecting other feeds; the founder releases it,
// and it must pass a check again before ingestion resumes.
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
  QUARANTINE_AFTER,
  afterFailure,
  feedFetchHandler,
  scheduleDueFeeds,
} from '../../src/worker/handlers/feed-fetch.ts';
import { claim, finish } from '../../src/worker/queue.ts';
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

const ITEM = (n: number, extra = '') =>
  `<item><title>Rilis ${String(n)}</title><link>https://www.bps.go.id/id/brs/${String(n)}${extra}</link>` +
  `<description><![CDATA[<p>Ringkasan <script>x()</script>${String(n)}</p>]]></description></item>`;

describe.skipIf(!databaseAvailable)('feed quarantine', { timeout: 60_000 }, () => {
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
      if (failNext || (req.url ?? '').includes('broken')) {
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

  const state = async (id: string) =>
    (
      await migrator.query<{
        feed_status: string;
        consecutive_failures: number;
        quarantined: boolean;
        next_fetch_at: Date | null;
        feed_error: string | null;
      }>(
        'SELECT feed_status, consecutive_failures, feed_quarantined_at IS NOT NULL AS quarantined, next_fetch_at, feed_error FROM sources WHERE id = $1',
        [id],
      )
    ).rows[0];
  const brokenSource = async () => {
    const id = await source();
    await checked(id); // passes: the server only fails for "broken" URLs
    await migrator.query(
      `UPDATE sources SET feed_url = replace(feed_url, '/rss?', '/broken?') WHERE id = $1`,
      [id],
    );
    return id;
  };

  it('decides retry or quarantine from the failure count and the kind of error', () => {
    expect(afterFailure(1, 'http:server_error')).toBe('retry');
    expect(afterFailure(QUARANTINE_AFTER - 1, 'fetch:timeout')).toBe('retry');
    expect(afterFailure(QUARANTINE_AFTER, 'fetch:timeout')).toBe('quarantine');
    expect(afterFailure(1, 'fetch:address')).toBe('quarantine');
    expect(afterFailure(1, 'fetch:scheme')).toBe('quarantine');
  });

  it('quarantines a feed after repeated failures without stopping the others', async () => {
    body = `<rss><channel><title>BPS</title>${ITEM(1)}</channel></rss>`;
    const broken = await brokenSource();
    const healthy = await source();
    await checked(healthy);
    for (let round = 1; round <= QUARANTINE_AFTER; round += 1) {
      await makeDue(broken);
      await makeDue(healthy);
      const outcomes = await fetchDue();
      // Both feeds are fetched every round: one failing never blocks the other.
      expect(outcomes, `round ${String(round)}`).toHaveLength(2);
      expect(outcomes).toContainEqual({ ok: true });
    }
    expect(await state(broken)).toMatchObject({
      feed_status: 'quarantined',
      consecutive_failures: QUARANTINE_AFTER,
      quarantined: true,
      next_fetch_at: null,
      feed_error: 'http:server_error',
    });
    expect(await state(healthy)).toMatchObject({ feed_status: 'ok', consecutive_failures: 0 });
    // Quarantined: never scheduled again, even when "due".
    await migrator
      .query('UPDATE sources SET next_fetch_at = now() WHERE id = $1', [broken])
      .catch(() => undefined);
    const before = requests;
    await makeDue(healthy);
    expect(await fetchDue()).toEqual([{ ok: true }]);
    expect(requests).toBe(before + 1);
  });

  it('quarantines at once when a feed points at an internal address', async () => {
    const id = await source();
    await checked(id);
    await makeDue(id);
    await scheduleDueFeeds(workerDb.db);
    const job = await claim(workerDb.db, 'w', 60, ['feed_fetch']);
    // The production address policy refuses 127.0.0.1.
    const outcome = await feedFetchHandler(workerDb.db, {
      ports: { 'http:': [port], 'https:': [443] },
    })(job ?? (null as never), { signal });
    await finish(workerDb.db, job ?? (null as never), 'w', outcome);
    expect(outcome).toEqual({ ok: false, error: 'fetch:address' });
    expect(await state(id)).toMatchObject({
      feed_status: 'quarantined',
      consecutive_failures: 1,
      quarantined: true,
    });
  });

  it('lets the founder release a quarantined feed; it must pass a check before ingestion resumes', async () => {
    body = `<rss><channel><title>BPS</title>${ITEM(7)}</channel></rss>`;
    const id = await brokenSource();
    for (let round = 0; round < QUARANTINE_AFTER; round += 1) {
      await makeDue(id);
      await fetchDue();
    }
    expect((await state(id))?.feed_status).toBe('quarantined');
    const refused = await send('POST', `/api/v1/os/sources/${id}/check-feed`);
    expect(refused.statusCode).toBe(400);
    expect(refused.json<{ error: { fields: unknown[] } }>().error.fields).toEqual([
      { path: 'feedStatus', rule: 'quarantined' },
    ]);
    // The founder fixes the URL (simulated here), then releases.
    await migrator.query(
      `UPDATE sources SET feed_url = replace(feed_url, '/broken?', '/rss?') WHERE id = $1`,
      [id],
    );
    const released = await send('POST', `/api/v1/os/sources/${id}/release-feed`);
    expect(released.statusCode, released.body).toBe(202);
    expect(await state(id)).toMatchObject({
      feed_status: 'unchecked',
      consecutive_failures: 0,
      quarantined: false,
      next_fetch_at: null,
    });
    // Unchecked: not scheduled until the queued check passes.
    expect(await fetchDue()).toEqual([]);
    const job = await claim(workerDb.db, 'w', 60, ['feed_check']);
    expect(job?.subjectId).toBe(id);
    const outcome = await feedCheckHandler(workerDb.db, options())(job ?? (null as never), {
      signal,
    });
    await finish(workerDb.db, job ?? (null as never), 'w', outcome);
    expect(await fetchDue()).toEqual([{ ok: true }]);
    const audit = await migrator.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM audit_events WHERE action = 'source.release_feed' AND resource_id = $1`,
      [id],
    );
    expect(audit.rows[0]?.metadata).toEqual({ check_queued: true });
    const again = await send('POST', `/api/v1/os/sources/${id}/release-feed`);
    expect(again.json<{ error: { fields: unknown[] } }>().error.fields).toEqual([
      { path: 'feedStatus', rule: 'not_quarantined' },
    ]);
  });
});
