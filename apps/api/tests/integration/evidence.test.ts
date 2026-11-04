// P2-07 evidence vault: checking a citation requests a snapshot; the worker captures the page byte
// for byte with its SHA-256 through the safe fetch (local HTTPS server); copies are immutable,
// reused for 30 days, and only ever downloaded as attachments.
import { createHash } from 'node:crypto';
import { createServer } from 'node:https';
import type { Server } from 'node:https';
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
import { evidenceSnapshotHandler } from '../../src/worker/handlers/evidence-snapshot.ts';
import { claim, finish } from '../../src/worker/queue.ts';
import { testCertificate } from '../support/tls.ts';
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
const PAGE = '<html><body><h1>Inflasi 2,8 persen</h1><script>alert("x")</script></body></html>';
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

describe.skipIf(!databaseAvailable)('evidence vault', { timeout: 60_000 }, () => {
  let testDb: TestDatabase;
  let database: Database;
  let migrator: pg.Client;
  let app: FastifyInstance;
  let workerDb: Database;
  let pages: Server;
  let port = 0;
  const tls = testCertificate(['bukti.test']);
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
    workerDb = createDatabase(testDb.workerUrl, { max: 2 });
    pages = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
      const path = (req.url ?? '').split('?')[0];
      if (path === '/page') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(PAGE);
      } else if (path === '/script') {
        res.writeHead(200, { 'content-type': 'application/javascript' });
        res.end('alert(1)');
      } else {
        res.writeHead(503);
        res.end();
      }
    });
    await new Promise<void>((resolve) => pages.listen(0, '127.0.0.1', resolve));
    port = (pages.address() as AddressInfo).port;
  });

  afterAll(async () => {
    pages.closeAllConnections();
    await new Promise((resolve) => pages.close(resolve));
    await app.close();
    await workerDb.close();
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
  const url = (path: string) => `https://bukti.test:${String(port)}${path}`;
  const options = () => ({
    policy: onlyAddresses(['127.0.0.1']),
    resolve: (host: string) =>
      host === 'bukti.test'
        ? Promise.resolve([{ address: '127.0.0.1', family: 4 as const }])
        : Promise.reject(new Error('NXDOMAIN')),
    ports: { 'http:': [80], 'https:': [port] },
    ca: tls.cert,
    timeoutMs: 3_000,
  });
  const signal = new AbortController().signal;
  const runSnapshots = async () => {
    const outcomes = [];
    for (;;) {
      const job = await claim(workerDb.db, 'w', 60, ['evidence_snapshot']);
      if (job === null) break;
      const outcome = await evidenceSnapshotHandler(workerDb.db, options())(job, { signal });
      await finish(workerDb.db, job, 'w', outcome);
      outcomes.push(outcome);
    }
    return outcomes;
  };
  const snapshots = async (target: string) =>
    (
      await migrator.query<{
        id: string;
        status: string;
        error: string | null;
        sha256: Buffer | null;
        body: Buffer | null;
      }>(
        'SELECT id, status, error, sha256, body FROM evidence_snapshots WHERE url = $1 ORDER BY requested_at',
        [target],
      )
    ).rows;

  it('captures a checked citation byte for byte; an unchecked one is left alone', async () => {
    const page = url('/page');
    const id = await createArticle({
      citations: [
        citation({ url: page }),
        citation({
          id: '01900000-0000-7000-8000-00000000000b',
          url: url('/unchecked'),
          verified: false,
        }),
      ],
    });
    expect(await runSnapshots()).toEqual([{ ok: true }]);
    const [stored] = await snapshots(page);
    expect(stored?.status).toBe('captured');
    expect(stored?.body?.toString()).toBe(PAGE);
    expect(stored?.sha256?.toString('hex')).toBe(createHash('sha256').update(PAGE).digest('hex'));
    expect(await snapshots(url('/unchecked'))).toEqual([]);

    const detail = parse<{
      evidence: Record<string, { status: string; sha256: string; id: string }>;
    }>(
      await app.inject({
        method: 'GET',
        url: `/api/v1/os/articles/${id}`,
        headers: { cookie: `${COOKIE}=${token}` },
      }),
    );
    expect(detail.evidence[page]).toMatchObject({
      status: 'captured',
      sha256: createHash('sha256').update(PAGE).digest('hex'),
    });

    // Download: an attachment of unknown type, never rendered, with its hash.
    const file = await app.inject({
      method: 'GET',
      url: `/api/v1/os/evidence/${stored?.id ?? ''}/file`,
      headers: { cookie: `${COOKIE}=${token}` },
    });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('application/octet-stream');
    expect(file.headers['content-disposition']).toMatch(
      /^attachment; filename="nalara-bukti-[0-9a-f]{12}\.bin"$/,
    );
    expect(file.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(file.headers['x-evidence-sha256']).toBe(stored?.sha256?.toString('hex'));
    expect(file.rawPayload.toString()).toBe(PAGE);
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/os/evidence/${stored?.id ?? ''}/file` }))
        .statusCode,
    ).toBe(401);
  });

  it('reuses a recent copy instead of fetching again', async () => {
    const page = url('/page?again');
    await createArticle({ citations: [citation({ url: page })] });
    await runSnapshots();
    await createArticle({ title: 'Artikel lain', citations: [citation({ url: page })] });
    expect(await runSnapshots()).toEqual([]);
    expect(await snapshots(page)).toHaveLength(1);
  });

  it('records refusals as codes and retries only transient failures', async () => {
    const script = url('/script');
    await createArticle({ citations: [citation({ url: script })] });
    expect(await runSnapshots()).toEqual([{ ok: false, error: 'fetch:content_type' }]);
    expect((await snapshots(script))[0]).toMatchObject({
      status: 'failed',
      error: 'fetch:content_type',
      body: null,
    });

    const down = url('/down');
    await createArticle({ title: 'Server mati', citations: [citation({ url: down })] });
    const [first] = await runSnapshots();
    expect(first).toMatchObject({ ok: false, error: 'http:server_error' });
    expect((await snapshots(down))[0]?.status).toBe('pending'); // retried later by the queue
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await migrator.query(
        `UPDATE job_runs SET run_after = now() WHERE kind = 'evidence_snapshot'`,
      );
      await runSnapshots();
    }
    expect((await snapshots(down))[0]).toMatchObject({
      status: 'failed',
      error: 'http:server_error',
    });
  });

  it("keeps captured evidence immutable and the bytes out of the worker's reach", async () => {
    const page = url('/page?immutable');
    await createArticle({ citations: [citation({ url: page })] });
    await runSnapshots();
    const [stored] = await snapshots(page);
    const worker = await connect(testDb.workerUrl);
    try {
      expect(
        await sqlState(
          worker.query(
            `UPDATE evidence_snapshots SET status = 'failed', error = 'x:y' WHERE id = $1`,
            [stored?.id],
          ),
        ),
      ).toBe('42501');
      expect(await sqlState(worker.query('SELECT body FROM evidence_snapshots'))).toBe('42501');
    } finally {
      await worker.end();
    }
    expect(
      await sqlState(
        migrator.query(`UPDATE evidence_snapshots SET body = '\\x00' WHERE id = $1`, [stored?.id]),
      ),
    ).toBe('42501');
    expect(await sqlState(migrator.query('DELETE FROM evidence_snapshots'))).toBe('42501');
  });
});
