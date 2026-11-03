// SQL-first migration runner (ADR-010). Applies db/migrations/NNNN_name.sql in order.
//
// Guarantees:
// - Each migration runs in its own transaction together with its bookkeeping row.
// - A session advisory lock prevents two runners from migrating at the same time.
// - An applied migration whose file changed (checksum) or disappeared is a hard error.
// - A new file numbered below the latest applied migration is a hard error (no out-of-order).
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ClientBase } from 'pg';

export const MIGRATIONS_TABLE = 'nalara_schema_migrations';
/** Application role from ADR-003; gets read-only access to migration bookkeeping. */
export const APP_ROLE = 'nalara_app';
const FILENAME_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;
// Arbitrary constant: "NALARA" spelled as digits; only needs to be stable and unique to us.
const ADVISORY_LOCK_KEY = 6_225_272_172;

export interface MigrationFile {
  readonly version: string;
  readonly filename: string;
  readonly sha256: string;
  readonly sql: string;
}

export interface MigrationStatus {
  readonly applied: readonly string[];
  readonly pending: readonly string[];
  readonly problems: readonly string[];
  /** True when every file is applied and nothing was modified, missing or out of order. */
  readonly upToDate: boolean;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

export async function readMigrationFiles(dir: string): Promise<MigrationFile[]> {
  const entries = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort();
  const files: MigrationFile[] = [];
  for (const filename of entries) {
    const match = FILENAME_PATTERN.exec(filename);
    if (match?.[1] === undefined) {
      throw new MigrationError(`invalid migration filename: ${filename} (expected NNNN_name.sql)`);
    }
    const sql = await readFile(join(dir, filename), 'utf8');
    files.push({ version: match[1], filename, sha256: sha256(sql), sql });
  }
  const versions = files.map((file) => file.version);
  const duplicate = versions.find((version, index) => versions.indexOf(version) !== index);
  if (duplicate !== undefined) throw new MigrationError(`duplicate migration version ${duplicate}`);
  return files;
}

interface AppliedRow {
  version: string;
  filename: string;
  sha256: string;
}

async function ensureTable(client: ClientBase): Promise<void> {
  await client.query(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
    version    text PRIMARY KEY,
    filename   text NOT NULL,
    sha256     text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  // The API (nalara_app) must read this table for /health/ready, but never change it.
  await client.query(`GRANT SELECT ON ${MIGRATIONS_TABLE} TO ${APP_ROLE}`);
}

async function readApplied(client: ClientBase): Promise<AppliedRow[]> {
  const exists = await client.query<{ present: boolean }>(
    'SELECT to_regclass($1) IS NOT NULL AS present',
    [MIGRATIONS_TABLE],
  );
  if (exists.rows[0]?.present !== true) return [];
  const result = await client.query<AppliedRow>(
    `SELECT version, filename, sha256 FROM ${MIGRATIONS_TABLE} ORDER BY version`,
  );
  return result.rows;
}

function compare(files: readonly MigrationFile[], applied: readonly AppliedRow[]): MigrationStatus {
  const problems: string[] = [];
  const byVersion = new Map(files.map((file) => [file.version, file]));
  for (const row of applied) {
    const file = byVersion.get(row.version);
    if (file === undefined) {
      problems.push(`applied migration ${row.filename} is missing from disk`);
    } else if (file.sha256 !== row.sha256) {
      problems.push(`applied migration ${row.filename} was modified (checksum mismatch)`);
    }
  }
  const appliedVersions = new Set(applied.map((row) => row.version));
  const latestApplied = applied.at(-1)?.version;
  const pending = files.filter((file) => !appliedVersions.has(file.version));
  for (const file of pending) {
    if (latestApplied !== undefined && file.version < latestApplied) {
      problems.push(`migration ${file.filename} is older than applied ${latestApplied}`);
    }
  }
  return {
    applied: applied.map((row) => row.filename),
    pending: pending.map((file) => file.filename),
    problems,
    upToDate: problems.length === 0 && pending.length === 0,
  };
}

/** Read-only check, e.g. for readiness: never creates tables or applies anything. */
export async function migrationStatus(client: ClientBase, dir: string): Promise<MigrationStatus> {
  return compare(await readMigrationFiles(dir), await readApplied(client));
}

/** Apply all pending migrations. Throws MigrationError and applies nothing if any problem exists. */
export async function migrate(client: ClientBase, dir: string): Promise<MigrationStatus> {
  const files = await readMigrationFiles(dir);
  await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
  try {
    await ensureTable(client);
    const before = compare(files, await readApplied(client));
    if (before.problems.length > 0) {
      throw new MigrationError(`refusing to migrate: ${before.problems.join('; ')}`);
    }
    for (const file of files.filter((candidate) => before.pending.includes(candidate.filename))) {
      await client.query('BEGIN');
      try {
        await client.query(file.sql);
        await client.query(
          `INSERT INTO ${MIGRATIONS_TABLE} (version, filename, sha256) VALUES ($1, $2, $3)`,
          [file.version, file.filename, file.sha256],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        const reason = error instanceof Error ? error.message : String(error);
        throw new MigrationError(
          `migration ${file.filename} failed and was rolled back: ${reason}`,
        );
      }
    }
    return compare(files, await readApplied(client));
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
