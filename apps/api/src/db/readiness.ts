// Readiness = the database answers AND every migration on disk is applied unchanged (PRD B §8).
import type pg from 'pg';
import { migrationStatus } from './migrate.ts';

export function databaseReadiness(pool: pg.Pool, migrationsDir: string): () => Promise<boolean> {
  return async () => {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      return (await migrationStatus(client, migrationsDir)).upToDate;
    } finally {
      client.release();
    }
  };
}
