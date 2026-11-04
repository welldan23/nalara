// P2-03b feeds in the Source Registry: feed URL rules, queueing a check (verified sources only),
// the worker's feed_check against a local feed server, the check history, and the worker role's
// column-level limits.
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
import { claim } from '../../src/worker/queue.ts';
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

const RSS = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
<title>BPS — Berita Resmi Statistik</title>
<item><title>Inflasi Oktober 2026</title><link>https://www.bps.go.id/id/brs/1</link></item>
<item><title>Ekspor September 2026</title><link>https://www.bps.go.id/id/brs/2</link></item>
</channel></rss>`;

describe.skipIf(!databaseAvailable)('source feeds', { timeout: 60_000 }, () => {
  let testDb: TestDatabase;
  let database: Database;
  let workerDb: Database;
  let migrator: pg.Client;
  let app: FastifyInstance;
  let feedServer: Server;
  let port = 0;
  let requests = 0;
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
      const path = (req.url ?? '').split('?')[0];
      if (path === '/rss') {
        res.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' });
        res.end(RSS);
      } else if (path === '/doctype') {
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss>&x;</rss>');
      } else if (path === '/html') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html></html>');
      } else {
        res.writeHead(500);
        res.end();
      }
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
  const fields = (response: LightMyRequestResponse) =>
    parse<{ error: { fields?: { path: string; rule: string }[] } }>(response).error.fields ?? [];
  interface Source {
    id: string;
    version: number;
    feedUrl: string | null;
    feedStatus: string;
    feedTitle: string | null;
    feedError: string | null;
  }
  let counter = 0;
  const base = (overrides: Record<string, unknown> = {}) => {
    counter += 1;
    return {
      name: `Sumber ${String(counter)}`,
      organization: 'Badan Pusat Statistik',
      type: 'statistics',
      officialUrl: `https://www.bps.go.id/id/${String(counter)}`,
      licenseStatus: 'open',
      status: 'verified',
      ...overrides,
    };
  };
  const create = async (overrides: Record<string, unknown> = {}) => {
    const response = await send('POST', '/api/v1/os/sources', base(overrides));
    expect(response.statusCode, response.body).toBe(201);
    return parse<{ source: Source }>(response).source;
  };
  // Feed URLs are unique per source: a counter in the query keeps them apart.
  let feeds = 0;
  const feed = (path: string) => {
    feeds += 1;
    return `http://127.0.0.1:${String(port)}${path}?n=${String(feeds)}`;
  };
  // The test world: only 127.0.0.1 on the feed server's port is reachable.
  const handler = () =>
    feedCheckHandler(workerDb.db, {
      policy: onlyAddresses(['127.0.0.1']),
      ports: { 'http:': [port], 'https:': [443] },
      timeoutMs: 3_000,
    });
  const runCheck = async (sourceId: string) => {
    const queued = await send('POST', `/api/v1/os/sources/${sourceId}/check-feed`);
    expect(queued.statusCode, queued.body).toBe(202);
    const job = await claim(workerDb.db, 'test-worker', 60, ['feed_check']);
    expect(job?.subjectId).toBe(sourceId);
    return handler()(job ?? (null as never), { signal: new AbortController().signal });
  };
  const detail = async (id: string) =>
    parse<{
      source: Source;
      checks: { ok: boolean; error: string | null; itemCount: number | null }[];
    }>(await send('GET', `/api/v1/os/sources/${id}`));

  it('stores a feed URL as unchecked, refuses bad ones, and resets state when it changes', async () => {
    const none = await create();
    expect(none).toMatchObject({ feedUrl: null, feedStatus: 'none' });
    const url = feed('/rss');
    const source = await create({ feedUrl: url });
    expect(source).toMatchObject({ feedStatus: 'unchecked' });
    for (const [feedUrl, rule] of [
      ['javascript:alert(1)', 'http_url_required'],
      ['ftp://x.test/feed', 'http_url_required'],
      ['https://u:p@x.test/feed', 'http_url_required'],
    ]) {
      const response = await send('POST', '/api/v1/os/sources', base({ feedUrl }));
      expect(fields(response), feedUrl).toEqual([{ path: 'feedUrl', rule }]);
    }
    expect(
      // Same feed, different letter case in the host: still the same feed.
      fields(
        await send(
          'POST',
          '/api/v1/os/sources',
          base({
            feedUrl: url
              .replace('127.0.0.1', '127.0.0.1')
              .toUpperCase()
              .replace('HTTP://', 'http://'),
          }),
        ),
      ),
    ).toEqual([{ path: 'feedUrl', rule: 'duplicate' }]);
    const cleared = await send('PATCH', `/api/v1/os/sources/${source.id}`, {
      ...base(),
      officialUrl: `https://www.bps.go.id/id/cleared-${source.id}`,
      expectedVersion: 1,
      feedUrl: null,
    });
    expect(parse<{ source: Source }>(cleared).source).toMatchObject({
      feedUrl: null,
      feedStatus: 'none',
    });
  });

  it('checks a good feed: status ok, title stored, history kept, audited', async () => {
    const source = await create({ feedUrl: feed('/rss') });
    expect(await runCheck(source.id)).toEqual({ ok: true });
    const { source: after, checks } = await detail(source.id);
    expect(after).toMatchObject({
      feedStatus: 'ok',
      feedTitle: 'BPS — Berita Resmi Statistik',
      feedError: null,
    });
    expect(checks).toEqual([expect.objectContaining({ ok: true, itemCount: 2, error: null })]);
    const audit = await migrator.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM audit_events WHERE action = 'source.check_feed' AND resource_id = $1`,
      [source.id],
    );
    expect(audit.rows[0]?.metadata).toEqual({ queued: true });
    // A second request while one is queued does not queue twice.
    await send('POST', `/api/v1/os/sources/${source.id}/check-feed`);
    const again = await send('POST', `/api/v1/os/sources/${source.id}/check-feed`);
    expect(parse<{ queued: boolean }>(again)).toEqual({ queued: false });
  });

  it('records failures as codes: XXE feed, HTML page, server error, blocked address', async () => {
    for (const [path, error] of [
      ['/doctype', 'feed:xml_doctype'],
      ['/html', 'fetch:content_type'],
      ['/500', 'http:server_error'],
    ]) {
      const source = await create({ feedUrl: feed(path ?? '') });
      expect(await runCheck(source.id), path).toEqual({ ok: false, error });
      const { source: after, checks } = await detail(source.id);
      expect(after, path).toMatchObject({ feedStatus: 'failing', feedError: error });
      expect(checks[0], path).toMatchObject({ ok: false, error });
    }
    // The production policy refuses the loopback feed outright: no request is made.
    const local = await create({ feedUrl: feed('/rss').replace('127.0.0.1', '127.0.0.2') });
    await send('POST', `/api/v1/os/sources/${local.id}/check-feed`);
    const job = await claim(workerDb.db, 'test-worker', 60, ['feed_check']);
    const before = requests;
    expect(
      await feedCheckHandler(workerDb.db, { ports: { 'http:': [port], 'https:': [443] } })(
        job ?? (null as never),
        { signal: new AbortController().signal },
      ),
    ).toEqual({ ok: false, error: 'fetch:address' });
    expect(requests).toBe(before);
  });

  it('only verified sources: refused when queued, and again when the job runs', async () => {
    const candidate = await create({
      status: 'candidate',
      licenseStatus: 'unknown',
      feedUrl: feed('/rss'),
    });
    expect(fields(await send('POST', `/api/v1/os/sources/${candidate.id}/check-feed`))).toEqual([
      { path: 'status', rule: 'not_verified' },
    ]);
    const noFeed = await create();
    expect(fields(await send('POST', `/api/v1/os/sources/${noFeed.id}/check-feed`))).toEqual([
      { path: 'feedUrl', rule: 'missing' },
    ]);
    // Queued while verified, paused before the worker got to it: no request is made.
    const source = await create({ feedUrl: feed('/rss') });
    await send('POST', `/api/v1/os/sources/${source.id}/check-feed`);
    await migrator.query(`UPDATE sources SET status = 'paused' WHERE id = $1`, [source.id]);
    const before = requests;
    const job = await claim(workerDb.db, 'test-worker', 60, ['feed_check']);
    expect(
      await handler()(job ?? (null as never), { signal: new AbortController().signal }),
    ).toEqual({
      ok: false,
      error: 'source:not_verified',
    });
    expect(requests).toBe(before);
  });

  it('limits the worker role to the feed columns; the history is immutable', async () => {
    const source = await create({ feedUrl: feed('/rss') });
    await runCheck(source.id);
    const worker = await connect(testDb.workerUrl);
    try {
      expect(await sqlState(worker.query('SELECT name, notes FROM sources'))).toBe('42501');
      expect(
        await sqlState(
          worker.query(`UPDATE sources SET status = 'verified' WHERE id = $1`, [source.id]),
        ),
      ).toBe('42501');
      expect(
        await sqlState(
          worker.query(`UPDATE sources SET feed_url = 'https://evil.test/' WHERE id = $1`, [
            source.id,
          ]),
        ),
      ).toBe('42501');
      expect(await sqlState(worker.query('DELETE FROM source_checks'))).toBe('42501');
    } finally {
      await worker.end();
    }
    expect(await sqlState(migrator.query('UPDATE source_checks SET ok = false'))).toBe('42501');
  });
});
