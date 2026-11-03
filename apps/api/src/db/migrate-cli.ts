// Explicit migration step (ADR-003): `pnpm --filter @nalara/api run db:migrate`.
// Uses only DATABASE_MIGRATOR_URL; never runs automatically at API startup.
import pg from 'pg';
import { ConfigError, loadMigratorConfig } from '../config/env.ts';
import { MigrationError, migrate, migrationStatus } from './migrate.ts';
import { MIGRATIONS_DIR } from './migrations-dir.ts';

function log(level: 'info' | 'fatal', msg: string, extra: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, time: new Date().toISOString(), msg, ...extra });
  if (level === 'fatal') console.error(line);
  else console.info(line);
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes('--check');
  const config = loadMigratorConfig(process.env);
  const client = new pg.Client({
    connectionString: config.migratorDatabaseUrl,
    connectionTimeoutMillis: 10_000,
    application_name: 'nalara-migrate',
  });
  await client.connect();
  try {
    const status = checkOnly
      ? await migrationStatus(client, MIGRATIONS_DIR)
      : await migrate(client, MIGRATIONS_DIR);
    log('info', checkOnly ? 'migration status' : 'migrations applied', { ...status });
    if (checkOnly && !status.upToDate) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    log('fatal', 'invalid configuration', { issues: error.issues });
  } else if (error instanceof MigrationError) {
    log('fatal', error.message);
  } else {
    // Driver errors can echo connection details; report the class and code only.
    const code = (error as { code?: unknown }).code;
    log('fatal', 'migration failed', {
      error: error instanceof Error ? error.name : 'unknown',
      code: typeof code === 'string' ? code : undefined,
    });
  }
  process.exitCode = 1;
});
