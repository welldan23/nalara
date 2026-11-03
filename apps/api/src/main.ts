// API process entry point: validate config (fail fast), connect the pool lazily, serve HTTP,
// shut down gracefully on SIGTERM/SIGINT. Migrations are never run from here (ADR-003).
import { buildApp } from './app.ts';
import { ConfigError, describeConfig, loadConfig } from './config/env.ts';
import { createDatabase } from './db/client.ts';
import { MIGRATIONS_DIR } from './db/migrations-dir.ts';
import { databaseReadiness } from './db/readiness.ts';

function fatal(msg: string, extra: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ level: 'fatal', time: new Date().toISOString(), msg, ...extra }));
}

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      fatal('invalid configuration, refusing to start', { issues: error.issues });
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const database = createDatabase(config.databaseUrl);
  const app = await buildApp(config, {
    readiness: databaseReadiness(database.pool, MIGRATIONS_DIR),
    database: database.db,
  });
  app.log.info({ config: describeConfig(config) }, 'configuration loaded');

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'shutting down');
    void app
      .close()
      .then(() => database.close())
      .then(() => {
        process.exitCode = 0;
      });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  // Inside containers the API must listen on all interfaces of its private network;
  // elsewhere bind to loopback only.
  const host = config.nodeEnv === 'production' ? '0.0.0.0' : '127.0.0.1';
  await app.listen({ host, port: config.port });
}

main().catch((error: unknown) => {
  fatal('startup failed', { error: error instanceof Error ? error.name : 'unknown' });
  process.exitCode = 1;
});
