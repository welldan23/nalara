// Worker process entry point (P2-02, PRD v4 §5). Separate from the API: its own database role
// (nalara_worker), no HTTP port, no session or MFA secrets. Handlers are registered by the
// ingestion tickets (P2-03+). SIGTERM/SIGINT stop claiming and let the job in hand finish.
import { writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { ConfigError, loadWorkerConfig } from './config/env.ts';
import { createDatabase } from './db/client.ts';
import { startWorker } from './worker/runner.ts';
import type { WorkerLog } from './worker/runner.ts';

/** The container healthcheck looks at this file's age (it lives on the /tmp tmpfs). */
export const HEARTBEAT_FILE = '/tmp/nalara-worker.alive';

function line(level: string, fields: Record<string, unknown>, msg: string): void {
  process.stdout.write(
    `${JSON.stringify({ level, time: new Date().toISOString(), msg, ...fields })}\n`,
  );
}

const log: WorkerLog = {
  info: (fields, msg) => {
    line('info', fields, msg);
  },
  warn: (fields, msg) => {
    line('warn', fields, msg);
  },
};

function main(): void {
  let config;
  try {
    config = loadWorkerConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      line('fatal', { issues: error.issues }, 'invalid configuration, refusing to start');
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  const database = createDatabase(config.databaseUrl, { max: 2 });
  const workerId = `${hostname()}-${String(process.pid)}`.slice(0, 100);
  const worker = startWorker(database.db, {
    workerId,
    handlers: {},
    onBeat: () => {
      try {
        writeFileSync(HEARTBEAT_FILE, new Date().toISOString());
      } catch {
        // No writable /tmp: the healthcheck reports it.
      }
    },
    log,
  });
  line('info', { worker: workerId }, 'worker started');

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    line('info', { signal }, 'shutting down');
    void worker
      .stop()
      .then(() => database.close())
      .then(() => {
        process.exitCode = 0;
      });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

main();
