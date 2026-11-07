// P2-02 job queue and worker loop: no double claims, lease expiry, ownership on finish, retry and
// failure, graceful stop, and the worker role's least privilege.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/client.ts';
import type { Database } from '../../src/db/client.ts';
import { migrate } from '../../src/db/migrate.ts';
import { MIGRATIONS_DIR } from '../../src/db/migrations-dir.ts';
import { backoffMs, claim, enqueue, finish } from '../../src/worker/queue.ts';
import { startWorker } from '../../src/worker/runner.ts';
import {
  connect,
  createTestDatabase,
  databaseAvailable,
  sqlState,
  type TestDatabase,
} from '../support/database.ts';

const S1 = '01900000-0000-7000-8000-0000000000a1';
const S2 = '01900000-0000-7000-8000-0000000000a2';

describe('backoffMs', () => {
  it('grows exponentially, is capped, and is jittered within the ceiling', () => {
    const r = 0.999999;
    const top = (attempt: number) => backoffMs(attempt, { random: () => r });
    expect(top(1)).toBe(Math.floor(r * 60_000));
    expect(top(2)).toBe(Math.floor(r * 120_000));
    expect(top(4)).toBe(Math.floor(r * 480_000));
    // Capped at 6 hours however many attempts.
    expect(top(30)).toBe(Math.floor(r * 6 * 60 * 60 * 1000));
    expect(backoffMs(3, { random: () => 0 })).toBe(0);
  });
});

describe.skipIf(!databaseAvailable)('job queue', { timeout: 60_000 }, () => {
  let testDb: TestDatabase;
  let migrator: pg.Client;
  let worker: Database;
  let other: Database;
  let app: Database;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    migrator = await connect(testDb.migratorUrl);
    await migrate(migrator, MIGRATIONS_DIR);
    worker = createDatabase(testDb.workerUrl, { max: 5 });
    other = createDatabase(testDb.workerUrl, { max: 5 });
    app = createDatabase(testDb.appUrl, { max: 2 });
  });

  afterAll(async () => {
    await Promise.all([worker.close(), other.close(), app.close()]);
    await migrator.end();
    await testDb.drop();
  });

  const reset = () => migrator.query('TRUNCATE job_runs');
  const row = async (id: string) =>
    (
      await migrator.query<{
        status: string;
        attempts: number;
        last_error: string | null;
        locked_by: string | null;
        due: boolean;
      }>(
        'SELECT status, attempts, last_error, locked_by, run_after <= now() AS due FROM job_runs WHERE id = $1',
        [id],
      )
    ).rows[0];

  it('keeps one active job per kind and subject; enqueueing again is a no-op', async () => {
    await reset();
    const first = await enqueue(app.db, { kind: 'feed_fetch', subjectId: S1 });
    expect(first).not.toBeNull();
    expect(await enqueue(app.db, { kind: 'feed_fetch', subjectId: S1 })).toBeNull();
    expect(await enqueue(app.db, { kind: 'feed_check', subjectId: S1 })).not.toBeNull();
    const job = await claim(worker.db, 'w1', 60, ['feed_fetch']);
    expect(job?.id).toBe(first);
    expect(await enqueue(app.db, { kind: 'feed_fetch', subjectId: S1 })).toBeNull(); // running
    expect(await finish(worker.db, job ?? (null as never), 'w1', { ok: true })).toBe(true);
    expect(await enqueue(app.db, { kind: 'feed_fetch', subjectId: S1 })).not.toBeNull();
  });

  it('never hands the same job to two workers (SKIP LOCKED)', async () => {
    await reset();
    for (let index = 0; index < 8; index += 1) {
      await enqueue(app.db, {
        kind: 'feed_fetch',
        subjectId: `01900000-0000-7000-8000-0000000001${String(index).padStart(2, '0')}`,
      });
    }
    const claims = await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        claim(index % 2 === 0 ? worker.db : other.db, `w${String(index)}`, 60, ['feed_fetch']),
      ),
    );
    const ids = claims.flatMap((job) => (job === null ? [] : [job.id]));
    expect(ids).toHaveLength(8);
    expect(new Set(ids).size).toBe(8);
  });

  it('only claims due jobs of the requested kinds', async () => {
    await reset();
    await enqueue(app.db, {
      kind: 'feed_fetch',
      subjectId: S1,
      runAfter: new Date(Date.now() + 60_000),
    });
    await enqueue(app.db, { kind: 'evidence_snapshot', subjectId: S2 });
    expect(await claim(worker.db, 'w1', 60, ['feed_fetch'])).toBeNull();
    expect((await claim(worker.db, 'w1', 60, ['evidence_snapshot']))?.kind).toBe(
      'evidence_snapshot',
    );
  });

  it('takes a job back when its lease expires; the old holder can no longer finish it', async () => {
    await reset();
    const id = await enqueue(app.db, { kind: 'feed_fetch', subjectId: S1 });
    const first = await claim(worker.db, 'w1', 1, ['feed_fetch']);
    expect(first?.id).toBe(id);
    expect(await claim(other.db, 'w2', 60, ['feed_fetch'])).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 1_300));
    const second = await claim(other.db, 'w2', 60, ['feed_fetch']);
    expect(second).toMatchObject({ id, attempts: 2 });
    expect(await finish(worker.db, first ?? (null as never), 'w1', { ok: true })).toBe(false);
    expect((await row(id ?? ''))?.locked_by).toBe('w2');
    expect(await finish(other.db, second ?? (null as never), 'w2', { ok: true })).toBe(true);
  });

  it('retries with a delay until attempts run out, then fails; error codes are sanitised', async () => {
    await reset();
    const id = await enqueue(app.db, { kind: 'feed_fetch', subjectId: S1, maxAttempts: 2 });
    const later = new Date(Date.now() + 60_000);
    const one = await claim(worker.db, 'w1', 60, ['feed_fetch']);
    await finish(worker.db, one ?? (null as never), 'w1', {
      ok: false,
      error: 'fetch:timeout',
      retryAt: later,
    });
    expect(await row(id ?? '')).toMatchObject({
      status: 'queued',
      last_error: 'fetch:timeout',
      due: false,
    });
    await migrator.query('UPDATE job_runs SET run_after = now() WHERE id = $1', [id]);
    const two = await claim(worker.db, 'w1', 60, ['feed_fetch']);
    await finish(worker.db, two ?? (null as never), 'w1', {
      ok: false,
      error: 'https://secret.example/leak?token=abc',
      retryAt: later,
    });
    expect(await row(id ?? '')).toMatchObject({
      status: 'failed',
      attempts: 2,
      last_error: 'internal',
    });
  });

  it('runs handlers, survives a throwing handler, and stops only after the job in hand', async () => {
    await reset();
    const slowId = await enqueue(app.db, { kind: 'feed_fetch', subjectId: S1 });
    const crashId = await enqueue(app.db, { kind: 'feed_check', subjectId: S2 });
    const state = { started: false };
    const running = startWorker(worker.db, {
      workerId: 'loop',
      pollMs: 50,
      handlers: {
        feed_fetch: async () => {
          state.started = true;
          await new Promise((resolve) => setTimeout(resolve, 400));
          return { ok: true };
        },
        feed_check: () => Promise.reject(new Error('boom')),
      },
    });
    for (let index = 0; index < 100 && !state.started; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(state.started).toBe(true);
    await running.stop(); // must wait for the 400 ms job
    expect((await row(slowId ?? ''))?.status).toBe('succeeded');
    const crashed = await row(crashId ?? '');
    // The throwing handler's job went back to the queue (or had not been claimed yet).
    expect(crashed?.status).toBe('queued');
    if (crashed?.attempts === 1) expect(crashed.last_error).toBe('internal');
  });

  it('gives the worker role only the queue, and the app role no way to run jobs', async () => {
    const workerClient = await connect(testDb.workerUrl);
    const appClient = await connect(testDb.appUrl);
    try {
      for (const table of [
        'users',
        'sessions',
        'recovery_codes',
        'audit_events',
        'article_revisions',
        'media_assets',
      ]) {
        expect(await sqlState(workerClient.query(`SELECT 1 FROM ${table} LIMIT 1`)), table).toBe(
          '42501',
        );
      }
      // Story packages (P5-03): the worker may see only whether a draft is still the prepared
      // revision, never its content or approval data.
      for (const column of ['slug', 'approved_content_sha256', 'source_exception']) {
        expect(
          await sqlState(workerClient.query(`SELECT ${column} FROM articles LIMIT 1`)),
          column,
        ).toBe('42501');
      }
      expect(await sqlState(workerClient.query('DELETE FROM job_runs'))).toBe('42501');
      expect(await sqlState(workerClient.query('CREATE TABLE x (id int)'))).toBe('42501');
      expect(await sqlState(appClient.query(`UPDATE job_runs SET status = 'succeeded'`))).toBe(
        '42501',
      );
    } finally {
      await workerClient.end();
      await appClient.end();
    }
  });
});
