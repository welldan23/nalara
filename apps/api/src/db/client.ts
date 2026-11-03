// PostgreSQL pool + Drizzle instance with explicit time limits (ADR-003, release-it rules:
// no infinite waits). Callers own the lifecycle and must call close().
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { schema } from './schema.ts';

export interface PoolOptions {
  /** Maximum open connections. Small by default: one founder, one VPS. */
  readonly max?: number;
  /** Max wait to open a connection or to get one from a busy pool. */
  readonly connectionTimeoutMs?: number;
  /** Server-side limit for a single statement. */
  readonly statementTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
  readonly applicationName?: string;
}

export interface Database {
  readonly pool: pg.Pool;
  readonly db: NodePgDatabase<typeof schema>;
  readonly close: () => Promise<void>;
}

export const DEFAULT_POOL_OPTIONS = {
  max: 10,
  connectionTimeoutMs: 5_000,
  statementTimeoutMs: 15_000,
  idleTimeoutMs: 30_000,
  applicationName: 'nalara-api',
} as const satisfies Required<PoolOptions>;

export function createDatabase(connectionString: string, options: PoolOptions = {}): Database {
  const settings = { ...DEFAULT_POOL_OPTIONS, ...options };
  const pool = new pg.Pool({
    connectionString,
    max: settings.max,
    connectionTimeoutMillis: settings.connectionTimeoutMs,
    idleTimeoutMillis: settings.idleTimeoutMs,
    statement_timeout: settings.statementTimeoutMs,
    query_timeout: settings.statementTimeoutMs + 1_000,
    application_name: settings.applicationName,
  });
  // An idle client error (e.g. server restart) must not crash the process; the next
  // checkout fails visibly instead.
  pool.on('error', () => undefined);
  return {
    pool,
    db: drizzle(pool, { schema }),
    close: () => pool.end(),
  };
}
