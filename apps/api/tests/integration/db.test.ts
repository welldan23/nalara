// P0-005 database & migrations (PRD §14.3 TEST-DB-01..10). Runs against a real PostgreSQL.
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTableConfig } from 'drizzle-orm/pg-core';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/client.ts';
import { MIGRATIONS_TABLE, migrate, migrationStatus } from '../../src/db/migrate.ts';
import { databaseReadiness } from '../../src/db/readiness.ts';
import {
  articleRevisions,
  articles,
  auditEvents,
  categories,
  corrections,
  discoveredItems,
  evidenceSnapshots,
  ingestionRuns,
  jobRuns,
  loginChallenges,
  mediaAssets,
  publicationEvents,
  recoveryCodes,
  sessions,
  sourceChecks,
  sources,
  users,
  aiActionProposals,
  approvals,
  agentPreferences,
  agentCredentials,
  systemSettings,
  agentUsage,
  approvalTokens,
  datasets,
  datasetVersions,
} from '../../src/db/schema.ts';
import {
  connect,
  createTestDatabase,
  databaseAvailable,
  sqlState,
  type TestDatabase,
} from '../support/database.ts';

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'db',
  'migrations',
);
const TOKEN_HASH = Buffer.alloc(32, 1);

describe('integration database availability', () => {
  it('is configured whenever CI runs (no silent skips)', () => {
    if (process.env['CI'] === 'true') expect(databaseAvailable).toBe(true);
  });
});

describe.skipIf(!databaseAvailable)('database and migrations', { timeout: 30_000 }, () => {
  let database: TestDatabase;
  let migrator: pg.Client;
  let app: pg.Client;
  const scratch: string[] = [];

  beforeAll(async () => {
    database = await createTestDatabase();
    migrator = await connect(database.migratorUrl);
    app = await connect(database.appUrl);
  });

  afterAll(async () => {
    await app.end();
    await migrator.end();
    await database.drop();
    await Promise.all(scratch.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function copyMigrations(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'nalara-migrations-'));
    scratch.push(dir);
    await cp(MIGRATIONS_DIR, dir, { recursive: true });
    return dir;
  }

  async function freshDatabase<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
    const extra = await createTestDatabase();
    const client = await connect(extra.migratorUrl);
    try {
      return await run(client);
    } finally {
      await client.end();
      await extra.drop();
    }
  }

  describe('TEST-DB-01 empty migration', () => {
    it('migrates an empty database to the latest version', async () => {
      const before = await migrationStatus(migrator, MIGRATIONS_DIR);
      expect(before.applied).toEqual([]);
      expect(before.pending.length).toBeGreaterThan(0);

      const after = await migrate(migrator, MIGRATIONS_DIR);
      expect(after.upToDate).toBe(true);
      expect(after.pending).toEqual([]);

      const tables = await migrator.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`,
      );
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        'agent_credentials',
        'agent_preferences',
        'agent_usage',
        'ai_action_proposals',
        'approval_tokens',
        'approvals',
        'article_revisions',
        'articles',
        'audit_events',
        'categories',
        'corrections',
        'dataset_versions',
        'datasets',
        'discovered_items',
        'evidence_snapshots',
        'ingestion_runs',
        'job_runs',
        'login_challenges',
        'media_assets',
        MIGRATIONS_TABLE,
        'publication_events',
        'recovery_codes',
        'sessions',
        'source_checks',
        'sources',
        'story_queue',
        'system_settings',
        'users',
      ]);
    });
  });

  describe('TEST-DB-02 repeat migration', () => {
    it('is a no-op when run again', async () => {
      const count = async () =>
        (await migrator.query(`SELECT 1 FROM ${MIGRATIONS_TABLE}`)).rowCount;
      const before = await count();
      const status = await migrate(migrator, MIGRATIONS_DIR);
      expect(status.upToDate).toBe(true);
      expect(await count()).toBe(before);
    });

    it('serialises concurrent runners with an advisory lock', async () => {
      await freshDatabase(async (first) => {
        const url = new URL(database.migratorUrl);
        url.pathname = `/${String(first.database)}`;
        const second = await connect(url.toString());
        try {
          const results = await Promise.all([
            migrate(first, MIGRATIONS_DIR),
            migrate(second, MIGRATIONS_DIR),
          ]);
          expect(results.every((result) => result.upToDate)).toBe(true);
          const rows = await first.query(`SELECT version FROM ${MIGRATIONS_TABLE}`);
          expect(rows.rowCount).toBe((await migrationStatus(first, MIGRATIONS_DIR)).applied.length);
        } finally {
          await second.end();
        }
      });
    });
  });

  describe('TEST-DB-03 migration checksum', () => {
    it('refuses to run when an applied migration was edited', async () => {
      const dir = await copyMigrations();
      const file = join(dir, '0001_identity_and_audit.sql');
      await writeFile(file, `${await readFile(file, 'utf8')}\n-- edited after apply\n`);
      const status = await migrationStatus(migrator, dir);
      expect(status.upToDate).toBe(false);
      expect(status.problems).toContain(
        'applied migration 0001_identity_and_audit.sql was modified (checksum mismatch)',
      );
      await expect(migrate(migrator, dir)).rejects.toThrow(/checksum mismatch/);
    });

    it('refuses to run when an applied migration is missing', async () => {
      const dir = await copyMigrations();
      await rm(join(dir, '0001_identity_and_audit.sql'));
      await expect(migrate(migrator, dir)).rejects.toThrow(/missing from disk/);
    });

    it('rejects malformed migration filenames', async () => {
      const dir = await copyMigrations();
      await writeFile(join(dir, 'add-thing.sql'), 'SELECT 1;');
      await expect(migrationStatus(migrator, dir)).rejects.toThrow(/invalid migration filename/);
    });
  });

  describe('TEST-DB-04 schema version drift', () => {
    it('reports a pending migration as not up to date (readiness signal)', async () => {
      const dir = await copyMigrations();
      await writeFile(join(dir, '9999_future_change.sql'), 'SELECT 1;');
      const status = await migrationStatus(migrator, dir);
      expect(status.upToDate).toBe(false);
      expect(status.pending).toEqual(['9999_future_change.sql']);
    });

    it('rejects a new migration numbered below the latest applied one', async () => {
      await freshDatabase(async (client) => {
        const dir = await copyMigrations();
        await writeFile(join(dir, '9003_later.sql'), 'SELECT 1;');
        await migrate(client, dir);
        await writeFile(join(dir, '9002_backfilled.sql'), 'SELECT 1;');
        await expect(migrate(client, dir)).rejects.toThrow(/older than applied 9003/);
      });
    });

    it('keeps the Drizzle schema in sync with the migrated database', async () => {
      for (const table of [
        users,
        sessions,
        loginChallenges,
        recoveryCodes,
        auditEvents,
        categories,
        articles,
        articleRevisions,
        publicationEvents,
        corrections,
        sources,
        mediaAssets,
        jobRuns,
        sourceChecks,
        ingestionRuns,
        discoveredItems,
        evidenceSnapshots,
        aiActionProposals,
        approvals,
        agentPreferences,
        agentCredentials,
        systemSettings,
        agentUsage,
        approvalTokens,
        datasets,
        datasetVersions,
      ]) {
        const { name, columns } = getTableConfig(table);
        const actual = await migrator.query<{ column_name: string; is_nullable: string }>(
          `SELECT column_name, is_nullable FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = $1 ORDER BY column_name`,
          [name],
        );
        const expected = columns
          .map((column) => ({
            column_name: column.name,
            is_nullable: column.notNull ? 'NO' : 'YES',
          }))
          .sort((a, b) => a.column_name.localeCompare(b.column_name));
        expect(actual.rows, name).toEqual(expected);
      }
    });
  });

  describe('readiness (feeds /health/ready)', () => {
    it('is false until migrations are applied, then true', async () => {
      const extra = await createTestDatabase();
      const { pool, close } = createDatabase(extra.appUrl, { max: 1 });
      const migratorClient = await connect(extra.migratorUrl);
      try {
        const ready = databaseReadiness(pool, MIGRATIONS_DIR);
        expect(await ready()).toBe(false);
        await migrate(migratorClient, MIGRATIONS_DIR);
        expect(await ready()).toBe(true);
      } finally {
        await migratorClient.end();
        await close();
        await extra.drop();
      }
    });
  });

  describe('TEST-DB-05 unique founder email', () => {
    it('allows exactly one founder with a lowercase, unique email', async () => {
      const { db, close } = createDatabase(database.appUrl, { max: 1 });
      try {
        await db.insert(users).values({
          email: 'founder@example.invalid',
          passwordHash: 'not-a-real-hash',
          role: 'founder',
        });
        const insertAgain = (email: string) =>
          app.query(`INSERT INTO users (email, password_hash, role) VALUES ($1, 'x', 'founder')`, [
            email,
          ]);
        expect(await sqlState(insertAgain('founder@example.invalid'))).toBe('23505');
        expect(await sqlState(insertAgain('second@example.invalid'))).toBe('23505');
        expect(await sqlState(insertAgain('Founder@Example.invalid'))).toBe('23514');
        expect(
          await sqlState(
            app.query(
              `INSERT INTO users (email, password_hash, role) VALUES ('a@b.c', 'x', 'admin')`,
            ),
          ),
        ).toBe('23514');
      } finally {
        await close();
      }
    });
  });

  describe('TEST-DB-06 session FK integrity', () => {
    it('rejects sessions for unknown users and malformed token hashes', async () => {
      const orphan = app.query(
        `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (uuidv7(), $1, now() + interval '1 hour')`,
        [TOKEN_HASH],
      );
      expect(await sqlState(orphan)).toBe('23503');

      const founder = await app.query<{ id: string }>(`SELECT id FROM users LIMIT 1`);
      const userId = founder.rows[0]?.id;
      const shortHash = app.query(
        `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')`,
        [userId, Buffer.alloc(8)],
      );
      expect(await sqlState(shortHash)).toBe('23514');

      await app.query(
        `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')`,
        [userId, TOKEN_HASH],
      );
      const duplicate = app.query(
        `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')`,
        [userId, TOKEN_HASH],
      );
      expect(await sqlState(duplicate)).toBe('23505');
    });
  });

  describe('TEST-DB-07 audit event append-only', () => {
    it('lets the app role append but never change or remove audit rows', async () => {
      await app.query(
        `INSERT INTO audit_events (actor_type, action, result) VALUES ('system', 'db.migrate', 'success')`,
      );
      expect(await sqlState(app.query(`UPDATE audit_events SET result = 'failure'`))).toBe('42501');
      expect(await sqlState(app.query(`DELETE FROM audit_events`))).toBe('42501');
      expect(await sqlState(app.query(`TRUNCATE audit_events`))).toBe('42501');
      const rows = await app.query(`SELECT 1 FROM audit_events`);
      expect(rows.rowCount).toBe(1);
    });

    it('enforces audit row shape', async () => {
      const bad = (sql: string) => sqlState(app.query(sql));
      expect(
        await bad(
          `INSERT INTO audit_events (actor_type, action, result) VALUES ('ai', 'x.y.z', 'success')`,
        ),
      ).toBe('23514');
      expect(
        await bad(
          `INSERT INTO audit_events (actor_type, action, result) VALUES ('system', 'Bad Action', 'success')`,
        ),
      ).toBe('23514');
      expect(
        await bad(
          `INSERT INTO audit_events (actor_type, action, result, metadata) VALUES ('system', 'a.b.c', 'success', '[]')`,
        ),
      ).toBe('23514');
    });

    it('gives the app role no DDL and read-only migration bookkeeping', async () => {
      expect(await sqlState(app.query(`CREATE TABLE intruder (id int)`))).toBe('42501');
      expect(await sqlState(app.query(`DROP TABLE users`))).toBe('42501');
      // Readable for /health/ready, never writable.
      expect(await sqlState(app.query(`SELECT version FROM ${MIGRATIONS_TABLE}`))).toBeUndefined();
      expect(await sqlState(app.query(`DELETE FROM ${MIGRATIONS_TABLE}`))).toBe('42501');
      expect(
        await sqlState(
          app.query(
            `INSERT INTO ${MIGRATIONS_TABLE} (version, filename, sha256) VALUES ('9998', 'x', 'y')`,
          ),
        ),
      ).toBe('42501');
      expect(await sqlState(app.query(`UPDATE ${MIGRATIONS_TABLE} SET sha256 = 'tampered'`))).toBe(
        '42501',
      );
    });
  });

  describe('TEST-DB-08 transaction rollback', () => {
    it('rolls back a failing migration completely', async () => {
      const dir = await copyMigrations();
      await writeFile(
        join(dir, '9002_broken.sql'),
        'CREATE TABLE half_done (id int);\nSELECT * FROM table_that_does_not_exist;\n',
      );
      await expect(migrate(migrator, dir)).rejects.toThrow(
        /9002_broken\.sql failed and was rolled back/,
      );
      const leftover = await migrator.query(`SELECT to_regclass('half_done') AS t`);
      expect(leftover.rows[0]).toEqual({ t: null });
      const status = await migrationStatus(migrator, dir);
      expect(status.pending).toEqual(['9002_broken.sql']);
    });
  });

  describe('TEST-DB-09 DB connection timeout', () => {
    it('fails fast instead of hanging when the server is unreachable', async () => {
      const { pool, close } = createDatabase('postgres://nobody:nothing@10.255.255.1:5432/none', {
        connectionTimeoutMs: 300,
      });
      const started = Date.now();
      await expect(pool.query('SELECT 1')).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(3_000);
      await close();
    });

    it('cancels statements that exceed the statement timeout', async () => {
      const { pool, close } = createDatabase(database.appUrl, { statementTimeoutMs: 200 });
      expect(await sqlState(pool.query('SELECT pg_sleep(2)'))).toBe('57014');
      await close();
    });
  });

  describe('TEST-DB-10 pool exhaustion', () => {
    it('rejects a checkout from a full pool after the timeout, then recovers', async () => {
      const { pool, close } = createDatabase(database.appUrl, { max: 1, connectionTimeoutMs: 300 });
      const held = await pool.connect();
      const started = Date.now();
      await expect(pool.connect()).rejects.toThrow(/timeout/i);
      expect(Date.now() - started).toBeLessThan(3_000);
      held.release();
      const again = await pool.query<{ ok: number }>('SELECT 1 AS ok');
      expect(again.rows[0]?.ok).toBe(1);
      await close();
    });
  });
});
