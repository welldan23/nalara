// Disposable PostgreSQL databases for integration tests.
// Needs TEST_DATABASE_ADMIN_URL (a superuser connection to a throwaway server, e.g. the CI
// service container or `docker compose up db`). Never point it at a real database.
import { randomBytes } from 'node:crypto';
import pg from 'pg';

export const adminUrl = process.env['TEST_DATABASE_ADMIN_URL'];
export const databaseAvailable = adminUrl !== undefined && adminUrl !== '';

// Test-only role passwords; the server behind TEST_DATABASE_ADMIN_URL is disposable.
const MIGRATOR_PASSWORD = 'nalara-test-migrator';
const APP_PASSWORD = 'nalara-test-app';
const WORKER_PASSWORD = 'nalara-test-worker';

export interface TestDatabase {
  readonly name: string;
  readonly migratorUrl: string;
  readonly appUrl: string;
  /** Phase 2 worker role (P2-02): only the tables the worker needs. */
  readonly workerUrl: string;
  drop(): Promise<void>;
}

function urlFor(base: string, user: string, password: string, database: string): string {
  const url = new URL(base);
  url.username = user;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}

async function withAdmin<T>(database: string, run: (client: pg.Client) => Promise<T>): Promise<T> {
  if (adminUrl === undefined) throw new Error('TEST_DATABASE_ADMIN_URL is not set');
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  const client = new pg.Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 5_000,
  });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/**
 * Same role layout as db/init/01-roles.sh (ADR-003, P2-02): a migrator that owns the database, and
 * the application and worker roles with CONNECT + schema USAGE only. Table privileges come from
 * migrations.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  if (adminUrl === undefined) throw new Error('TEST_DATABASE_ADMIN_URL is not set');
  const name = `nalara_test_${randomBytes(6).toString('hex')}`;
  await withAdmin('postgres', async (client) => {
    // Roles are cluster-wide and test files run in parallel: serialise role setup with an
    // advisory lock, otherwise concurrent ALTER ROLE fails with "tuple concurrently updated".
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(6225272173)');
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nalara_migrator') THEN
        CREATE ROLE nalara_migrator LOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nalara_app') THEN
        CREATE ROLE nalara_app LOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nalara_worker') THEN
        CREATE ROLE nalara_worker LOGIN; END IF;
    END $$`);
    await client.query(`ALTER ROLE nalara_migrator PASSWORD '${MIGRATOR_PASSWORD}'`);
    await client.query(`ALTER ROLE nalara_app PASSWORD '${APP_PASSWORD}'`);
    await client.query(`ALTER ROLE nalara_worker PASSWORD '${WORKER_PASSWORD}'`);
    await client.query('COMMIT');
    await client.query(`CREATE DATABASE ${name} OWNER nalara_migrator`);
    await client.query(`REVOKE ALL ON DATABASE ${name} FROM PUBLIC`);
    await client.query(`GRANT CONNECT ON DATABASE ${name} TO nalara_app, nalara_worker`);
  });
  await withAdmin(name, (client) =>
    client.query('GRANT USAGE ON SCHEMA public TO nalara_app, nalara_worker'),
  );
  return {
    name,
    migratorUrl: urlFor(adminUrl, 'nalara_migrator', MIGRATOR_PASSWORD, name),
    appUrl: urlFor(adminUrl, 'nalara_app', APP_PASSWORD, name),
    workerUrl: urlFor(adminUrl, 'nalara_worker', WORKER_PASSWORD, name),
    drop: () =>
      withAdmin('postgres', (client) => client.query(`DROP DATABASE ${name} WITH (FORCE)`)).then(
        () => undefined,
      ),
  };
}

export async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  await client.connect();
  return client;
}

/** Postgres SQLSTATE of a rejected promise, e.g. '23505' (unique) or '42501' (privilege). */
export async function sqlState(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : 'non-pg-error';
  }
  return undefined;
}
